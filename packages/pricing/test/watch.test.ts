import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { createLocation, receiveCard } from "@dexlane/inventory";
import { findDeals, listWatched, saveAlertSettings, trendingCards, unwatchCard, updateWatched, watchCard } from "../src";

const sql = useTestDb("pricing");
let seq = 0;

/** Carte du catalogue avec un relevé : ventes sur 7 et 30 jours, annonce la moins chère, et le prix TCGplayer en dollars. */
async function card(name: string, reading: { week?: number; month?: number; low?: number; trend?: number; usd?: number; ageDays?: number; ambiguous?: boolean } = {}) {
  const n = ++seq;
  const [c] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language) values ('base1', ${String(n)}, ${name}, 'fr') returning id`;
  const [v] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish) values (${c!.id}, 'holo') returning id`;
  const at = sql`now() - make_interval(secs => ${(reading.ageDays ?? 1) * 86400})`;
  const add = (type: string, cents: number | undefined, currency = "EUR") => cents === undefined ? null : sql`
    insert into price_snapshots (variant_id, source, quote_type, currency, amount_cents, observed_at, variant_ambiguous)
    values (${v!.id}, ${currency === "USD" ? "tcgplayer" : "cardmarket"}, ${type}, ${currency}, ${cents}, ${at}, ${reading.ambiguous ?? false})`;
  await add("SOLD_AVG_7D", reading.week);
  await add("SOLD_AVG_30D", reading.month);
  await add("LISTED_LOW", reading.low);
  await add("LISTED_TREND", reading.trend);
  await add("MARKET", reading.usd, "USD");
  return v!.id;
}
/** Ajoute la moyenne des ventes de la veille au relevé du jour d'une carte : elle s'est vendue hier. */
const old0 = (variantId: string, _: { day: number }) => sql`
  insert into price_snapshots (variant_id, source, quote_type, currency, amount_cents, observed_at, variant_ambiguous)
  select variant_id, source, 'SOLD_AVG_1D', currency, amount_cents, observed_at, variant_ambiguous
    from price_snapshots where variant_id = ${variantId} and quote_type = 'SOLD_AVG_7D'`;
const old = (variantId: string, type: string, cents: number, ageDays: number) => sql`
  insert into price_snapshots (variant_id, source, quote_type, currency, amount_cents, observed_at)
  values (${variantId}, 'cardmarket', ${type}, 'EUR', ${cents}, now() - make_interval(secs => ${ageDays * 86400}))`;

describe("watched cards", () => {
  it("shows each platform's price, alerts when the cheapest listing reaches the target or the price moves", async () => {
    const dracaufeu = await card("Dracaufeu", { week: 46000, month: 44000, low: 39000, trend: 47000, usd: 52000 });
    const mew = await card("Mew", { week: 1500, month: 1450, low: 1300 });
    await old(dracaufeu, "SOLD_AVG_7D", 35000, 10); // il y a dix jours, la carte se vendait 350 €

    const watched = await watchCard(sql, { variantId: dracaufeu, targetCents: 40000 });
    await watchCard(sql, { variantId: mew });
    // Suivre une carte déjà suivie met seulement à jour son prix cible.
    expect((await watchCard(sql, { variantId: dracaufeu, targetCents: 38000 })).id).toBe(watched.id);
    await expect(watchCard(sql, { variantId: crypto.randomUUID() })).rejects.toMatchObject({ code: "VARIANT_NOT_FOUND" });
    await expect(watchCard(sql, { variantId: mew, targetCents: 0 })).rejects.toMatchObject({ code: "INVALID_PRICE" });

    let list = await listWatched(sql);
    expect(list.items.map((i) => i.card.name)).toEqual(["Mew", "Dracaufeu"]);
    const draco = list.items[1]!;
    expect(draco).toMatchObject({
      targetCents: 38000, owned: 0,
      cardmarket: { sales: { cents: 45000, confidence: "HIGH" }, lowCents: 39000, trendCents: 47000, ambiguous: false },
      tcgplayer: { marketCents: 52000 },
      change: { fromCents: 35000, toCents: 46000, percent: 31.4, windowDays: 7, basis: "SOLD_AVG_7D" },
    });
    // 390 € > cible de 380 € : pas d'alerte de cible ; +31 % en 7 jours : alerte de variation.
    expect(draco.alerts).toEqual(["PRICE_MOVE"]);
    expect(list.alerts).toBe(1);

    await updateWatched(sql, watched.id, { targetCents: 40000, note: " à acheter avant Noël " });
    await saveAlertSettings(sql, { windowDays: 7, percent: 50, minChangeCents: 100 });
    list = await listWatched(sql);
    expect(list.items[1]).toMatchObject({ targetCents: 40000, note: "à acheter avant Noël", alerts: ["TARGET_REACHED"] });
    await updateWatched(sql, watched.id, { targetCents: null });
    expect((await listWatched(sql)).items[1]!.targetCents).toBeNull();

    // Une carte suivie et en stock le dit.
    await createLocation(sql, { code: "BOX-01" });
    await receiveCard(sql, { variantId: mew, condition: "NM", quantity: 2, location: { code: "BOX-01" }, unitCostCents: 0, actor: "test" });
    expect((await listWatched(sql)).items[0]!.owned).toBe(2);

    await unwatchCard(sql, watched.id);
    expect((await listWatched(sql)).items).toHaveLength(1);
    await expect(unwatchCard(sql, watched.id)).rejects.toMatchObject({ code: "WATCHED_CARD_NOT_FOUND" });
  });
});

