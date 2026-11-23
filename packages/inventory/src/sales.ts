import { withTx, type Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";
import type { AllocationStatus, CardCondition } from "./internal";
import { likePrefix } from "./locations";
import { allocateOrder, importOrder, releaseAllocation } from "./orders";
import { getShippingCosts, postageFor, suppliesFor } from "./costs";
import { confirmHandover, createShipment, needsTracking, type ShippingMode } from "./shipping";

/** Canal des ventes saisies à la main (salon, particulier, groupe) : même cycle qu'une commande de marketplace. */
export const DIRECT_CHANNEL = "direct";

// ───────────────────────── Offres vendables ─────────────────────────

export interface SellableOffer {
  offerId: string;
  offerSku: string;
  condition: CardCondition;
  isUnique: boolean;
  category: string;
  targetPriceCents: number | null;
  floorPriceCents: number | null;
  availableToSell: number;
  card: { name: string; setId: string; localNumber: string; language: string; imageUrl: string | null; finish: string; edition: string };
}

/** Offres ayant du stock disponible, pour composer une vente. */
export function searchSellableOffers(sql: Db, opts: { q?: string; limit?: number } = {}): Promise<SellableOffer[]> {
  const q = opts.q?.trim();
  return sql<SellableOffer[]>`
    select o.id as offer_id, o.offer_sku, o.condition, o.is_unique, o.category, o.target_price_cents, o.floor_price_cents,
           a.available_to_sell,
           jsonb_build_object('name', c.name, 'setId', c.set_id, 'localNumber', c.local_number, 'language', c.language,
                              'imageUrl', c.image_url, 'finish', v.finish, 'edition', v.edition) as card
      from offers o
      join offer_availability a on a.offer_id = o.id
      join card_variants v on v.id = o.variant_id
      join catalog_cards c on c.id = v.catalog_card_id
     where a.available_to_sell > 0
       ${q ? sql`and (upper(o.offer_sku) like upper(${likePrefix(q)}) || '%'
                   or f_unaccent(lower(c.name)) like '%' || f_unaccent(lower(${likePrefix(q)})) || '%')` : sql``}
     order by f_unaccent(lower(c.name)), o.offer_sku
     limit ${Math.min(Math.max(opts.limit ?? 20, 1), 50)}`;
}

// ───────────────────────── Création ─────────────────────────

/** Adresse telle qu'elle est conservée sur la commande : le nom, puis les lignes de l'adresse postale. */
function shippingAddressOf(name: string | undefined, lines: string[] | undefined): Record<string, unknown> | undefined {
  const cleanName = name?.trim();
  const cleanLines = (lines ?? []).map((l) => l.trim()).filter(Boolean);
  if (!cleanName && cleanLines.length === 0) return undefined;
  return { ...(cleanName ? { name: cleanName } : {}), ...(cleanLines.length ? { lines: cleanLines } : {}) };
}

export interface DirectSaleInput {
  lines: { offerId: string; qty: number; unitPriceCents: number }[];
  shippingMode: ShippingMode;
  /** Frais de port facturés à l'acheteur, inclus dans le total encaissé. */
  shippingChargedCents?: number;
  buyerName?: string;
  /** Adresse de livraison, une ligne par élément (rue, code postal et ville, pays). */
  addressLines?: string[];
  note?: string;
  actor: string;
}

/**
 * Enregistre une vente directe et réserve aussitôt les cartes, dans une seule transaction.
 * Contrairement à une commande de marketplace (déjà conclue ailleurs), une vente saisie ici est refusée
 * si le stock ne suffit pas : rien n'est créé, pas de survente à résoudre après coup.
 */
export async function createDirectSale(sql: Db, input: DirectSaleInput): Promise<{ orderId: string; externalId: string }> {
  if (input.lines.length === 0) throw new DomainError("EMPTY_ORDER", "a sale needs at least one line");
  if (new Set(input.lines.map((l) => l.offerId)).size !== input.lines.length) {
    throw new DomainError("DUPLICATE_LINE", "each offer may appear only once in a sale");
  }
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new DomainError("INVALID_QUANTITY", "quantity must be a positive integer");
    if (!Number.isInteger(l.unitPriceCents) || l.unitPriceCents < 0) throw new DomainError("INVALID_PRICE", "prices must be non-negative integer cents");
  }
  const shippingChargedCents = input.shippingChargedCents ?? 0;
  if (!Number.isInteger(shippingChargedCents) || shippingChargedCents < 0) throw new DomainError("INVALID_PRICE", "shipping charge must be non-negative integer cents");

  return withTx(sql, async (tx) => {
    const offers = await tx<{ id: string; offerSku: string }[]>`
      select id, offer_sku from offers where id in ${tx(input.lines.map((l) => l.offerId))}`;
    const skuById = new Map(offers.map((o) => [o.id, o.offerSku]));
    const missing = input.lines.find((l) => !skuById.has(l.offerId));
    if (missing) throw new DomainError("OFFER_NOT_FOUND", `offer ${missing.offerId} does not exist`);

    const [seq] = await tx<{ n: string }[]>`select nextval('direct_order_seq') as n`;
    const externalId = `V-${seq!.n.padStart(6, "0")}`;
    const { orderId } = await importOrder(tx, {
      channel: DIRECT_CHANNEL,
      externalId,
      paymentStatus: "PAID",
      grossCents: input.lines.reduce((sum, l) => sum + l.qty * l.unitPriceCents, 0) + shippingChargedCents,
      currency: "EUR",
      orderedAt: new Date(),
      shippingAddress: shippingAddressOf(input.buyerName, input.addressLines),
      lines: input.lines.map((l, i) => ({ externalLineId: String(i + 1), offerSku: skuById.get(l.offerId)!, qty: l.qty, unitPriceCents: l.unitPriceCents })),
    });
    if (input.note?.trim()) await tx`update orders set note = ${input.note.trim()} where id = ${orderId}`;

    for (const result of await allocateOrder(tx, orderId, input.actor)) {
      if (result.status === "OVERSOLD") {
        throw new DomainError("INSUFFICIENT_STOCK", "not enough available stock for this sale", {
          requested: result.requested,
          available: result.available,
        });
      }
    }
    await createShipment(tx, { orderId, mode: input.shippingMode });
    return { orderId, externalId };
  });
}

