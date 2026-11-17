import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { createLocation, receiveCard } from "@dexlane/inventory";
import {
  DEFAULT_SETTINGS, getPricingSettings, listOfferPricing, quoteVariant, refreshOfferPricing, refreshPricing,
  savePricingSettings, setOfferPrice,
} from "../src";

const sql = useTestDb("pricing");
const ACTOR = "test";
let seq = 0;

/** Carte + variante + cotation tendance observée il y a `ageDays` jours. */
async function variant(trendCents: number | null, opts: { ageDays?: number; ambiguous?: boolean; name?: string } = {}) {
  const n = ++seq;
  const [card] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language) values ('base1', ${String(n)}, ${opts.name ?? `Carte ${n}`}, 'fr') returning id`;
  const [v] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish) values (${card!.id}, 'holo') returning id`;
  if (trendCents !== null) await quote(v!.id, trendCents, opts.ageDays ?? 1, opts.ambiguous);
  return v!.id;
}
const quote = (variantId: string, cents: number, ageDays = 0, ambiguous = false) => sql`
  insert into price_snapshots (variant_id, source, quote_type, currency, amount_cents, observed_at, variant_ambiguous)
  values (${variantId}, 'cardmarket', 'LISTED_TREND', 'EUR', ${cents}, now() - make_interval(secs => ${ageDays * 86400}), ${ambiguous})`;

async function stock(variantId: string, opts: { quantity?: number; cost?: number; condition?: "NM" | "EX" } = {}) {
  await createLocation(sql, { code: "BOX-01" });
  const r = await receiveCard(sql, {
    variantId, condition: opts.condition ?? "NM", quantity: opts.quantity ?? 1, location: { code: "BOX-01" },
    unitCostCents: opts.cost ?? 0, actor: ACTOR,
  });
  await refreshOfferPricing(sql, r.offer.id);
  return r.offer.id;
}
const offer = async (id: string) => (await listOfferPricing(sql, { offerId: id })).items[0]!;

describe("pricing an offer", () => {
  it("sets the target price from the reference on first pricing when nothing is in doubt", async () => {
    const id = await stock(await variant(2000), { condition: "EX", cost: 300 });
    expect(await offer(id)).toMatchObject({
      category: "SINGLE", targetPriceCents: 1600, suggestedPriceCents: 1600, floorPriceCents: 1300, priceSource: "AUTO",
      reasons: [], reference: { quoteType: "LISTED_TREND", amountCents: 2000 }, onHand: 1, averageCostCents: 300,
    });
  });

  it("leaves doubtful offers unpriced and in review, with the reason", async () => {
    const none = await stock(await variant(null));
    const stale = await stock(await variant(2000, { ageDays: 40 }));
    const ambiguous = await stock(await variant(2000, { ambiguous: true }));
    const grey = await stock(await variant(900));
    expect(await offer(none)).toMatchObject({ category: "REVIEW", targetPriceCents: null, reasons: ["NO_REFERENCE"], priceSource: "NONE" });
    expect(await offer(stale)).toMatchObject({ category: "REVIEW", targetPriceCents: null, suggestedPriceCents: 2000, reasons: ["STALE_REFERENCE"] });
    expect(await offer(ambiguous)).toMatchObject({ category: "REVIEW", targetPriceCents: null, reasons: ["AMBIGUOUS_REFERENCE"] });
    expect(await offer(grey)).toMatchObject({ category: "REVIEW", targetPriceCents: null, reasons: ["GREY_ZONE"] });
  });

  it("never moves a decided price by itself: a market move becomes a review reason", async () => {
    const v = await variant(2000);
    const id = await stock(v);
    await quote(v, 2200);
    await refreshOfferPricing(sql, id);
    expect(await offer(id)).toMatchObject({ targetPriceCents: 2000, suggestedPriceCents: 2200, reasons: [] });

    await quote(v, 3000, -0.001); // plus récente que la précédente
    expect(await refreshPricing(sql, { setId: "base1", language: "fr" })).toBe(1);
    expect(await offer(id)).toMatchObject({ targetPriceCents: 2000, suggestedPriceCents: 3000, reasons: ["DRIFT"], category: "SINGLE" });
  });

  it("raises the floor with the cost of newly received copies and flags a price below cost", async () => {
    const v = await variant(2000);
    const id = await stock(v, { cost: 500 });
    expect((await offer(id)).floorPriceCents).toBe(1600);
    await receiveCard(sql, { variantId: v, condition: "NM", quantity: 3, location: { code: "BOX-01" }, unitCostCents: 2500, actor: ACTOR });
    await refreshOfferPricing(sql, id);
    expect(await offer(id)).toMatchObject({ onHand: 4, averageCostCents: 2000, targetPriceCents: 2000, floorPriceCents: 2050, category: "REVIEW", reasons: ["BELOW_COST"] });
  });
});

