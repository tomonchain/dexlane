import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { attachPhotos, createLocation, receiveCard, recordPhoto } from "@dexlane/inventory";
import {
  DEFAULT_LISTING_SETTINGS, cancelPublications, getSchedule, listStock, planPublications, publishListing, queuePublications, runDuePublications, saveListingSettings,
  setChannelMode, todayInParis, type ChannelAdapter, type PublishInput,
} from "../src";

const sql = useTestDb("listings");
const ACTOR = "test";
let seq = 0;
const today = todayInParis();
const day = (offset: number) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function ready(name: string, opts: { price?: number | null; photo?: boolean } = {}) {
  const n = ++seq;
  const [card] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language) values ('base1', ${String(n)}, ${name}, 'fr') returning id`;
  const [variant] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish) values (${card!.id}, 'holo') returning id`;
  await createLocation(sql, { code: "BOX-01" });
  const r = await receiveCard(sql, { variantId: variant!.id, condition: "NM", quantity: 1, location: { code: "BOX-01" }, unitCostCents: 0, actor: ACTOR });
  if (opts.price !== null) await sql`update offers set target_price_cents = ${opts.price ?? 1000}, category = 'SINGLE' where id = ${r.offer.id}`;
  if (opts.photo !== false) {
    const scan = await recordPhoto(sql, { kind: "SCAN_FRONT", storageKey: `scan-${n}`, url: `https://blob.test/scan-${n}.jpg`, contentType: "image/jpeg", byteSize: 1 });
    await attachPhotos(sql, [scan.id], { stockItemId: r.stockItem.id, offerId: r.offer.id });
  }
  return r.offer.id;
}

describe("queueing publications one card after another", () => {
  it("publishes the same day, or fills each day up to the daily rate without moving what is already planned", async () => {
    await expect(queuePublications(sql, { offerIds: [await ready("Z")], channel: "ebay", perDay: null, actor: ACTOR })).rejects.toMatchObject({ code: "CHANNEL_DISABLED" });
    await setChannelMode(sql, {}, "ebay", "SIMULATION", ACTOR);
    const ids = [await ready("A"), await ready("B"), await ready("C"), await ready("D")];
    const unpriced = await ready("Sans prix", { price: null });

    // Deux par jour : A et B aujourd'hui, C demain ; la carte sans prix est laissée de côté.
    expect(await queuePublications(sql, { offerIds: [ids[0]!, ids[1]!, ids[2]!, unpriced], channel: "ebay", perDay: 2, actor: ACTOR })).toEqual({ queued: 3, lastDay: day(1) });
    // Une carte arrivée ensuite prend la place libre du lendemain ; une carte déjà en file n'est pas doublée.
    expect(await queuePublications(sql, { offerIds: [ids[2]!, ids[3]!], channel: "ebay", perDay: 2, actor: ACTOR })).toEqual({ queued: 1, lastDay: day(1) });
    expect((await getSchedule(sql)).days).toEqual([
      { plannedOn: today, channel: "ebay", count: 2, cardNames: ["A", "B"] },
      { plannedOn: day(1), channel: "ebay", count: 2, cardNames: ["C", "D"] },
    ]);

    // Les publications faites dans la journée comptent dans le rythme du jour.
    expect(await runDuePublications(sql, {}, ACTOR)).toEqual({ published: 2, failed: 0 });
    const late = await ready("E");
    expect(await queuePublications(sql, { offerIds: [late], channel: "ebay", perDay: 2, actor: ACTOR })).toEqual({ queued: 1, lastDay: day(2) });
    // Sans rythme : le jour même, quel que soit le nombre déjà publié ; une carte déjà en ligne n'est pas remise en file.
    const now = await ready("F");
    expect(await queuePublications(sql, { offerIds: [now, ids[0]!], channel: "ebay", perDay: null, actor: ACTOR })).toEqual({ queued: 1, lastDay: today });
    expect(await queuePublications(sql, { offerIds: [], channel: "ebay", perDay: null, actor: ACTOR })).toEqual({ queued: 0, lastDay: null });
  });
});

