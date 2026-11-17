import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, computePricing, validateSettings, type PricingInput, type Quote } from "../src/rules";

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

  it("classifies by the spec's indicative thresholds", () => {
    const category = (cents: number, isUnique = false) => price({ quotes: [quote(cents)], isUnique }).category;
    expect([category(50), category(99)]).toEqual(["BULK", "BULK"]);
    expect([category(100), category(499)]).toEqual(["LOT", "LOT"]);
    expect([category(1500), category(9999)]).toEqual(["SINGLE", "SINGLE"]);
    expect(category(10000, true)).toBe("PREMIUM");
  });

  it("sends the 5–15 € grey zone to review instead of deciding", () => {
    expect(price({ quotes: [quote(800)] })).toMatchObject({ tier: "SINGLE", category: "REVIEW", reasons: ["GREY_ZONE"] });
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

  it("prefers the configured basis and falls back to another quote type", () => {
    const quotes = [quote(2000), quote(1800, { quoteType: "SOLD_AVG_30D" })];
    expect(price({ quotes }).reference).toMatchObject({ quoteType: "LISTED_TREND", amountCents: 2000, ageDays: 1 });
    expect(computePricing(input({ quotes }), { ...DEFAULT_SETTINGS, basis: "SOLD_AVG_30D" }).suggestedCents).toBe(1800);
    expect(price({ quotes: [quote(1800, { quoteType: "SOLD_AVG_7D" })] }).reference?.quoteType).toBe("SOLD_AVG_7D");
  });

  it("keeps the floor above cost plus margin, and reports a price that cannot cover it", () => {
    expect(price({ averageCostCents: 1700 })).toMatchObject({ floorCents: 1750, reasons: [] });
    expect(price({ averageCostCents: 2100 })).toMatchObject({ floorCents: 2150, category: "REVIEW", reasons: ["BELOW_COST"] });
  });

  it("does not demand a per-card margin on bulk and lot tiers, only that cost is covered", () => {
    expect(price({ quotes: [quote(28)], averageCostCents: 5 })).toMatchObject({ category: "BULK", floorCents: 22, reasons: [] });
    expect(price({ quotes: [quote(300)], averageCostCents: 280 })).toMatchObject({ category: "LOT", floorCents: 280, reasons: [] });
    expect(price({ quotes: [quote(28)], averageCostCents: 40 })).toMatchObject({ category: "REVIEW", reasons: ["BELOW_COST"] });
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
    expect(validateSettings({ ...DEFAULT_SETTINGS, conditionPercent: { ...DEFAULT_SETTINGS.conditionPercent, EX: 0 } })).not.toBeNull();
  });
});
