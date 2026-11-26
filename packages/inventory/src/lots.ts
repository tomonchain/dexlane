import { randomUUID } from "node:crypto";
import { withTx, type Db } from "@dexlane/db";
import { DomainError, assertCents } from "@dexlane/shared";
import { CARD_CONDITIONS, applyDelta, availableOf, emit, type CardCondition, type StockItemRow } from "./internal";
import { nextUnitSku } from "./sku";

/*
 * Vente en lots : des cartes du stock regroupées en une seule annonce (« un lot, une annonce »).
 *
 * Un lot est une offre de type LOT, avec une position unique (une seule chose à vendre, à prélever, à emballer). Les
 * cartes qui le composent quittent leur position (mouvement LOT_PACK) : elles ne peuvent plus être vendues à part. Un
 * lot pas encore vendu peut être défait : elles y reviennent (LOT_UNPACK).
 */

export interface CreateLotInput {
  title: string;
  description?: string | null;
  priceCents: number;
  /** Les cartes du lot : une offre et combien d'exemplaires en prendre. */
  items: { offerId: string; qty: number }[];
  /** Où ranger le lot ; par défaut, l'emplacement de sa carte la plus chère. */
  locationId?: string;
  actor: string;
}

export interface LotMember {
  stockItemId: string;
  offerId: string;
  offerSku: string;
  name: string;
  setName: string | null;
  localNumber: string;
  condition: CardCondition;
  imageUrl: string | null;
  qty: number;
  unitCostCents: number;
}

export interface LotSummary {
  offerId: string;
  offerSku: string;
  title: string;
  description: string | null;
  priceCents: number | null;
  condition: CardCondition;
  /** Cartes dans le lot (somme des quantités). */
  cards: number;
  costCents: number;
  locationCode: string | null;
  /** IN_STOCK : à vendre ; RESERVED : dans une commande en cours ; SOLD : parti ; DISSOLVED : défait. */
  status: "IN_STOCK" | "RESERVED" | "SOLD" | "DISSOLVED";
  createdAt: Date;
  members: LotMember[];
}

const conditionRank = (c: CardCondition) => CARD_CONDITIONS.indexOf(c);
const MAX_TITLE = 80;