// ───────────────────────── Lecture ─────────────────────────

export type OrderStage = "TO_PREPARE" | "PACKED" | "SHIPPED" | "CANCELLED";
const STAGE_STATUS: Record<OrderStage, string> = { TO_PREPARE: "PENDING", PACKED: "PACKED", SHIPPED: "SHIPPED", CANCELLED: "CANCELLED" };
const stageOf = (status: string): OrderStage =>
  (Object.entries(STAGE_STATUS).find(([, s]) => s === status)?.[0] as OrderStage | undefined) ?? "TO_PREPARE";

export interface OrderSummary {
  id: string;
  channel: string;
  externalId: string;
  stage: OrderStage;
  oversold: boolean;
  grossCents: number;
  orderedAt: Date;
  buyerName: string | null;
  cards: number;
  /** Noms des premières cartes, pour reconnaître la vente dans une liste. */
  cardNames: string[];
  shippingMode: ShippingMode | null;
}

export interface SalesTotals {
  orders: number;
  grossCents: number;
  /** Coût d'acquisition des cartes vendues. */
  costCents: number;
  postageCents: number;
  /** Sleeves, top-loaders et enveloppes, au tarif du jour de la remise. */
  suppliesCents: number;
  /** Encaissé − coût des cartes − affranchissement − fournitures. Les frais de canal ne sont pas encore comptés. */
  marginCents: number;
}

