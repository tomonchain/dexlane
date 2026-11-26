import { describe, expect, it } from "vitest";
import { applyReprice, bundleDormant, countDormantCards, listDormantCards, previewReprice, withdrawDormant } from "../src";
import { ACTOR, daysFrom, fakeChannel, listedAt, makeOffer, sellAt, stockAt, useTestDb } from "./helpers";

const sql = useTestDb();
const now = new Date();

async function dormant(name: string, opts: { listedDaysAgo?: number; priceCents?: number; floorCents?: number } = {}) {
  const o = await makeOffer(sql, { name });
  await stockAt(sql, o.offerId, 2, daysFrom(now, -200));
  await listedAt(sql, o.offerId, daysFrom(now, -(opts.listedDaysAgo ?? 120)), { priceCents: opts.priceCents ?? 1000 });
  await sql`update offers set target_price_cents = ${opts.priceCents ?? 1000}, floor_price_cents = ${opts.floorCents ?? null} where id = ${o.offerId}`;
  return o;
}

describe("dormant cards (A3)", () => {
  it("lists cards online for more than 90 days, still in stock, never sold since listing", async () => {
    const sleeping = await dormant("Ronflex");
    await dormant("Récente", { listedDaysAgo: 30 });
    const sold = await dormant("Vendue");
    await sellAt(sql, sold.offerSku, daysFrom(now, -10));
    const empty = await dormant("Épuisée");
    await sql`update stock_items set on_hand = 0 where offer_id = ${empty.offerId}`;
    // Vendue avant sa mise en ligne actuelle : la vente ne compte pas, elle reste dormante.
    const relisted = await makeOffer(sql, { name: "Relistée" });
    await stockAt(sql, relisted.offerId, 3, daysFrom(now, -300));
    await sellAt(sql, relisted.offerSku, daysFrom(now, -250));
    await listedAt(sql, relisted.offerId, daysFrom(now, -100));

    const cards = await listDormantCards(sql);
    expect(cards.map((c) => c.name)).toEqual(["Ronflex", "Relistée"]);
    expect(cards[0]).toMatchObject({ offerId: sleeping.offerId, priceCents: 1000, daysOnline: 120, available: 2, channels: ["ebay"] });
    expect(cards[0]!.locations).toHaveLength(1);
    expect(await countDormantCards(sql)).toBe(2);
  });

  it("previews a price cut card by card, stops at the floor price, and changes nothing without confirmation", async () => {
    const a = await dormant("A", { priceCents: 1000 });
    const b = await dormant("B", { priceCents: 1000, floorCents: 900 });
    const preview = await previewReprice(sql, { offerIds: [a.offerId, b.offerId], percent: 20 });
    expect(preview.map((l) => [l.name, l.beforeCents, l.afterCents, l.atFloor])).toEqual([["A", 1000, 800, false], ["B", 1000, 900, true]]);
    const { live } = fakeChannel();
    await expect(applyReprice(sql, live, { offerIds: [a.offerId], percent: 20, confirm: false, actor: ACTOR })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    const [unchanged] = await sql<{ targetPriceCents: number }[]>`select target_price_cents from offers where id = ${a.offerId}`;
    expect(unchanged!.targetPriceCents).toBe(1000);

    const applied = await applyReprice(sql, live, { offerIds: [a.offerId, b.offerId], percent: 20, confirm: true, actor: ACTOR });
    expect(applied.repriced).toBe(2);
    const prices = await sql<{ targetPriceCents: number; priceSource: string }[]>`
      select target_price_cents, price_source from offers where id in ${sql([a.offerId, b.offerId])} order by target_price_cents`;
    expect(prices).toEqual([{ targetPriceCents: 800, priceSource: "MANUAL" }, { targetPriceCents: 900, priceSource: "MANUAL" }]);
    await expect(previewReprice(sql, { offerIds: [a.offerId], percent: 0 })).rejects.toMatchObject({ code: "INVALID_PERCENT" });
  });

  it("bundles dormant cards into a lot and withdraws others from sale after confirmation", async () => {
    const a = await dormant("A");
    const b = await dormant("B");
    const c = await dormant("C");
    await sql`insert into channel_settings (channel, mode) values ('ebay', 'LIVE')`;
    await sql`update listings set external_id = 'EB-' || id where offer_id = ${c.offerId}`;
    const { live, ended } = fakeChannel();

    const lot = await bundleDormant(sql, live, { offerIds: [a.offerId, b.offerId], title: "Lot de dormantes", priceCents: 1500, actor: ACTOR });
    expect(lot).toMatchObject({ title: "Lot de dormantes", cards: 4, status: "IN_STOCK" });
    expect((await listDormantCards(sql)).map((d) => d.name)).toEqual(["C"]);

    await expect(withdrawDormant(sql, live, { offerIds: [c.offerId], confirm: false, actor: ACTOR })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(await withdrawDormant(sql, live, { offerIds: [c.offerId], confirm: true, actor: ACTOR })).toEqual({ cards: 1, listingsEnded: 1 });
    expect(ended).toHaveLength(1);
    expect(await countDormantCards(sql)).toBe(0);
  });
});
