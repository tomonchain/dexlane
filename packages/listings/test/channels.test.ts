import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { attachPhotos, createDirectSale, createLocation, getOrderDetail, receiveCard, recordPhoto } from "@dexlane/inventory";
import {
  endListing, ingestChannelOrder, listChannels, listListingOffers, publishListing, setChannelMode, simulateOrder, syncChannels, syncQuantities,
  type ChannelAdapter, type ChannelOrder, type PublishInput,
} from "../src";

const sql = useTestDb("listings");
const ACTOR = "test";
let seq = 0;

/** Offre vendable : `quantity` exemplaires, prix cible et photo de scan selon les options. */
async function offer(opts: { quantity?: number; price?: number | null; photo?: boolean } = {}) {
  const n = ++seq;
  const [card] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language) values ('base1', ${String(n)}, ${`Carte ${n}`}, 'fr') returning id`;
  const [variant] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish) values (${card!.id}, 'holo') returning id`;
  await createLocation(sql, { code: "BOX-01" });
  const r = await receiveCard(sql, { variantId: variant!.id, condition: "NM", quantity: opts.quantity ?? 3, location: { code: "BOX-01" }, unitCostCents: 100, actor: ACTOR });
  if (opts.price !== null) await sql`update offers set target_price_cents = ${opts.price ?? 1500}, category = 'SINGLE' where id = ${r.offer.id}`;
  if (opts.photo !== false) {
    const scan = await recordPhoto(sql, { kind: "SCAN_FRONT", storageKey: `scan-${n}`, url: `https://blob.test/scan-${n}.jpg`, contentType: "image/jpeg", byteSize: 1 });
    await attachPhotos(sql, [scan.id], { stockItemId: r.stockItem.id, offerId: r.offer.id });
  }
  return { id: r.offer.id, sku: r.offer.offerSku };
}

/** Faux connecteur réel : enregistre ce qu'on lui envoie, restitue les commandes qu'on lui confie. */
function fakeAdapter() {
  const calls = { published: [] as PublishInput[], quantities: [] as [string, number][], ended: [] as string[] };
  const pending: ChannelOrder[] = [];
  let failing = false;
  const adapter: ChannelAdapter = {
    async publish(input) {
      calls.published.push(input);
      return { externalId: `EB-${input.offerSku}`, url: `https://ebay.test/${input.offerSku}` };
    },
    async setQuantity(_externalId, sku, quantity) {
      if (failing) throw new Error("ebay is down");
      calls.quantities.push([sku, quantity]);
    },
    async end(externalId) {
      calls.ended.push(externalId);
    },
    fetchOrders: async () => pending.splice(0),
  };
  return { adapter, calls, pending, fail: (value: boolean) => (failing = value) };
}

const listingOf = async (offerId: string) => (await listListingOffers(sql, { offerId })).items[0]?.listings[0];

describe("channel modes", () => {
  it("starts switched off, refuses to publish, and only goes live with a configured connector", async () => {
    const o = await offer();
    expect((await listChannels(sql, {})).map((c) => [c.id, c.mode, c.liveAvailable])).toEqual([["ebay", "OFF", false], ["cardtrader", "OFF", false]]);
    await expect(publishListing(sql, {}, { offerId: o.id, channel: "ebay", actor: ACTOR })).rejects.toMatchObject({ code: "CHANNEL_DISABLED" });
    await expect(setChannelMode(sql, {}, "ebay", "LIVE", ACTOR)).rejects.toMatchObject({ code: "CHANNEL_NOT_CONFIGURED" });
    await setChannelMode(sql, { ebay: fakeAdapter().adapter }, "ebay", "LIVE", ACTOR);
    expect((await listChannels(sql, { ebay: fakeAdapter().adapter }))[0]).toMatchObject({ mode: "LIVE", liveAvailable: true });
  });

  it("ends simulated listings when leaving simulation", async () => {
    const o = await offer();
    await setChannelMode(sql, {}, "ebay", "SIMULATION", ACTOR);
    await publishListing(sql, {}, { offerId: o.id, channel: "ebay", actor: ACTOR });
    expect(await listingOf(o.id)).toMatchObject({ status: "ACTIVE", simulated: true, externalId: `SIM-EBAY-${o.sku}` });
    await setChannelMode(sql, {}, "ebay", "OFF", ACTOR);
    expect(await listingOf(o.id)).toBeUndefined();
  });
});