export async function listOrders(
  sql: Db,
  opts: { stage?: OrderStage; limit?: number; offset?: number } = {},
): Promise<{ items: OrderSummary[]; counts: Record<OrderStage, number>; last30Days: SalesTotals }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await sql<(Omit<OrderSummary, "stage"> & { fulfillmentStatus: string })[]>`
    select o.id, o.channel, o.external_id, o.fulfillment_status, o.oversold, o.gross_cents, o.ordered_at,
           o.shipping_address->>'name' as buyer_name,
           coalesce(l.cards, 0)::int as cards, coalesce(l.card_names, '{}') as card_names, sh.mode as shipping_mode
      from orders o
      left join lateral (
        select sum(ol.qty) as cards, (array_agg(c.name order by ol.external_line_id))[1:3] as card_names
          from order_lines ol
          join offers f on f.id = ol.offer_id
          join card_variants v on v.id = f.variant_id
          join catalog_cards c on c.id = v.catalog_card_id
         where ol.order_id = o.id) l on true
      left join lateral (select mode from shipments where order_id = o.id order by created_at desc limit 1) sh on true
     where ${opts.stage ? sql`o.fulfillment_status = ${STAGE_STATUS[opts.stage]}` : sql`true`}
     order by o.ordered_at desc, o.id
     limit ${limit} offset ${Math.max(opts.offset ?? 0, 0)}`;

  const statusCounts = await sql<{ fulfillmentStatus: string; n: number }[]>`
    select fulfillment_status, count(*)::int as n from orders group by fulfillment_status`;
  const counts: Record<OrderStage, number> = { TO_PREPARE: 0, PACKED: 0, SHIPPED: 0, CANCELLED: 0 };
  for (const c of statusCounts) counts[stageOf(c.fulfillmentStatus)] += c.n;

  const [totals] = await sql<{ orders: number; grossCents: string; costCents: string; postageCents: string; suppliesCents: string }[]>`
    select count(*)::int as orders, coalesce(sum(o.gross_cents), 0)::text as gross_cents,
           coalesce(sum(t.cost_cents), 0)::text as cost_cents, coalesce(sum(t.postage_cents), 0)::text as postage_cents,
           coalesce(sum(t.supplies_cents), 0)::text as supplies_cents
      from orders o
      join lateral (
        select (select coalesce(sum(a.qty::bigint * s.unit_cost_cents), 0)
                  from order_lines ol
                  join order_allocations a on a.order_line_id = ol.id and a.status = 'SHIPPED'
                  join stock_items s on s.id = a.stock_item_id
                 where ol.order_id = o.id) as cost_cents,
               (select coalesce(sum(sh.postage_cost_cents), 0) from shipments sh where sh.order_id = o.id) as postage_cents,
               (select coalesce(sum(sh.supplies_cost_cents), 0) from shipments sh where sh.order_id = o.id) as supplies_cents,
               (select max(sh.handover_confirmed_at) from shipments sh where sh.order_id = o.id) as shipped_at) t on true
     where o.fulfillment_status = 'SHIPPED' and t.shipped_at >= now() - interval '30 days'`;
  const gross = Number(totals!.grossCents), cost = Number(totals!.costCents), postage = Number(totals!.postageCents), supplies = Number(totals!.suppliesCents);

  return {
    items: rows.map(({ fulfillmentStatus, ...o }) => ({ ...o, stage: stageOf(fulfillmentStatus) })),
    counts,
    last30Days: { orders: totals!.orders, grossCents: gross, costCents: cost, postageCents: postage, suppliesCents: supplies, marginCents: gross - cost - postage - supplies },
  };
}

export interface OrderDetail extends OrderSummary {
  note: string | null;
  /** Lignes de l'adresse de livraison, si la commande en porte une. */
  addressLines: string[];
  /** Dernière impression du bon de livraison et du reçu. */
  slipPrintedAt: Date | null;
  lines: {
    id: string;
    offerId: string;
    offerSku: string;
    condition: CardCondition;
    qty: number;
    unitPriceCents: number;
    card: SellableOffer["card"];
    /** Ce qu'il faut aller chercher, et où. */
    allocations: {
      id: string;
      status: AllocationStatus;
      qty: number;
      unitSku: string;
      locationCode: string;
      unitCostCents: number;
      /** Rang de la carte dans la pile scannée : dans la boîte, c'est là qu'elle se trouve. */
      scan: { batchName: string; position: number } | null;
    }[];
  }[];
  shipment: {
    id: string;
    mode: ShippingMode;
    status: string;
    tracking: string | null;
    postageCostCents: number | null;
    suppliesCostCents: number | null;
    handoverConfirmedAt: Date | null;
  } | null;
  totals: {
    grossCents: number; itemsCents: number; shippingChargedCents: number; costCents: number; postageCents: number; suppliesCents: number; marginCents: number;
    /** Vente pas encore remise : affranchissement et fournitures sont ceux des réglages, pas encore ceux de l'envoi. */
    estimated: boolean;
  };
}

