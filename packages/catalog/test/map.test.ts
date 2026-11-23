import { describe, expect, it } from "vitest";
import { mapTcgdexCard } from "../src";
import { card } from "./fixtures";

describe("mapTcgdexCard", () => {
  it("maps a common with normal and reverse variants (swsh3-136 Fouinar)", () => {
    const { card: c, variants } = mapTcgdexCard(card("swsh3-136"), "fr");
    expect(c).toMatchObject({ setId: "swsh3", localNumber: "136", name: "Fouinar", rarity: "Peu Commune", language: "fr" });
    expect(variants.map((v) => v.finish)).toEqual(["normal", "reverse"]);
    expect(variants.every((v) => !v.incomplete && v.tcgdexVariantId)).toBe(true);
  });

  it("reads reverse prices from Cardmarket's -holo fields", () => {
    const { variants } = mapTcgdexCard(card("swsh3-136"), "fr");
    const trend = (finish: string) =>
      variants.find((v) => v.finish === finish)!.prices.find((p) => p.quoteType === "LISTED_TREND")!.amountCents;
    expect(trend("normal")).toBe(9); // trend 0.09
    expect(trend("reverse")).toBe(28); // trend-holo 0.28
    // Normal et reverse partagent un produit Cardmarket mais pas les mêmes champs : pas d'ambiguïté.
    expect(variants.flatMap((v) => v.prices).some((p) => p.variantAmbiguous)).toBe(false);
  });

  it("separates 1st edition and flags prices shared between indistinguishable variants (base1-4 Dracaufeu)", () => {
    const { variants } = mapTcgdexCard(card("base1-4"), "fr");
    expect(variants.map((v) => [v.finish, v.subtype, v.edition])).toEqual([
      ["holo", "illimité", ""],
      ["holo", "sans ombre", "1st"],
      ["holo", "sans ombre", ""],
      ["holo", "Copyright 1999-2000", ""],
    ]);
    const [unlimited, shadowless1st, shadowless, copyright] = variants;
    expect(unlimited!.prices.every((p) => !p.variantAmbiguous)).toBe(true);
    // 1re édition et sans ombre partagent le produit Cardmarket 660224 : prix non attribuables.
    expect(shadowless1st!.prices.length).toBeGreaterThan(0);
    expect([...shadowless1st!.prices, ...shadowless!.prices].every((p) => p.variantAmbiguous)).toBe(true);
    expect(copyright!.prices).toEqual([]);
  });

  it("never stores a zero price as a quote", () => {
    const { variants } = mapTcgdexCard(card("base1-4"), "fr");
    expect(variants.flatMap((v) => v.prices).every((p) => p.amountCents > 0)).toBe(true);
  });

  it("treats TCGdex placeholder variants as incomplete (me06-104, set released Nov. 2026)", () => {
    const { variants } = mapTcgdexCard(card("me06-104"), "fr");
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ tcgdexVariantId: null, incomplete: true });
    expect(variants[0]!.prices.every((p) => p.variantAmbiguous)).toBe(true);
  });

  it("marks promo cards (svp-001)", () => {
    const { variants } = mapTcgdexCard(card("svp-001"), "fr");
    expect(variants.every((v) => v.promo)).toBe(true);
  });

  it("falls back to variant flags, marked incomplete, when no detailed variants exist", () => {
    const src = card("swsh3-136");
    delete src.variants_detailed;
    const { variants } = mapTcgdexCard(src, "fr");
    expect(variants.map((v) => v.finish)).toEqual(["normal", "reverse"]);
    expect(variants.every((v) => v.incomplete && v.prices.length === 0)).toBe(true);
  });

  it("creates a single 'unknown' variant when the source says nothing", () => {
    const src = card("swsh3-136");
    delete src.variants_detailed;
    delete src.variants;
    const { variants } = mapTcgdexCard(src, "fr");
    expect(variants).toMatchObject([{ finish: "unknown", incomplete: true }]);
  });

  it("keeps duplicate natural keys distinct and flags them", () => {
    const src = card("swsh3-136");
    src.variants_detailed = [src.variants_detailed![0]!, { ...src.variants_detailed![0]!, variantId: "other" }];
    const { variants } = mapTcgdexCard(src, "fr");
    expect(variants.map((v) => v.subtype)).toEqual(["", "#2"]);
    expect(variants[1]!.incomplete).toBe(true);
  });

  it("adds the TCGplayer market price, in dollars, as a separate quote matched to the printing", () => {
    const market = (id: string, finish: string) =>
      mapTcgdexCard(card(id), "fr").variants.find((v) => v.finish === finish)!.prices.find((p) => p.quoteType === "MARKET");
    expect(market("swsh3-136", "normal")).toMatchObject({ source: "tcgplayer_via_tcgdex", currency: "USD", amountCents: 26 });
    expect(market("swsh3-136", "reverse")).toMatchObject({ amountCents: 40 });
    expect(market("sv03.5-151", "holo")).toMatchObject({ amountCents: 679 });
    // Les cotes Cardmarket restent en euros, à part.
    const cardmarket = mapTcgdexCard(card("swsh3-136"), "fr").variants[0]!.prices.filter((p) => p.quoteType !== "MARKET");
    expect(cardmarket.every((p) => p.currency === "EUR" && p.source === "cardmarket_price_guide_via_tcgdex")).toBe(true);
  });
});