describe("manual decision", () => {
  it("records the human price with an audit trail and keeps it through later recalculations", async () => {
    const v = await variant(900);
    const id = await stock(v, { cost: 100 });
    const priced = await setOfferPrice(sql, { offerId: id, targetPriceCents: 1000, category: "SINGLE", actor: ACTOR });
    expect(priced).toMatchObject({ targetPriceCents: 1000, floorPriceCents: 800, category: "SINGLE", priceSource: "MANUAL", reasons: [] });

    await refreshPricing(sql);
    expect(await offer(id)).toMatchObject({ targetPriceCents: 1000, category: "SINGLE", reasons: [] });
    await quote(v, 1500, -0.001);
    await refreshPricing(sql);
    expect(await offer(id)).toMatchObject({ targetPriceCents: 1000, suggestedPriceCents: 1500, category: "SINGLE", reasons: ["DRIFT"] });

    const [audit] = await sql`select actor, before, after from audit_events where action = 'offer_price_set'`;
    expect(audit).toMatchObject({ actor: ACTOR, before: { targetPriceCents: null, priceSource: "NONE" }, after: { targetPriceCents: 1000, category: "SINGLE" } });
  });

  it("rejects a floor above the target and negative prices", async () => {
    const id = await stock(await variant(2000));
    await expect(setOfferPrice(sql, { offerId: id, targetPriceCents: 1000, floorPriceCents: 1200, category: "SINGLE", actor: ACTOR }))
      .rejects.toMatchObject({ code: "FLOOR_ABOVE_TARGET" });
    await expect(setOfferPrice(sql, { offerId: id, targetPriceCents: -1, category: "SINGLE", actor: ACTOR })).rejects.toMatchObject({ code: "INVALID_PRICE" });
  });
});

describe("review queue and settings", () => {
  it("lists offers by value at stake and counts those to review", async () => {
    const cheap = await stock(await variant(300, { name: "Rattata" }), { quantity: 2 });
    const big = await stock(await variant(900, { name: "Dracaufeu" }), { quantity: 10 });
    const fine = await stock(await variant(2500, { name: "Mewtwo" }));

    const all = await listOfferPricing(sql);
    expect(all).toMatchObject({ allCount: 3, reviewCount: 1, total: 3 });
    expect(all.items.map((o) => o.offerId)).toEqual([big, fine, cheap]);
    const review = await listOfferPricing(sql, { status: "REVIEW" });
    expect(review.items.map((o) => o.card.name)).toEqual(["Dracaufeu"]);
    expect((await listOfferPricing(sql, { q: "mewt" })).items).toHaveLength(1);
  });

  it("applies new rules to every offer at once and validates them", async () => {
    const grey = await stock(await variant(900));
    expect((await offer(grey)).category).toBe("REVIEW");
    expect(await getPricingSettings(sql)).toEqual(DEFAULT_SETTINGS);

    const saved = await savePricingSettings(sql, { ...DEFAULT_SETTINGS, singleFromCents: 500 }, ACTOR);
    expect(saved.repriced).toBe(1);
    expect(await offer(grey)).toMatchObject({ category: "SINGLE", targetPriceCents: 900, reasons: [] });
    expect((await getPricingSettings(sql)).singleFromCents).toBe(500);
    await expect(savePricingSettings(sql, { ...DEFAULT_SETTINGS, lotBelowCents: 10 }, ACTOR)).rejects.toMatchObject({ code: "INVALID_PRICING_SETTINGS" });
  });

  it("previews a quote for a variant before any stock exists", async () => {
    const v = await variant(2000);
    expect(await quoteVariant(sql, v, "EX")).toMatchObject({ suggestedCents: 1600, category: "SINGLE", reasons: [], quotes: [{ quoteType: "LISTED_TREND", amountCents: 2000 }] });
    await expect(quoteVariant(sql, "00000000-0000-4000-8000-000000000000", "NM")).rejects.toMatchObject({ code: "VARIANT_NOT_FOUND" });
  });
});