export async function getOrderDetail(sql: Db, orderId: string): Promise<OrderDetail> {
  const { items } = await listOrdersById(sql, orderId);
  const summary = items[0];
  if (!summary) throw new DomainError("ORDER_NOT_FOUND", "order not found");

  const [extra] = await sql<{ note: string | null; addressLines: string[]; slipPrintedAt: Date | null }[]>`
    select note, slip_printed_at,
           coalesce((select jsonb_agg(line) from jsonb_array_elements_text(
             case when jsonb_typeof(shipping_address->'lines') = 'array' then shipping_address->'lines' else '[]'::jsonb end) line), '[]'::jsonb) as address_lines
      from orders where id = ${orderId}`;
  const lines = await sql<OrderDetail["lines"]>`
    select ol.id, ol.offer_id, f.offer_sku, f.condition, ol.qty, ol.unit_price_cents,
           jsonb_build_object('name', c.name, 'setId', c.set_id, 'localNumber', c.local_number, 'language', c.language,
                              'imageUrl', c.image_url, 'finish', v.finish, 'edition', v.edition) as card,
           coalesce((select jsonb_agg(jsonb_build_object(
                       'id', a.id, 'status', a.status, 'qty', a.qty, 'unitSku', s.unit_sku,
                       'locationCode', loc.code, 'unitCostCents', s.unit_cost_cents,
                       'scan', case when si.id is null then null else jsonb_build_object('batchName', sb.name, 'position', si.position) end)
                       order by loc.code, s.unit_sku)
                       from order_allocations a
                       join stock_items s on s.id = a.stock_item_id
                       join locations loc on loc.id = s.location_id
                       left join scan_items si on si.stock_item_id = s.id
                       left join scan_batches sb on sb.id = si.batch_id
                      where a.order_line_id = ol.id and a.status <> 'RELEASED'), '[]'::jsonb) as allocations
      from order_lines ol
      join offers f on f.id = ol.offer_id
      join card_variants v on v.id = f.variant_id
      join catalog_cards c on c.id = v.catalog_card_id
     where ol.order_id = ${orderId}
     order by ol.external_line_id`;
  const [shipment] = await sql<NonNullable<OrderDetail["shipment"]>[]>`
    select id, mode, status, tracking, postage_cost_cents, supplies_cost_cents, handover_confirmed_at
      from shipments where order_id = ${orderId} order by created_at desc limit 1`;

  const itemsCents = lines.reduce((sum, l) => sum + l.qty * l.unitPriceCents, 0);
  const costCents = lines.reduce((sum, l) => sum + l.allocations.reduce((n, a) => n + a.qty * a.unitCostCents, 0), 0);
  // Remise faite : les montants figés de l'envoi. Sinon, une estimation avec les frais d'envoi réglés.
  const shipped = summary.stage === "SHIPPED";
  const costs = shipped ? null : await getShippingCosts(sql);
  const cards = lines.reduce((sum, l) => sum + l.qty, 0);
  const postageCents = shipment?.postageCostCents ?? (costs && shipment ? postageFor(costs, shipment.mode) : 0);
  const suppliesCents = shipment?.suppliesCostCents ?? (costs && shipment ? suppliesFor(costs, shipment.mode, cards) : 0);
  return {
    ...summary,
    note: extra?.note ?? null,
    addressLines: extra?.addressLines ?? [],
    slipPrintedAt: extra?.slipPrintedAt ?? null,
    lines,
    shipment: shipment ?? null,
    totals: {
      grossCents: summary.grossCents, itemsCents, shippingChargedCents: summary.grossCents - itemsCents,
      costCents, postageCents, suppliesCents, marginCents: summary.grossCents - costCents - postageCents - suppliesCents,
      estimated: !shipped && summary.stage !== "CANCELLED",
    },
  };
}

async function listOrdersById(sql: Db, orderId: string) {
  const all = await sql<(Omit<OrderSummary, "stage" | "cards" | "cardNames" | "shippingMode"> & { fulfillmentStatus: string })[]>`
    select id, channel, external_id, fulfillment_status, oversold, gross_cents, ordered_at, shipping_address->>'name' as buyer_name
      from orders where id = ${orderId}`;
  const [agg] = await sql<{ cards: number; cardNames: string[]; shippingMode: ShippingMode | null }[]>`
    select coalesce(sum(ol.qty), 0)::int as cards,
           coalesce((array_agg(c.name order by ol.external_line_id))[1:3], '{}') as card_names,
           (select mode from shipments where order_id = ${orderId} order by created_at desc limit 1) as shipping_mode
      from order_lines ol
      join offers f on f.id = ol.offer_id
      join card_variants v on v.id = f.variant_id
      join catalog_cards c on c.id = v.catalog_card_id
     where ol.order_id = ${orderId}`;
  return { items: all.map(({ fulfillmentStatus, ...o }) => ({ ...o, ...agg!, stage: stageOf(fulfillmentStatus) })) };
}

