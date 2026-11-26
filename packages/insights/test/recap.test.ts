import { describe, expect, it } from "vitest";
import { buildRecap, defaultShareOptions, generateDueRecaps, getRecap, listRecaps, shareCardModel, SHARE_FORMATS } from "../src";
import { listedAt, makeOffer, sellAt, stockAt, useTestDb } from "./helpers";
import { isShareFormat } from "../src";

const sql = useTestDb();
const TZ = "Europe/Paris";

async function october() {
  const a = await makeOffer(sql, { name: "Dracaufeu" });
  const b = await makeOffer(sql, { name: "Pikachu" });
  await stockAt(sql, a.offerId, 3, new Date("2026-09-01T00:00:00Z"));
  await stockAt(sql, b.offerId, 5, new Date("2026-10-05T00:00:00Z"));
  await listedAt(sql, a.offerId, new Date("2026-10-02T08:00:00Z"));
  await listedAt(sql, b.offerId, new Date("2026-10-06T08:00:00Z"));
  await sellAt(sql, a.offerSku, new Date("2026-10-20T10:00:00Z"), { unitPriceCents: 25000 });
  await sellAt(sql, b.offerSku, new Date("2026-10-06T20:00:00Z"), { qty: 2, unitPriceCents: 300 });
}

describe("monthly and yearly recaps (C1, C2)", () => {
  it("is generated on the 1st for the previous month, only when something was published or sold, once", async () => {
    expect(await generateDueRecaps(sql, { timezone: TZ, now: new Date("2026-11-01T06:00:00Z") })).toEqual([]);
    await october();
    expect(await generateDueRecaps(sql, { timezone: TZ, now: new Date("2026-11-01T06:00:00Z") })).toEqual(["2026-10"]);
    expect(await generateDueRecaps(sql, { timezone: TZ, now: new Date("2026-11-02T06:00:00Z") })).toEqual([]);
    expect((await listRecaps(sql)).map((r) => [r.period, r.kind, r.cardsSold])).toEqual([["2026-10", "month", 3]]);

    const recap = (await getRecap(sql, "2026-10"))!.data;
    expect(recap).toMatchObject({
      listingsPublished: 2, cardsSold: 3, revenue: [{ currency: "EUR", cents: 25600 }], timeSavedMinutes: 8,
      bestSale: { name: "Dracaufeu", unitPriceCents: 25000 },
      fastestSale: { name: "Pikachu", days: 0.5 },
      level: { level: 0 },
    });
  });

  it("adds the record month, the time saved and the achievements of the year in January", async () => {
    await october();
    await sql`insert into account_achievements (achievement, unlocked_at) values ('first_sale', '2026-10-21T00:00:00Z'), ('first_listing', '2025-12-01T00:00:00Z')`;
    const created = await generateDueRecaps(sql, { timezone: TZ, now: new Date("2027-01-01T08:00:00Z") });
    // Décembre est vide : pas de récap mensuel. L'année, elle, a des ventes.
    expect(created).toEqual(["2026"]);
    expect((await listRecaps(sql)).map((r) => r.period)).toEqual(["2026"]);
  });

  it("describes the year", async () => {
    await october();
    await sql`insert into account_achievements (achievement, unlocked_at) values ('first_sale', '2026-10-21T00:00:00Z'), ('first_listing', '2025-12-01T00:00:00Z')`;
    const year = await buildRecap(sql, "2026", TZ);
    expect(year).toMatchObject({ kind: "year", recordMonth: { month: "2026-10", cards: 3 }, timeSavedMinutes: 8, achievementsCount: 1 });
  });
});

describe("share image (C3)", () => {
  it("has the two formats and shows no amount by default", async () => {
    await october();
    const recap = await buildRecap(sql, "2026-10", TZ);
    expect(SHARE_FORMATS).toEqual({ post: { width: 1080, height: 1350 }, story: { width: 1080, height: 1920 } });
    expect(isShareFormat("story")).toBe(true);
    const card = shareCardModel(recap, defaultShareOptions("story"), { shopName: "Ma boutique", showProgression: true });
    expect(card).toMatchObject({ width: 1080, height: 1920, shopName: null, referralLink: null });
    expect(card.metrics.map((m) => m.key)).toEqual(["cardsSold", "timeSaved"]); // aucun succès ce mois-là : pas de « 0 succès »
    expect(shareCardModel({ ...recap, achievementsCount: 2, level: { ...recap.level, level: 3 } }, defaultShareOptions(), { showProgression: true }).metrics.map((m) => m.key))
      .toEqual(["cardsSold", "timeSaved", "achievements", "level"]);
    expect(card.bestSale).toEqual({ name: "Dracaufeu", unitPriceCents: null, currency: "EUR" });
    expect(JSON.stringify(card)).not.toMatch(/25000|25600|cents"?:\s*\d/);

    const withRevenue = shareCardModel(recap, { ...defaultShareOptions("post"), showRevenue: true, showShopName: true }, { shopName: "Ma boutique", showProgression: false });
    expect(withRevenue).toMatchObject({ width: 1080, height: 1350, shopName: "Ma boutique", bestSale: { unitPriceCents: 25000 } });
    expect(withRevenue.metrics.map((m) => m.key)).toEqual(["cardsSold", "timeSaved", "revenue"]); // progression masquée
  });
});