describe("scheduling publications", () => {
  it("spreads ready offers over consecutive days in stock order and skips what cannot be listed", async () => {
    await setChannelMode(sql, {}, "ebay", "SIMULATION", ACTOR);
    const ids = [await ready("A"), await ready("B"), await ready("C"), await ready("D"), await ready("E")];
    await ready("Sans prix", { price: null });
    await publishListing(sql, {}, { offerId: ids[4]!, channel: "ebay", actor: ACTOR }); // déjà en ligne

    const plan = await planPublications(sql, { channel: "ebay", startOn: day(1), perDay: 2, actor: ACTOR });
    expect(plan).toEqual({ planned: 4, days: 2, firstDay: day(1), lastDay: day(2), skipped: 0 });
    expect((await getSchedule(sql)).days).toEqual([
      { plannedOn: day(1), channel: "ebay", count: 2, cardNames: ["A", "B"] },
      { plannedOn: day(2), channel: "ebay", count: 2, cardNames: ["C", "D"] },
    ]);
    const stock = await listStock(sql, { sort: "name" });
    expect(stock.items.find((r) => r.name === "A")!.planned).toMatchObject({ channel: "ebay", plannedOn: day(1) });
    expect(stock.items.find((r) => r.name === "E")!.planned).toBeNull();

    // Replanifier une sélection déplace les dates au lieu de doubler les publications.
    const again = await planPublications(sql, { offerIds: [ids[3]!, ids[0]!, ids[4]!], channel: "ebay", startOn: day(5), perDay: 1, actor: ACTOR });
    expect(again).toMatchObject({ planned: 2, days: 2, skipped: 1 });
    expect((await getSchedule(sql)).pending).toBe(4);
    expect((await listStock(sql, { sort: "name" })).items.find((r) => r.name === "D")!.planned!.plannedOn).toBe(day(5));

    expect(await cancelPublications(sql, { plannedOn: day(1) })).toBe(1);
    expect((await getSchedule(sql)).pending).toBe(3);
  });

  it("refuses a past start, an absurd pace or a switched-off channel", async () => {
    await ready("A");
    await expect(planPublications(sql, { channel: "ebay", startOn: day(1), perDay: 5, actor: ACTOR })).rejects.toMatchObject({ code: "CHANNEL_DISABLED" });
    await setChannelMode(sql, {}, "ebay", "SIMULATION", ACTOR);
    await expect(planPublications(sql, { channel: "ebay", startOn: day(-1), perDay: 5, actor: ACTOR })).rejects.toMatchObject({ code: "INVALID_SCHEDULE" });
    await expect(planPublications(sql, { channel: "ebay", startOn: day(0), perDay: 0, actor: ACTOR })).rejects.toMatchObject({ code: "INVALID_SCHEDULE" });
  });

  it("publishes what is due, keeps the rest for its day, and reports what could not be listed", async () => {
    const published: PublishInput[] = [];
    const ebay: ChannelAdapter = {
      publish: async (input) => (published.push(input), { externalId: `EB-${input.offerSku}`, url: null }),
      setQuantity: async () => undefined, end: async () => undefined, fetchOrders: async () => [],
    };
    const live = { ebay };
    await setChannelMode(sql, live, "ebay", "LIVE", ACTOR);
    const promo = await recordPhoto(sql, { kind: "PROMO", storageKey: "promo", url: "https://blob.test/promo.jpg", contentType: "image/jpeg", byteSize: 1 });
    await saveListingSettings(sql, { ...DEFAULT_LISTING_SETTINGS, promoPhotoId: promo.id }, ACTOR);

    const a = await ready("A");
    const noPhoto = await ready("Sans photo", { photo: false });
    await ready("C");
    await planPublications(sql, { channel: "ebay", startOn: day(0), perDay: 2, actor: ACTOR });

    expect(await runDuePublications(sql, live, ACTOR)).toEqual({ published: 1, failed: 1 });
    // Les photos de la carte d'abord, l'image commerciale en dernier.
    expect(published[0]!.imageUrls).toEqual([expect.stringContaining("scan-"), "https://blob.test/promo.jpg"]);
    const schedule = await getSchedule(sql);
    expect(schedule.days).toEqual([{ plannedOn: day(1), channel: "ebay", count: 1, cardNames: ["C"] }]);
    expect(schedule.failed).toMatchObject([{ offerId: noPhoto, cardName: "Sans photo", errorCode: "LISTING_NOT_READY" }]);
    expect((await listStock(sql, { sort: "name" })).items.find((r) => r.offerId === a)).toMatchObject({ status: "LISTED", planned: null });

    // Le lendemain, la suite part ; rejouer la tâche le même jour ne publie rien deux fois.
    expect(await runDuePublications(sql, live, ACTOR, day(1))).toEqual({ published: 1, failed: 0 });
    expect(await runDuePublications(sql, live, ACTOR, day(1))).toEqual({ published: 0, failed: 0 });
    expect(published).toHaveLength(2);
  });
});