describe("publishing", () => {
  it("refuses an offer without a price or a photo and says what is missing", async () => {
    await setChannelMode(sql, {}, "ebay", "SIMULATION", ACTOR);
    const o = await offer({ price: null, photo: false });
    expect((await listListingOffers(sql, { offerId: o.id })).items[0]!.missing).toEqual(["PRICE", "PHOTO"]);
    await expect(publishListing(sql, {}, { offerId: o.id, channel: "ebay", actor: ACTOR })).rejects.toMatchObject({
      code: "LISTING_NOT_READY", details: { missing: ["PRICE", "PHOTO"] },
    });
  });

  it("sends title, price, quantity and photos to the connector, and updates the same listing when republished", async () => {
    const ebay = fakeAdapter();
    const live = { ebay: ebay.adapter };
    await setChannelMode(sql, live, "ebay", "LIVE", ACTOR);
    const o = await offer({ quantity: 2, price: 2500 });

    const first = await publishListing(sql, live, { offerId: o.id, channel: "ebay", actor: ACTOR });
    expect(ebay.calls.published[0]).toMatchObject({ offerSku: o.sku, priceCents: 2500, quantity: 2, condition: "NM", imageUrls: [expect.stringContaining("scan-")] });
    expect(ebay.calls.published[0]!.title).toMatch(/^Carte \d+ /);
    expect(first).toMatchObject({ status: "ACTIVE", externalId: `EB-${o.sku}`, url: `https://ebay.test/${o.sku}`, priceCents: 2500, quantitySent: 2, simulated: false });

    await sql`update offers set target_price_cents = 3000 where id = ${o.id}`;
    const second = await publishListing(sql, live, { offerId: o.id, channel: "ebay", actor: ACTOR });
    expect([second.id, second.priceCents]).toEqual([first.id, 3000]);

    await endListing(sql, live, { listingId: first.id, actor: ACTOR });
    expect(ebay.calls.ended).toEqual([`EB-${o.sku}`]);
    expect(await listingOf(o.id)).toBeUndefined();
  });
});

describe("keeping channels in step with the stock", () => {
  it("lowers the listed quantity after a direct sale and pauses the listing when nothing is left", async () => {
    const ebay = fakeAdapter();
    const live = { ebay: ebay.adapter };
    await setChannelMode(sql, live, "ebay", "LIVE", ACTOR);
    const o = await offer({ quantity: 2 });
    await publishListing(sql, live, { offerId: o.id, channel: "ebay", actor: ACTOR });
    expect(await syncQuantities(sql, live)).toEqual({ updated: 0, errors: 0 });

    const sale = (qty: number) => createDirectSale(sql, { lines: [{ offerId: o.id, qty, unitPriceCents: 1500 }], shippingMode: "HAND_DELIVERY", actor: ACTOR });
    await sale(1);
    expect(await syncQuantities(sql, live)).toEqual({ updated: 1, errors: 0 });
    expect(ebay.calls.quantities).toEqual([[o.sku, 1]]);
    await sale(1);
    await syncQuantities(sql, live);
    expect(ebay.calls.quantities.at(-1)).toEqual([o.sku, 0]);
    const [paused] = await sql`select status, quantity_sent from listings where offer_id = ${o.id}`;
    expect(paused).toMatchObject({ status: "PAUSED", quantitySent: 0 });
  });

  it("keeps a failed update visible and retries it at the next sync", async () => {
    const ebay = fakeAdapter();
    const live = { ebay: ebay.adapter };
    await setChannelMode(sql, live, "ebay", "LIVE", ACTOR);
    const o = await offer({ quantity: 2 });
    await publishListing(sql, live, { offerId: o.id, channel: "ebay", actor: ACTOR });
    await createDirectSale(sql, { lines: [{ offerId: o.id, qty: 1, unitPriceCents: 1500 }], shippingMode: "HAND_DELIVERY", actor: ACTOR });

    ebay.fail(true);
    expect(await syncQuantities(sql, live)).toEqual({ updated: 0, errors: 1 });
    expect(await listingOf(o.id)).toMatchObject({ status: "ERROR", errorCode: "SYNC_FAILED", quantitySent: 2 });
    ebay.fail(false);
    expect(await syncQuantities(sql, live)).toEqual({ updated: 1, errors: 0 });
    expect(await listingOf(o.id)).toMatchObject({ status: "ACTIVE", errorCode: null, quantitySent: 1 });
  });
});

