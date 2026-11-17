import type { Db } from "@dexlane/db";
import { useTestDb as useScopedTestDb } from "@dexlane/db/testing";
import { importOrder, receiveStock, type StockKind } from "../src";

export const ACTOR = "test";

export const useTestDb = (): Db => useScopedTestDb("inventory");

let seq = 0;
const next = () => ++seq;

export async function makeLocation(sql: Db, code = `BOX-${next()}`) {
  const [row] = await sql<{ id: string }[]>`insert into locations (code) values (${code}) returning id`;
  return row!.id;
}

/** Carte de catalogue + une variante, sans offre ni stock. */
export async function makeVariant(
  sql: Db,
  opts: { setId?: string; number?: string; name?: string; language?: string; finish?: string; edition?: string; subtype?: string; incomplete?: boolean } = {},
) {
  const n = next();
  const [card] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language)
    values (${opts.setId ?? "base1"}, ${opts.number ?? String(n)}, ${opts.name ?? `Card ${n}`}, ${opts.language ?? "fr"})
    on conflict (set_id, local_number, language) do update set name = catalog_cards.name
    returning id`;
  const [variant] = await sql<{ id: string }[]>`
    insert into card_variants (catalog_card_id, finish, edition, subtype, incomplete)
    values (${card!.id}, ${opts.finish ?? "holo"}, ${opts.edition ?? ""}, ${opts.subtype ?? ""}, ${opts.incomplete ?? false})
    returning id`;
  return { catalogCardId: card!.id, variantId: variant!.id };
}

/** Compteurs qui ne correspondent plus au rejeu du journal des mouvements (doit rester vide). */
export function journalDrift(sql: Db) {
  return sql`
    select s.id from stock_items s
    left join lateral (
      select coalesce(sum(qty_delta) filter (where bucket = 'on_hand'), 0)  as on_hand,
             coalesce(sum(qty_delta) filter (where bucket = 'reserved'), 0) as reserved
        from inventory_movements m where m.stock_item_id = s.id
    ) j on true
    where j.on_hand <> s.on_hand or j.reserved <> s.reserved`;
}

export async function makeOffer(
  sql: Db,
  opts: { isUnique?: boolean; condition?: string; sku?: string; status?: string } = {},
) {
  const n = next();
  const [card] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language)
    values ('base1', ${String(n)}, ${`Card ${n}`}, 'fr') returning id`;
  const [variant] = await sql<{ id: string }[]>`
    insert into card_variants (catalog_card_id, finish) values (${card!.id}, 'holo') returning id`;
  const [offer] = await sql<{ id: string; offerSku: string }[]>`
    insert into offers (offer_sku, variant_id, condition, is_unique, status, category)
    values (${opts.sku ?? `OF-${n}`}, ${variant!.id}, ${opts.condition ?? "NM"}, ${opts.isUnique ?? false},
            ${opts.status ?? "ACTIVE"}, 'SINGLE')
    returning id, offer_sku`;
  return { offerId: offer!.id, offerSku: offer!.offerSku, variantId: variant!.id };
}

export async function stock(
  sql: Db,
  offerId: string,
  locationId: string,
  quantity: number,
  kind: StockKind = "FUNGIBLE",
) {
  return receiveStock(sql, {
    unitSku: `SI-${next()}`,
    kind,
    offerId,
    locationId,
    unitCostCents: 100,
    quantity,
    activate: true,
    actor: ACTOR,
  });
}

export async function order(sql: Db, offerSku: string, qty = 1, externalId = `EXT-${next()}`, channel = "ebay") {
  return importOrder(sql, {
    channel,
    externalId,
    paymentStatus: "PAID",
    grossCents: 1000 * qty,
    currency: "EUR",
    orderedAt: new Date(),
    lines: [{ externalLineId: "L1", offerSku, qty, unitPriceCents: 1000 }],
  });
}

export async function lineOf(sql: Db, orderId: string) {
  const [l] = await sql<{ id: string }[]>`select id from order_lines where order_id = ${orderId}`;
  return l!.id;
}

export async function stockRow(sql: Db, id: string) {
  const [s] = await sql<{ onHand: number; reserved: number; lifecycle: string; locationId: string }[]>`
    select on_hand, reserved, lifecycle, location_id from stock_items where id = ${id}`;
  return s!;
}
