import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, computePricing, marketBand, marketPrice, salesEstimate, validateSettings, type PricingInput, type Quote } from "../src/rules";

const now = new Date("2026-11-17T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 3600 * 1000);
const quote = (amountCents: number, over: Partial<Quote> = {}): Quote => ({
  quoteType: "LISTED_TREND", amountCents, observedAt: daysAgo(1), variantAmbiguous: false, ...over,
});
const input = (over: Partial<PricingInput> = {}): PricingInput => ({
  condition: "NM", isUnique: false, variantIncomplete: false, averageCostCents: 0, quotes: [quote(2000)],
  current: { priceSource: "NONE", targetPriceCents: null }, now, ...over,
});
const price = (over: Partial<PricingInput> = {}) => computePricing(input(over), DEFAULT_SETTINGS);

describe("computePricing", () => {
  it("applies the condition coefficient to the reference and derives category and floor", () => {
    expect(price()).toMatchObject({ suggestedCents: 2000, tier: "SINGLE", category: "SINGLE", floorCents: 1600, reasons: [] });
    expect(price({ condition: "EX" })).toMatchObject({ suggestedCents: 1600, category: "SINGLE" });
    expect(price({ condition: "PO" })).toMatchObject({ suggestedCents: 400, category: "LOT" });
  });

  it("rounds computed prices to whole euros from 10 €, and leaves cheaper ones to the cent", () => {
    expect(price({ quotes: [quote(61237)], isUnique: true })).toMatchObject({ suggestedCents: 61200, floorCents: 49000 });
    expect(price({ quotes: [quote(61237)], isUnique: true, condition: "EX" }).suggestedCents).toBe(49000); // 489,90 € → 490 €
    expect(price({ quotes: [quote(1050)] }).suggestedCents).toBe(1100);
    expect(price({ quotes: [quote(1049)] }).suggestedCents).toBe(1000);
    expect(price({ quotes: [quote(999)] }).suggestedCents).toBe(999);
    expect(price({ quotes: [quote(808)] }).suggestedCents).toBe(808);
    // Pas réglable : aux 5 €.
    expect(computePricing(input({ quotes: [quote(61237)], isUnique: true }), { ...DEFAULT_SETTINGS, roundStepCents: 500 }).suggestedCents).toBe(61000);
    // Le plancher imposé par le coût n'est jamais arrondi vers le bas.
    expect(price({ quotes: [quote(2000)], averageCostCents: 1733 }).floorCents).toBe(1783);
  });

  it("classifies by the spec's indicative thresholds", () => {
    const category = (cents: number, isUnique = false) => price({ quotes: [quote(cents)], isUnique }).category;
    expect([category(50), category(99)]).toEqual(["BULK", "BULK"]);
    expect([category(100), category(499)]).toEqual(["LOT", "LOT"]);
    expect([category(1500), category(9949)]).toEqual(["SINGLE", "SINGLE"]);
    expect(category(9950, true)).toBe("PREMIUM"); // 99,50 € s'arrondit à 100 €
    expect(category(10000, true)).toBe("PREMIUM");
  });

  it("prices the 5–15 € range on its own like any other single", () => {
    expect(price({ quotes: [quote(800)] })).toMatchObject({ tier: "SINGLE", category: "SINGLE", suggestedCents: 800, reasons: [] });
  });

  it("flags a premium value on an interchangeable offer without blocking it", () => {
    expect(price({ quotes: [quote(15000)] })).toMatchObject({ category: "PREMIUM", reasons: ["PREMIUM_NOT_UNIQUE"] });
  });

  it("never prices from a missing, stale or ambiguous quote without review", () => {
    expect(price({ quotes: [] })).toMatchObject({ suggestedCents: null, category: "REVIEW", reasons: ["NO_REFERENCE"] });
    expect(price({ quotes: [quote(2000, { observedAt: daysAgo(15) })] })).toMatchObject({ category: "REVIEW", reasons: ["STALE_REFERENCE"] });
    expect(price({ quotes: [quote(2000, { observedAt: daysAgo(14) })] }).reasons).toEqual([]);
    expect(price({ quotes: [quote(2000, { variantAmbiguous: true })] }).reasons).toEqual(["AMBIGUOUS_REFERENCE"]);
    expect(price({ variantIncomplete: true }).reasons).toEqual(["VARIANT_INCOMPLETE"]);
  });

  it("estimates from successful sales: the month gives the base, the week the direction", () => {
    const sold = (week: number | null, month: number | null, day: number | null = null) => [
      ...(week === null ? [] : [quote(week, { quoteType: "SOLD_AVG_7D" })]),
      ...(month === null ? [] : [quote(month, { quoteType: "SOLD_AVG_30D" })]),
      ...(day === null ? [] : [quote(day, { quoteType: "SOLD_AVG_1D" })]),
    ];
    // Semaine 9 €, mois 10 € : à mi-chemin, ventes régulières et prix stable.
    expect(salesEstimate(sold(900, 1000))).toMatchObject({ cents: 950, confidence: "HIGH" });
    // Une vente atypique à 30 € dans la semaine ne déplace pas l'estimation de plus de 20 % au-dessus du mois.
    expect(salesEstimate(sold(3000, 1200))).toMatchObject({ cents: 1440, confidence: "MEDIUM" });
    expect(salesEstimate(sold(400, 1000))).toMatchObject({ cents: 800, confidence: "MEDIUM" });
    // La veille repose sur trop peu de ventes : montrée, mais sans effet sur le chiffre.
    const withDay = salesEstimate(sold(900, 1000, 2500))!;
    expect(withDay.cents).toBe(950);
    expect(withDay.sales).toEqual([
      { quoteType: "SOLD_AVG_7D", amountCents: 900 }, { quoteType: "SOLD_AVG_30D", amountCents: 1000 }, { quoteType: "SOLD_AVG_1D", amountCents: 2500 },
    ]);
    // Une seule période renseignée : peu de ventes, fiabilité faible.
    expect(salesEstimate(sold(null, 1000))).toMatchObject({ cents: 1000, confidence: "LOW" });
    expect(salesEstimate(sold(null, null, 700))).toMatchObject({ cents: 700, confidence: "LOW" });
    expect(salesEstimate([quote(2000)])).toBeNull(); // la tendance des annonces n'est pas une vente
  });

  it("bases the price on successful sales, and on listings only when nothing sold recently", () => {
    const quotes = [quote(2000), quote(1800, { quoteType: "SOLD_AVG_30D" }), quote(1600, { quoteType: "SOLD_AVG_7D" })];
    expect(price({ quotes })).toMatchObject({
      reference: { quoteType: "SOLD_ESTIMATE", amountCents: 1700, ageDays: 1 }, sales: { cents: 1700, confidence: "HIGH" }, suggestedCents: 1700,
    });
    expect(price({ quotes: [quote(2000), quote(1500, { quoteType: "LISTED_LOW" })] })).toMatchObject({
      reference: { quoteType: "LISTED_TREND", amountCents: 2000 }, sales: null, suggestedCents: 2000,
    });
    expect(price({ quotes: [quote(1500, { quoteType: "LISTED_LOW" })] }).reference?.quoteType).toBe("LISTED_LOW");
  });

  it("ignores a sales average the latest reading no longer reports", () => {
    // Il y a 20 jours la carte se vendait 30 € ; le dernier relevé ne rapporte plus aucune vente, seulement une tendance.
    const quotes = [quote(3000, { quoteType: "SOLD_AVG_7D", observedAt: daysAgo(20) }), quote(1000)];
    expect(price({ quotes })).toMatchObject({ reference: { quoteType: "LISTED_TREND", amountCents: 1000 }, sales: null, suggestedCents: 1000, reasons: [] });
    // Des ventes relevées il y a trop longtemps ne fondent pas un prix sans revue.
    const old = [quote(1800, { quoteType: "SOLD_AVG_30D", observedAt: daysAgo(15) }), quote(1600, { quoteType: "SOLD_AVG_7D", observedAt: daysAgo(15) })];
    expect(price({ quotes: old })).toMatchObject({ category: "REVIEW", reasons: ["STALE_REFERENCE"] });
    expect(price({ quotes: [quote(1800, { quoteType: "SOLD_AVG_30D", variantAmbiguous: true })] }).reasons).toEqual(["AMBIGUOUS_REFERENCE"]);
  });

  it("keeps the floor above cost plus margin, and reports a price that cannot cover it", () => {
    expect(price({ averageCostCents: 1700 })).toMatchObject({ floorCents: 1750, reasons: [] });
  });

  it("never suggests a price under the purchase cost: it holds the price at cost and says the card will sell slowly", () => {
    // Marché à 20 €, acheté 21 € : prix tenu à 21 € + marge minimale, arrondi à l'euro supérieur.
    expect(price({ averageCostCents: 2100 })).toMatchObject({ suggestedCents: 2200, floorCents: 2150, category: "SINGLE", reasons: ["HELD_AT_COST"] });
    expect(price({ averageCostCents: 0 }).reasons).toEqual([]); // coût inconnu : rien à protéger
    // Un prix décidé à la main sous le coût n'est pas modifié, il est signalé.
    expect(price({ averageCostCents: 2100, current: { priceSource: "MANUAL", targetPriceCents: 1900 } }).reasons).toEqual(["BELOW_COST"]);
  });

  it("places the price around the sales estimate according to the strategy", () => {
    // Annonce la moins chère 8 €, ventes de la semaine 9 €, du mois 10 €, tendance 10,40 €.
    const quotes = [quote(1040), quote(1000, { quoteType: "SOLD_AVG_30D" }), quote(900, { quoteType: "SOLD_AVG_7D" }), quote(800, { quoteType: "LISTED_LOW" })];
    expect(marketBand(quotes)).toEqual({ marketCents: 950, liquidCents: 900, richCents: 1000, lowCents: 800 });
    const at = (strategy: "FAST" | "BALANCED" | "MARGIN", over: Partial<PricingInput> = {}) => computePricing(input({ quotes, ...over }), { ...DEFAULT_SETTINGS, strategy }).suggestedCents;
    expect(at("FAST")).toBe(810); // s'aligne sur le moins cher, sans brader de plus de 10 % sous la valeur liquide
    expect(at("BALANCED")).toBe(950); // le prix des ventes réussies
    expect(at("MARGIN")).toBe(1000); // la plus haute des moyennes de ventes
    expect(at("BALANCED", { condition: "EX" })).toBe(760); // 80 % pour un état « Excellent »
    // Quelle que soit la stratégie, jamais sous le prix d'achat.
    expect(at("FAST", { averageCostCents: 950 })).toBe(1000);
  });

  it("keeps fast and margin prices within 15 % of the sales estimate, and falls back to listings without sales", () => {
    // Semaine à 30 €, mois à 12 € : estimation 14,40 €, fourchette bornée à ±15 %.
    expect(marketBand([quote(1000), quote(3000, { quoteType: "SOLD_AVG_7D" }), quote(1200, { quoteType: "SOLD_AVG_30D" })]))
      .toEqual({ marketCents: 1440, liquidCents: 1224, richCents: 1656, lowCents: null });
    expect(marketBand([quote(1000), quote(700, { quoteType: "LISTED_LOW" })])).toEqual({ marketCents: 1000, liquidCents: 1000, richCents: 1000, lowCents: 700 });
    expect(marketBand([quote(700, { quoteType: "LISTED_LOW" })])).toEqual({ marketCents: 700, liquidCents: 700, richCents: 700, lowCents: 700 });
    expect(marketBand([])).toBeNull();
    expect(marketPrice({ marketCents: 1000, liquidCents: 1000, richCents: 1000, lowCents: 1200 }, "FAST")).toBe(1000); // pas d'annonce moins chère : inutile de baisser
  });

  it("does not demand a per-card margin on bulk and lot tiers, only that cost is covered", () => {
    expect(price({ quotes: [quote(28)], averageCostCents: 5 })).toMatchObject({ category: "BULK", floorCents: 22, reasons: [] });
    expect(price({ quotes: [quote(300)], averageCostCents: 280 })).toMatchObject({ category: "LOT", floorCents: 280, reasons: [] });
    expect(price({ quotes: [quote(28)], averageCostCents: 40 })).toMatchObject({ category: "BULK", suggestedCents: 40, reasons: ["HELD_AT_COST"] });
  });

  it("reports drift on a decided price but leaves a manual decision otherwise alone", () => {
    const auto = { priceSource: "AUTO" as const, targetPriceCents: 2000 };
    expect(price({ current: auto, quotes: [quote(2300)] }).reasons).toEqual([]);
    expect(price({ current: auto, quotes: [quote(2500)] }).reasons).toEqual(["DRIFT"]);

    const manual = { priceSource: "MANUAL" as const, targetPriceCents: 900 };
    expect(price({ current: manual, quotes: [quote(800, { variantAmbiguous: true })] }).reasons).toEqual([]);
    expect(price({ current: manual, quotes: [quote(2000)] })).toMatchObject({ reasons: ["DRIFT"], category: "SINGLE" });
    expect(price({ current: manual, quotes: [] }).reasons).toEqual([]);
  });
});

describe("validateSettings", () => {
  it("accepts the defaults and rejects inconsistent thresholds", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toBeNull();
    expect(validateSettings({ ...DEFAULT_SETTINGS, lotBelowCents: 50 })).toMatch(/increasing/);
    expect(validateSettings({ ...DEFAULT_SETTINGS, floorPercent: 120 })).not.toBeNull();
    expect(validateSettings({ ...DEFAULT_SETTINGS, roundStepCents: 0 })).not.toBeNull();
    expect(validateSettings({ ...DEFAULT_SETTINGS, conditionPercent: { ...DEFAULT_SETTINGS.conditionPercent, EX: 0 } })).not.toBeNull();
  });
});