describe("orders coming from a channel", () => {
  const order = (sku: string, qty: number, id = "EB-1001"): ChannelOrder => ({
    externalId: id, orderedAt: new Date(), buyerName: "Camille", shippingChargedCents: 200, shippingMode: "LETTER_TRACKED",
    lines: [{ externalLineId: "1", offerSku: sku, qty, unitPriceCents: 1500 }],
  });

  it("imports an order once, reserves the cards, prepares the shipment and updates the listed quantity", async () => {
    const ebay = fakeAdapter();
    const live = { ebay: ebay.adapter };
    await setChannelMode(sql, live, "ebay", "LIVE", ACTOR);
    const o = await offer({ quantity: 3 });
    await publishListing(sql, live, { offerId: o.id, channel: "ebay", actor: ACTOR });

    ebay.pending.push(order(o.sku, 2), order(o.sku, 2)); // le canal renvoie deux fois la même commande
    expect(await syncChannels(sql, live, ACTOR)).toEqual({ orders: 1, updated: 1, errors: 0 });
    expect(ebay.calls.quantities).toEqual([[o.sku, 1]]);
    const [row] = await sql<{ id: string }[]>`select id from orders where channel = 'ebay'`;
    const detail = await getOrderDetail(sql, row!.id);
    expect(detail).toMatchObject({ channel: "ebay", externalId: "EB-1001", stage: "TO_PREPARE", oversold: false, grossCents: 3200, buyerName: "Camille", shippingMode: "LETTER_TRACKED" });
    expect((await listChannels(sql, live))[0]!.lastSyncedAt).toBeInstanceOf(Date);
  });

  it("flags an oversold channel order instead of refusing it", async () => {
    const o = await offer({ quantity: 1 });
    const result = await ingestChannelOrder(sql, "ebay", order(o.sku, 2, "EB-2002"), ACTOR);
    expect(result).toMatchObject({ created: true, oversold: true });
    expect((await getOrderDetail(sql, result.orderId)).oversold).toBe(true);
  });

  it("simulates a buyer on a simulated listing only", async () => {
    await setChannelMode(sql, {}, "cardtrader", "SIMULATION", ACTOR);
    const o = await offer({ quantity: 2, price: 900 });
    const listing = await publishListing(sql, {}, { offerId: o.id, channel: "cardtrader", actor: ACTOR });
    const { orderId, oversold } = await simulateOrder(sql, {}, { listingId: listing.id, qty: 1, actor: ACTOR });
    expect(oversold).toBe(false);
    expect(await getOrderDetail(sql, orderId)).toMatchObject({ channel: "cardtrader", externalId: "SIM-000001", grossCents: 900, buyerName: "Acheteur de test" });
    expect(await listingOf(o.id)).toMatchObject({ quantitySent: 1, status: "ACTIVE" });

    const ebay = fakeAdapter();
    await setChannelMode(sql, { ebay: ebay.adapter }, "ebay", "LIVE", ACTOR);
    const real = await publishListing(sql, { ebay: ebay.adapter }, { offerId: o.id, channel: "ebay", actor: ACTOR });
    await expect(simulateOrder(sql, { ebay: ebay.adapter }, { listingId: real.id, qty: 1, actor: ACTOR })).rejects.toMatchObject({ code: "NOT_SIMULATED" });
  });
});