// ───────────────────────── Préparation des envois ─────────────────────────

/** Commandes à préparer, des plus anciennes aux plus récentes, avec tout ce qu'il faut pour les prélever et les imprimer. */
export async function listPreparation(sql: Db): Promise<OrderDetail[]> {
  const pending = await sql<{ id: string }[]>`
    select id from orders where fulfillment_status = ${STAGE_STATUS.TO_PREPARE} order by ordered_at, id limit 200`;
  const orders: OrderDetail[] = [];
  for (const { id } of pending) orders.push(await getOrderDetail(sql, id));
  return orders;
}

/** Note que les bons de ces commandes ont été imprimés : elles ne reviennent plus dans l'impression du jour. */
export async function markSlipsPrinted(sql: Db, orderIds: string[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  return (await sql`update orders set slip_printed_at = now() where id in ${sql(orderIds)} returning id`).length;
}

// ───────────────────────── Dépôt et annulation ─────────────────────────

export interface ShipOrderInput {
  orderId: string;
  tracking?: string;
  /** Affranchissement réellement payé, pour la marge. */
  postageCostCents?: number;
  actor: string;
}

/** Confirme la remise (bureau de poste, point relais ou main propre) : les cartes sortent du stock physique. */
export function shipOrder(sql: Db, input: ShipOrderInput) {
  return withTx(sql, async (tx) => {
    const [shipment] = await tx<{ id: string; mode: ShippingMode }[]>`
      select id, mode from shipments where order_id = ${input.orderId} order by created_at desc limit 1 for update`;
    if (!shipment) throw new DomainError("SHIPMENT_NOT_FOUND", "this order has no shipment");
    const tracking = input.tracking?.trim() || null;
    if (needsTracking(shipment.mode) && !tracking) {
      throw new DomainError("TRACKING_REQUIRED", "a tracked shipment needs a tracking number before handover");
    }
    // Affranchissement saisi, sinon celui déjà noté, sinon l'habituel du mode ; fournitures au tarif du jour.
    const costs = await getShippingCosts(tx);
    const [count] = await tx<{ cards: number }[]>`select coalesce(sum(qty), 0)::int as cards from order_lines where order_id = ${input.orderId}`;
    const cards = count?.cards ?? 0;
    await tx`
      update shipments set tracking = coalesce(${tracking}, tracking),
                           postage_cost_cents = coalesce(${input.postageCostCents ?? null}, postage_cost_cents, ${postageFor(costs, shipment.mode)}),
                           supplies_cost_cents = ${suppliesFor(costs, shipment.mode, cards)},
                           updated_at = now()
       where id = ${shipment.id}`;
    return confirmHandover(tx, shipment.id, input.actor);
  });
}

/**
 * Annule une vente avant le dépôt : les réservations sont libérées, les cartes redeviennent vendables.
 * Après le dépôt, ce n'est plus une annulation mais un retour (non géré ici).
 */
export function cancelOrder(sql: Db, orderId: string, actor: string, reason: string): Promise<void> {
  return withTx(sql, async (tx) => {
    const [order] = await tx<{ fulfillmentStatus: string }[]>`select fulfillment_status from orders where id = ${orderId} for update`;
    if (!order) throw new DomainError("ORDER_NOT_FOUND", "order not found");
    if (order.fulfillmentStatus === "CANCELLED") return;
    if (order.fulfillmentStatus === "SHIPPED") throw new DomainError("ALREADY_SHIPPED", "a shipped order cannot be cancelled; handle it as a return");

    const allocations = await tx<{ id: string }[]>`
      select a.id from order_allocations a join order_lines l on l.id = a.order_line_id
       where l.order_id = ${orderId} and a.status <> 'RELEASED'`;
    for (const a of allocations) await releaseAllocation(tx, a.id, actor, reason);
    await tx`delete from shipments where order_id = ${orderId} and status = 'PENDING'`;
    await tx`update orders set fulfillment_status = 'CANCELLED', updated_at = now() where id = ${orderId}`;
    await tx`
      insert into audit_events (actor, action, entity, entity_id, before, after)
      values (${actor}, 'order_cancelled', 'order', ${orderId}, ${tx.json({ fulfillmentStatus: order.fulfillmentStatus })}, ${tx.json({ reason })})`;
  });
}
