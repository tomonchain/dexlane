import type { Db } from "@dexlane/db";
import { useTestDb as useScopedTestDb } from "@dexlane/db/testing";
import { allocateOrder, createAcquisitionLot, createLocation, importOrder } from "@dexlane/inventory";
import type { ChannelAdapter, ChannelAdapters } from "@dexlane/listings";

export const ACTOR = "test";
export const useTestDb = (): Db => useScopedTestDb("insights");

let seq = 0;
const next = () => ++seq;
export const DAY = 86_400_000;
export const daysFrom = (base: Date, days: number) => new Date(base.getTime() + days * DAY);

/** Une carte de catalogue, sa variante et une offre, sans stock. */
export async function makeOffer(sql: Db, opts: { name?: string; setId?: string; graded?: boolean; kind?: "CARD" | "LOT" } = {}) {
  const n = next();
  const [card] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language) values (${opts.setId ?? "sv01"}, ${String(n)}, ${opts.name ?? `Carte ${n}`}, 'fr') returning id`;
  const [variant] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish) values (${card!.id}, 'holo') returning id`;
  const [offer] = await sql<{ id: string; offerSku: string }[]>`
    insert into offers (offer_sku, variant_id, condition, is_unique, status, category, target_price_cents, grader, grade, kind, lot_title)
    values (${`OF-${n}`}, ${variant!.id}, 'NM', ${!!opts.graded || opts.kind === "LOT"}, 'ACTIVE', 'SINGLE', 1000,
            ${opts.graded ? "PSA" : null}, ${opts.graded ? "10" : null}, ${opts.kind ?? "CARD"}, ${opts.kind === "LOT" ? `Lot ${n}` : null})
    returning id, offer_sku`;
  return { offerId: offer!.id, offerSku: offer!.offerSku, catalogCardId: card!.id };
}

export async function location(sql: Db) {
  return (await createLocation(sql, { code: `BOX-${next()}` })).id;
}

/**
 * Une position de stock entrée à une date passée : la position et son mouvement d'entrée sont datés (le journal des
 * mouvements n'accepte que des ajouts, il ne se corrige pas après coup).
 */
export async function stockAt(sql: Db, offerId: string, qty: number, at: Date, opts: { costCents?: number; lot?: boolean; locationId?: string } = {}) {
  const locationId = opts.locationId ?? (await location(sql));
  const lotId = opts.lot
    ? (await createAcquisitionLot(sql, { sourceType: "collection", purchaseDate: "2026-01-01", totalCostCents: 0 })).id
    : null;
  const [offer] = await sql<{ isUnique: boolean }[]>`select is_unique from offers where id = ${offerId}`;
  const [item] = await sql<{ id: string }[]>`
    insert into stock_items (unit_sku, kind, offer_id, location_id, acquisition_lot_id, unit_cost_cents, on_hand, lifecycle, created_at)
    values (${`SI-${next()}`}, ${offer!.isUnique ? "UNIQUE" : "FUNGIBLE"}, ${offerId}, ${locationId}, ${lotId}, ${opts.costCents ?? 0}, ${qty}, 'ACTIVE', ${at})
    returning id`;
  await sql`
    insert into inventory_movements (stock_item_id, movement_type, bucket, qty_delta, to_location_id, actor, created_at)
    values (${item!.id}, 'RECEIVE', 'on_hand', ${qty}, ${locationId}, ${ACTOR}, ${at})`;
  return item!.id;
}

/** Une annonce publiée (pour de vrai, sauf `simulated`) à une date donnée. */
export async function listedAt(sql: Db, offerId: string, at: Date, opts: { priceCents?: number; status?: string; simulated?: boolean; channel?: string } = {}) {
  const [row] = await sql<{ id: string }[]>`
    insert into listings (offer_id, channel, price_cents, status, simulated, created_at, updated_at)
    values (${offerId}, ${opts.channel ?? "ebay"}, ${opts.priceCents ?? 1000}, ${opts.status ?? "ACTIVE"}, ${opts.simulated ?? false}, ${at}, ${at})
    returning id`;
  return row!.id;
}

/** Une vente importée et réservée sur le stock. */
export async function sellAt(
  sql: Db, offerSku: string, at: Date,
  opts: { qty?: number; unitPriceCents?: number; currency?: string; channel?: string; externalId?: string; country?: string } = {},
) {
  const qty = opts.qty ?? 1;
  const unit = opts.unitPriceCents ?? 1000;
  const { orderId } = await importOrder(sql, {
    channel: opts.channel ?? "ebay", externalId: opts.externalId ?? `EXT-${next()}`, paymentStatus: "PAID",
    grossCents: qty * unit, currency: opts.currency ?? "EUR", orderedAt: at,
    shippingAddress: opts.country ? { country: opts.country } : undefined,
    lines: [{ externalLineId: "1", offerSku, qty, unitPriceCents: unit }],
  });
  await allocateOrder(sql, orderId, ACTOR);
  return orderId;
}

/** Un connecteur de canal factice : tout réussit, et l'on garde la trace de ce qui a été fait. */
export function fakeChannel(): { live: ChannelAdapters; ended: string[] } {
  const ended: string[] = [];
  const adapter: ChannelAdapter = {
    publish: async (input) => ({ externalId: `EB-${input.offerSku}`, url: null }),
    setQuantity: async () => undefined,
    end: async (externalId) => { ended.push(externalId); },
    fetchOrders: async () => [],
  };
  return { live: { ebay: adapter }, ended };
}
