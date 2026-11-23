import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { attachPhotos, cancelOrder, createDirectSale, createLocation, receiveCard, recordPhoto } from "@dexlane/inventory";
import { endListing, getActivity, publishListing, setChannelMode, todayInParis } from "../src";

const sql = useTestDb("listings");
const ACTOR = "test";
let seq = 0;

async function offer(name: string, price = 1500) {
  const n = ++seq;
  const [card] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language) values ('base1', ${String(n)}, ${name}, 'fr') returning id`;
  const [variant] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish) values (${card!.id}, 'holo') returning id`;
  await createLocation(sql, { code: "BOX-01" });
  const r = await receiveCard(sql, { variantId: variant!.id, condition: "NM", quantity: 5, location: { code: "BOX-01" }, unitCostCents: 100, actor: ACTOR });
  await sql`update offers set target_price_cents = ${price}, category = 'SINGLE' where id = ${r.offer.id}`;
  const scan = await recordPhoto(sql, { kind: "SCAN_FRONT", storageKey: `scan-${n}`, url: `https://blob.test/scan-${n}.jpg`, contentType: "image/jpeg", byteSize: 1 });
  await attachPhotos(sql, [scan.id], { stockItemId: r.stockItem.id, offerId: r.offer.id });
  return r.offer.id;
}
const sell = (offerId: string, qty: number, unitPriceCents: number, over: object = {}) =>
  createDirectSale(sql, { lines: [{ offerId, qty, unitPriceCents }], shippingMode: "HAND_DELIVERY", actor: ACTOR, ...over });

describe("recent activity", () => {
  it("counts sales per day over thirty days, without cancelled ones, and lists the latest sales and listings", async () => {
    const today = todayInParis();
    const empty = await getActivity(sql);
    expect(empty.days).toHaveLength(30);
    expect(empty.days.at(-1)).toEqual({ day: today, orders: 0, grossCents: 0 });
    expect(empty).toMatchObject({ totals: { orders: 0, grossCents: 0 }, sales: [], listings: [] });

    await setChannelMode(sql, {}, "ebay", "SIMULATION", ACTOR);
    const [pika, mew] = [await offer("Pikachu"), await offer("Mewtwo", 9000)];
    const first = await sell(pika, 2, 500, { buyerName: "Camille", shippingChargedCents: 200 });
    const second = await sell(mew, 1, 9000);
    const cancelled = await sell(pika, 1, 500);
    await cancelOrder(sql, cancelled.orderId, ACTOR, "erreur de saisie");
    // Une vente d'il y a 12 jours, et une trop ancienne pour la période.
    const older = await sell(pika, 1, 400);
    await sql`update orders set ordered_at = now() - interval '12 days' where id = ${older.orderId}`;
    const ancient = await sell(pika, 1, 400);
    await sql`update orders set ordered_at = now() - interval '45 days' where id = ${ancient.orderId}`;

    const listedPika = await publishListing(sql, {}, { offerId: pika, channel: "ebay", actor: ACTOR });
    const listedMew = await publishListing(sql, {}, { offerId: mew, channel: "ebay", actor: ACTOR });
    await sql`update listings set created_at = now() - interval '1 hour' where id = ${listedPika.id}`;

    const activity = await getActivity(sql);
    expect(activity.days.at(-1)).toEqual({ day: today, orders: 2, grossCents: 1200 + 9000 });
    expect(activity.days.filter((d) => d.orders > 0).map((d) => d.orders)).toEqual([1, 2]);
    expect(activity.totals).toEqual({ orders: 3, grossCents: 400 + 1200 + 9000 });
    // Dernières ventes, la plus récente d'abord ; l'annulée n'y est pas, la très ancienne reste visible en fin de liste.
    expect(activity.sales.map((s) => s.externalId)).toEqual([second.externalId, first.externalId, older.externalId, ancient.externalId]);
    expect(activity.sales[1]).toMatchObject({ buyerName: "Camille", cards: 2, cardNames: ["Pikachu"], grossCents: 1200, channel: "direct", fulfillmentStatus: "PENDING" });
    // Dernières mises en ligne ; une annonce retirée disparaît.
    expect(activity.listings.map((l) => l.name)).toEqual(["Mewtwo", "Pikachu"]);
    expect(activity.listings[0]).toMatchObject({ channel: "ebay", priceCents: 9000, simulated: true, condition: "NM", finish: "holo" });
    await endListing(sql, {}, { listingId: listedMew.id, actor: ACTOR });
    expect((await getActivity(sql, { limit: 1 })).listings.map((l) => l.name)).toEqual(["Pikachu"]);
  });
});