export function createLot(sql: Db, input: CreateLotInput): Promise<LotSummary> {
  const title = input.title.trim();
  if (!title) throw new DomainError("LOT_TITLE_REQUIRED", "un lot a besoin d'un titre");
  if (title.length > MAX_TITLE) throw new DomainError("LOT_TITLE_TOO_LONG", `le titre d'un lot fait au plus ${MAX_TITLE} caractères`);
  assertCents(input.priceCents, "priceCents");
  const wanted = new Map<string, number>();
  for (const item of input.items) {
    if (!Number.isInteger(item.qty) || item.qty <= 0) throw new DomainError("INVALID_QUANTITY", "quantities must be positive integers");
    wanted.set(item.offerId, (wanted.get(item.offerId) ?? 0) + item.qty);
  }
  if ([...wanted.values()].reduce((a, b) => a + b, 0) < 2) throw new DomainError("LOT_TOO_SMALL", "un lot regroupe au moins deux cartes");

  return withTx(sql, async (tx) => {
    const offers = await tx<{ id: string; variantId: string; condition: CardCondition; kind: string; targetPriceCents: number | null }[]>`
      select id, variant_id, condition, kind, target_price_cents from offers where id in ${tx([...wanted.keys()])} for update`;
    if (offers.length !== wanted.size) throw new DomainError("OFFER_NOT_FOUND", "une des cartes du lot n'existe pas");
    if (offers.some((o) => o.kind === "LOT")) throw new DomainError("INVALID_STATE", "un lot ne peut pas contenir un autre lot");

    const correlationId = randomUUID();
    const taken: { item: StockItemRow; qty: number }[] = [];
    for (const offer of offers) {
      let need = wanted.get(offer.id)!;
      // Les plus anciennes positions d'abord, comme pour une commande.
      const positions = await tx<StockItemRow[]>`
        select * from stock_items where offer_id = ${offer.id} and lifecycle = 'ACTIVE' order by created_at, id for update`;
      for (const p of positions) {
        const q = Math.min(need, Math.max(0, availableOf(p)));
        if (q > 0) {
          taken.push({ item: p, qty: q });
          need -= q;
        }
        if (need === 0) break;
      }
      if (need > 0) throw new DomainError("INSUFFICIENT_STOCK", "pas assez d'exemplaires disponibles pour ce lot", { offerId: offer.id, missing: need });
    }

    // La carte phare (la plus chère) donne au lot sa variante et son emplacement ; l'état annoncé est le moins bon.
    const headline = [...offers].sort((a, b) => (b.targetPriceCents ?? 0) - (a.targetPriceCents ?? 0))[0]!;
    const condition = offers.map((o) => o.condition).sort((a, b) => conditionRank(b) - conditionRank(a))[0]!;
    const locationId = input.locationId ?? taken.find((t) => t.item.offerId === headline.id)!.item.locationId;
    const cost = taken.reduce((n, t) => n + t.item.unitCostCents * t.qty, 0);

    const { unitSku, n } = await nextUnitSku(tx);
    const [lot] = await tx<{ id: string }[]>`
      insert into offers (offer_sku, variant_id, condition, is_unique, category, status, kind, lot_title, lot_description,
                          target_price_cents, floor_price_cents, price_source)
      values (${`LOT-${String(n).padStart(6, "0")}`}, ${headline.variantId}, ${condition}, true, 'LOT', 'ACTIVE', 'LOT', ${title},
              ${input.description?.trim() || null}, ${input.priceCents}, ${Math.min(cost, input.priceCents)}, 'MANUAL')
      returning id`;

    for (const t of taken) {
      await applyDelta(tx, {
        stockItemId: t.item.id, type: "LOT_PACK", bucket: "on_hand", qtyDelta: -t.qty, correlationId, actor: input.actor, reason: `lot ${title}`,
      });
      if (t.item.onHand - t.qty === 0) await tx`update stock_items set lifecycle = 'ARCHIVED' where id = ${t.item.id}`;
      await tx`
        insert into lot_items (lot_offer_id, stock_item_id, qty, unit_cost_cents)
        values (${lot!.id}, ${t.item.id}, ${t.qty}, ${t.item.unitCostCents})`;
    }

    const [position] = await tx<{ id: string }[]>`
      insert into stock_items (unit_sku, kind, offer_id, location_id, unit_cost_cents, on_hand, lifecycle)
      values (${unitSku}, 'UNIQUE', ${lot!.id}, ${locationId}, ${cost}, 0, 'ACTIVE')
      returning id`;
    await applyDelta(tx, {
      stockItemId: position!.id, type: "LOT_PACK", bucket: "on_hand", qtyDelta: 1, toLocationId: locationId, correlationId, actor: input.actor,
    });
    await tx`
      insert into audit_events (actor, action, entity, entity_id, after)
      values (${input.actor}, 'lot_created', 'offer', ${lot!.id},
              ${tx.json({ title, priceCents: input.priceCents, cards: taken.reduce((a, t) => a + t.qty, 0), costCents: cost })})`;
    await emit(tx, "LotCreated", "offer", lot!.id, { title });
    return (await listLots(tx, { offerId: lot!.id }))[0]!;
  });
}