describe("deals", () => {
  it("finds well-selling cards over 10 € listed well under their sales price, biggest gain first", async () => {
    const big = await card("Dracaufeu", { week: 46000, month: 44000, low: 30000 }); // 450 € vendu, annonce à 300 € : −33 %
    const mid = await card("Lugia", { week: 2000, month: 2000, low: 1400 }); // 20 €, annonce à 14 € : −30 %
    await card("Commune", { week: 30, month: 30, low: 2 }); // trop petite
    await card("Petit écart", { week: 2000, month: 2000, low: 1800 }); // −10 % seulement
    await card("Peu vendue", { month: 3000, low: 1000 }); // une seule période de ventes : pas assez sûr
    await card("Partagée", { week: 3000, month: 3000, low: 1000, ambiguous: true }); // cote commune à plusieurs variantes
    await card("Ancienne", { week: 3000, month: 3000, low: 1000, ageDays: 6 }); // relevé trop vieux
    const watched = await watchCard(sql, { variantId: mid });

    const result = await findDeals(sql);
    expect(result.deals.map((d) => d.card.name)).toEqual(["Dracaufeu", "Lugia"]);
    expect(result.deals[0]).toMatchObject({ variantId: big, estimateCents: 45000, lowCents: 30000, discountPercent: 33, gainCents: 15000, watchedId: null });
    expect(result.deals[1]).toMatchObject({ watchedId: watched.id, discountPercent: 30 });
    expect(result).toMatchObject({ freshDays: 3, minCents: 1000, minDiscount: 25 });
    expect(result.examined).toBeGreaterThanOrEqual(5);

    expect((await findDeals(sql, { minCents: 10000 })).deals.map((d) => d.card.name)).toEqual(["Dracaufeu"]);
    expect((await findDeals(sql, { minDiscount: 31 })).deals.map((d) => d.card.name)).toEqual(["Dracaufeu"]);
    expect((await findDeals(sql, { freshDays: 7 })).deals.map((d) => d.card.name)).toContain("Ancienne");
  });
});

describe("most wanted cards of the moment", () => {
  it("ranks cards over 10 € that sold yesterday by how much their weekly sales price exceeds the monthly one", async () => {
    const sold = { day: 1 };
    await card("Dracaufeu", { week: 46000, month: 40000, low: 30000 }); // +15 % mais pas vendue hier : écartée
    await old0(await card("Lugia", { week: 12000, month: 10000 }), sold); // +20 %
    await old0(await card("Mew", { week: 2600, month: 2000 }), sold); // +30 %
    await old0(await card("Ectoplasma", { week: 9000, month: 10000 }), sold); // en baisse : écartée
    await old0(await card("Commune", { week: 60, month: 30 }), sold); // trop petite
    await old0(await card("Partagée", { week: 9000, month: 5000, ambiguous: true }), sold); // cote commune : écartée
    const watched = await watchCard(sql, { variantId: (await sql<{ id: string }[]>`select v.id from card_variants v join catalog_cards c on c.id = v.catalog_card_id where c.name = 'Lugia'`)[0]!.id });

    const top = await trendingCards(sql);
    expect(top.map((t) => [t.card.name, t.trendPercent])).toEqual([["Mew", 30], ["Lugia", 20]]);
    expect(top[1]).toMatchObject({ watchedId: watched.id, sales: { cents: 11000 } });
    expect((await trendingCards(sql, { limit: 1 })).map((t) => t.card.name)).toEqual(["Mew"]);
    expect((await trendingCards(sql, { minCents: 5000 })).map((t) => t.card.name)).toEqual(["Lugia"]);
  });
});
