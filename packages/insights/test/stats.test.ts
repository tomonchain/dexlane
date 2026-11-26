import { describe, expect, it } from "vitest";
import { cancelOrder } from "@dexlane/inventory";
import { calendarPeriod, median, resolvePeriod, sellerStats, type Period } from "../src";
import { ACTOR, DAY, daysFrom, listedAt, makeOffer, sellAt, stockAt, useTestDb } from "./helpers";

const sql = useTestDb();
const TZ = "Europe/Paris";
// Période de référence : du 1er au 31 mars 2026, heure de Paris (fixée pour que les tests ne dépendent pas du jour).
const T0 = new Date("2026-03-01T00:00:00+01:00");
const T1 = new Date("2026-04-01T00:00:00+02:00");
const period: Period = { id: "month", label: "2026-03", start: T0, end: T1, timezone: TZ };

describe("seller statistics (A2)", () => {
  it("answers « — » (null) for every indicator on a period without data", async () => {
    const s = await sellerStats(sql, period);
    expect(s).toMatchObject({ revenue: null, margin: null, cardsSold: null, sellThroughPercent: null, medianDaysToSell: null, timeSaved: null, topSales: [] });
    expect(s.weekly.every((w) => w.cards === 0)).toBe(true);
  });

  it("sums revenue per currency, without conversion, and leaves cancelled, refunded and returned sales out", async () => {
    const a = await makeOffer(sql, { name: "Pikachu" });
    await stockAt(sql, a.offerId, 20, daysFrom(T0, -30), { costCents: 100 });
    await sellAt(sql, a.offerSku, daysFrom(T0, 2), { qty: 2, unitPriceCents: 1500 });
    await sellAt(sql, a.offerSku, daysFrom(T0, 3), { unitPriceCents: 2000, currency: "USD" });
    await sellAt(sql, a.offerSku, daysFrom(T0, 4), { unitPriceCents: 999, currency: "GBP" });
    const cancelled = await sellAt(sql, a.offerSku, daysFrom(T0, 5), { unitPriceCents: 5000 });
    await cancelOrder(sql, cancelled, ACTOR, "acheteur parti");
    const refunded = await sellAt(sql, a.offerSku, daysFrom(T0, 6), { unitPriceCents: 7000 });
    await sql`update orders set payment_status = 'REFUNDED' where id = ${refunded}`;
    const returned = await sellAt(sql, a.offerSku, daysFrom(T0, 7), { unitPriceCents: 9000 });
    await sql`insert into shipments (order_id, mode, status) values (${returned}, 'LETTER_UNTRACKED', 'RETURNED')`;
    // Hors période, et l'acheteur fictif de la simulation : ne comptent pas.
    await sellAt(sql, a.offerSku, daysFrom(T1, 1), { unitPriceCents: 4000 });
    await sellAt(sql, a.offerSku, daysFrom(T0, 8), { unitPriceCents: 4000, externalId: "SIM-000001" });

    const s = await sellerStats(sql, period);
    expect(s.revenue).toEqual([{ currency: "EUR", cents: 3000 }, { currency: "USD", cents: 2000 }, { currency: "GBP", cents: 999 }]);
    expect(s.cardsSold).toBe(4);
  });

  it("computes the margin on the lines whose purchase price is known, and says how much it covers", async () => {
    const known = await makeOffer(sql);
    const free = await makeOffer(sql); // collection personnelle : coût 0, mais connu (lot d'acquisition)
    const unknown = await makeOffer(sql); // coût jamais saisi
    await stockAt(sql, known.offerId, 5, daysFrom(T0, -10), { costCents: 300 });
    await stockAt(sql, free.offerId, 5, daysFrom(T0, -10), { lot: true });
    await stockAt(sql, unknown.offerId, 5, daysFrom(T0, -10));
    await sellAt(sql, known.offerSku, daysFrom(T0, 1), { qty: 2, unitPriceCents: 1000 });
    await sellAt(sql, free.offerSku, daysFrom(T0, 1), { unitPriceCents: 500 });
    await sellAt(sql, unknown.offerSku, daysFrom(T0, 1), { unitPriceCents: 800 });

    const s = await sellerStats(sql, period);
    // (2 × 10 € − 2 × 3 €) + (5 € − 0 €) ; la carte sans coût connu est laissée de côté.
    expect(s.margin).toEqual({ amounts: [{ currency: "EUR", cents: 1900 }], coveragePercent: 75, ebayFeesMissing: true });
  });

  it("does not flag missing eBay fees when only direct sales are counted", async () => {
    const o = await makeOffer(sql);
    await stockAt(sql, o.offerId, 2, daysFrom(T0, -10), { costCents: 100 });
    await sellAt(sql, o.offerSku, daysFrom(T0, 1), { channel: "direct" });
    expect((await sellerStats(sql, period)).margin?.ebayFeesMissing).toBe(false);
  });

  it("counts a lot as one card and takes the sell-through over units online at the start plus units listed during the period", async () => {
    const early = await makeOffer(sql);
    const fresh = await makeOffer(sql);
    const late = await makeOffer(sql);
    const lot = await makeOffer(sql, { kind: "LOT" });
    await stockAt(sql, early.offerId, 5, daysFrom(T0, -20));
    await listedAt(sql, early.offerId, daysFrom(T0, -10)); // en ligne au début : 5
    await stockAt(sql, fresh.offerId, 4, daysFrom(T0, 5));
    await listedAt(sql, fresh.offerId, daysFrom(T0, 6)); // mises en ligne pendant : 4
    await stockAt(sql, lot.offerId, 1, daysFrom(T0, 5));
    await listedAt(sql, lot.offerId, daysFrom(T0, 5)); // le lot : 1
    await stockAt(sql, late.offerId, 3, daysFrom(T0, -20));
    await listedAt(sql, late.offerId, daysFrom(T1, 2)); // en ligne après la période : ne compte pas
    await listedAt(sql, late.offerId, daysFrom(T0, 2), { simulated: true, channel: "cardtrader" }); // annonce simulée : ne compte pas
    await sellAt(sql, early.offerSku, daysFrom(T0, 10), { qty: 2 });
    await sellAt(sql, lot.offerSku, daysFrom(T0, 11));

    const s = await sellerStats(sql, period);
    expect(s.cardsSold).toBe(3);
    expect(s.sellThroughPercent).toBe(30); // 3 ÷ (5 + 4 + 1)
    expect(s.timeSaved).toEqual({ listings: 2, minutes: 8, minutesPerListing: 4 }); // annonces de mars publiées pour de vrai
  });

  it("takes the median delay between listing and sale, over units, with an even number of sales", async () => {
    const a = await makeOffer(sql);
    const b = await makeOffer(sql);
    const direct = await makeOffer(sql);
    await stockAt(sql, a.offerId, 5, daysFrom(T0, -20));
    await listedAt(sql, a.offerId, daysFrom(T0, -10));
    await stockAt(sql, b.offerId, 5, daysFrom(T0, 5));
    await listedAt(sql, b.offerId, daysFrom(T0, 6));
    await stockAt(sql, direct.offerId, 1, daysFrom(T0, -40));
    await sellAt(sql, a.offerSku, daysFrom(T0, 10), { qty: 2 }); // 20 jours, deux fois
    await sellAt(sql, b.offerSku, daysFrom(T0, 12)); // 6 jours
    await sellAt(sql, b.offerSku, daysFrom(T0, 14)); // 8 jours
    await sellAt(sql, direct.offerSku, daysFrom(T0, 3), { channel: "direct" }); // jamais en ligne : pas de délai

    const s = await sellerStats(sql, period);
    expect(s.medianDaysToSell).toBe(14); // médiane de [6, 8, 20, 20], pas la moyenne (13,5)
    expect(median([1, 2, 10])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("lists the ten best sales by price, with card and date", async () => {
    const o = await makeOffer(sql, { name: "Dracaufeu" });
    await stockAt(sql, o.offerId, 20, daysFrom(T0, -5));
    for (let i = 1; i <= 12; i++) await sellAt(sql, o.offerSku, daysFrom(T0, i), { unitPriceCents: i * 100 });
    const top = (await sellerStats(sql, period)).topSales;
    expect(top).toHaveLength(10);
    expect(top[0]).toMatchObject({ name: "Dracaufeu", unitPriceCents: 1200, qty: 1, currency: "EUR" });
    expect(top[0]!.soldAt).toEqual(daysFrom(T0, 12));
    expect(top.at(-1)!.unitPriceCents).toBe(300);
  });
});

describe("weekly series in Europe/Paris", () => {
  it("cuts weeks on Monday 0:00 local time across the autumn clock change", async () => {
    const o = await makeOffer(sql);
    await stockAt(sql, o.offerId, 10, new Date("2026-09-01T00:00:00Z"));
    // Le 25 octobre 2026, Paris repasse à UTC+1 à 3 h. 22 h 30 UTC = dimanche 23 h 30 ; 23 h 30 UTC = lundi 0 h 30.
    await sellAt(sql, o.offerSku, new Date("2026-10-25T22:30:00Z"));
    await sellAt(sql, o.offerSku, new Date("2026-10-25T23:30:00Z"), { qty: 2 });
    const october = await calendarPeriod(sql, "2026-10", TZ);
    expect(october.start).toEqual(new Date("2026-09-30T22:00:00Z"));
    expect(october.end).toEqual(new Date("2026-10-31T23:00:00Z"));
    const weeks = (await sellerStats(sql, october)).weekly;
    expect(weeks.map((w) => w.week)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(weeks.find((w) => w.week === "2026-10-19")!.cards).toBe(1);
    expect(weeks.find((w) => w.week === "2026-10-26")!.cards).toBe(2);
  });

  it("cuts weeks on Monday 0:00 local time across the spring clock change", async () => {
    const o = await makeOffer(sql);
    await stockAt(sql, o.offerId, 10, new Date("2026-02-01T00:00:00Z"));
    // Le 29 mars 2026, Paris passe à UTC+2 à 2 h. 21 h 30 UTC = dimanche 23 h 30 ; 22 h 30 UTC = lundi 0 h 30.
    await sellAt(sql, o.offerSku, new Date("2026-03-29T21:30:00Z"), { qty: 3 });
    await sellAt(sql, o.offerSku, new Date("2026-03-29T22:30:00Z"));
    const weeks = (await sellerStats(sql, period)).weekly;
    expect(weeks.find((w) => w.week === "2026-03-23")!.cards).toBe(3);
    expect(weeks.find((w) => w.week === "2026-03-30")!.cards).toBe(1);
  });

  it("resolves the selector periods in local time", async () => {
    const now = new Date("2026-11-26T10:00:00Z");
    expect(await resolvePeriod(sql, "this_month", TZ, now)).toMatchObject({ start: new Date("2026-10-31T23:00:00Z"), end: now });
    expect(await resolvePeriod(sql, "last_month", TZ, now)).toMatchObject({ start: new Date("2026-09-30T22:00:00Z"), end: new Date("2026-10-31T23:00:00Z") });
    const ninety = await resolvePeriod(sql, "90d", TZ, now);
    expect(Math.round((now.getTime() - ninety.start.getTime()) / DAY)).toBe(90); // aujourd'hui compris
    expect(ninety.start).toEqual(new Date("2026-08-28T22:00:00Z"));
    expect((await resolvePeriod(sql, "12m", TZ, now)).start).toEqual(new Date("2025-11-26T23:00:00Z"));
    await expect(resolvePeriod(sql, "90d", "Mars/Olympus", now)).rejects.toMatchObject({ code: "INVALID_TIMEZONE" });
  });
});