/** Défait un lot pas encore vendu : ses cartes reviennent à leur position et redeviennent vendables à l'unité. */
export function dissolveLot(sql: Db, lotOfferId: string, actor: string): Promise<void> {
  return withTx(sql, async (tx) => {
    const [lot] = await tx<{ id: string; kind: string; status: string }[]>`select id, kind, status from offers where id = ${lotOfferId} for update`;
    if (!lot || lot.kind !== "LOT") throw new DomainError("LOT_NOT_FOUND", "ce lot n'existe pas");
    const [position] = await tx<StockItemRow[]>`select * from stock_items where offer_id = ${lot.id} for update`;
    if (!position || position.onHand === 0) throw new DomainError("INVALID_STATE", "ce lot est déjà vendu ou défait");
    if (availableOf(position) < 1) throw new DomainError("INVALID_STATE", "ce lot est dans une commande en cours : annule-la d'abord");

    const correlationId = randomUUID();
    await applyDelta(tx, { stockItemId: position.id, type: "LOT_UNPACK", bucket: "on_hand", qtyDelta: -1, correlationId, actor });
    await tx`update stock_items set lifecycle = 'ARCHIVED' where id = ${position.id}`;
    const members = await tx<{ stockItemId: string; qty: number }[]>`select stock_item_id, qty from lot_items where lot_offer_id = ${lot.id}`;
    for (const m of members) {
      await applyDelta(tx, { stockItemId: m.stockItemId, type: "LOT_UNPACK", bucket: "on_hand", qtyDelta: m.qty, correlationId, actor });
      await tx`update stock_items set lifecycle = 'ACTIVE' where id = ${m.stockItemId} and lifecycle = 'ARCHIVED'`;
    }
    await tx`update offers set status = 'ARCHIVED', updated_at = now() where id = ${lot.id}`;
    await tx`insert into audit_events (actor, action, entity, entity_id) values (${actor}, 'lot_dissolved', 'offer', ${lot.id})`;
  });
}

/** Les lots, du plus récent au plus ancien, avec leurs cartes. */
export async function listLots(sql: Db, opts: { offerId?: string } = {}): Promise<LotSummary[]> {
  const lots = await sql<(Omit<LotSummary, "members" | "status"> & { onHand: number; reserved: number; offerStatus: string })[]>`
    select o.id as offer_id, o.offer_sku, o.lot_title as title, o.lot_description as description, o.target_price_cents as price_cents,
           o.condition, o.created_at, o.status as offer_status,
           coalesce((select sum(qty) from lot_items li where li.lot_offer_id = o.id), 0)::int as cards,
           coalesce(si.unit_cost_cents, 0) as cost_cents, loc.code as location_code,
           coalesce(si.on_hand, 0) as on_hand, coalesce(si.reserved, 0) as reserved
      from offers o
      left join stock_items si on si.offer_id = o.id
      left join locations loc on loc.id = si.location_id
     where o.kind = 'LOT' ${opts.offerId ? sql`and o.id = ${opts.offerId}` : sql``}
     order by o.created_at desc`;
  if (lots.length === 0) return [];
  const members = await sql<(LotMember & { lotOfferId: string })[]>`
    select li.lot_offer_id, li.stock_item_id, li.qty, li.unit_cost_cents, f.id as offer_id, f.offer_sku, f.condition,
           c.name, c.local_number, c.image_url, s.name as set_name
      from lot_items li
      join stock_items si on si.id = li.stock_item_id
      join offers f on f.id = si.offer_id
      join card_variants v on v.id = f.variant_id
      join catalog_cards c on c.id = v.catalog_card_id
      left join catalog_sets s on s.id = c.set_id and s.language = c.language
     where li.lot_offer_id in ${sql(lots.map((l) => l.offerId))}
     order by f.target_price_cents desc nulls last, c.name`;
  return lots.map(({ onHand, reserved, offerStatus, ...lot }) => ({
    ...lot,
    status: offerStatus === "ARCHIVED" ? "DISSOLVED" : onHand === 0 ? "SOLD" : reserved > 0 ? "RESERVED" : "IN_STOCK",
    members: members.filter((m) => m.lotOfferId === lot.offerId).map(({ lotOfferId: _l, ...m }) => m),
  }));
}
