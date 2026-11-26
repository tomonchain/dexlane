import { beforeEach, describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { cardSlug, getPublicCard, getPublicSet, listPublicCardsForSitemap, listPublicSets, setSlug, slugPrefixes, slugify, syncSet } from "../src";
import { card, fakeClient } from "./fixtures";

const sql = useTestDb("catalog");

describe("public addresses", () => {
  it("builds readable segments and finds the identifier at their start", () => {
    expect(slugify("Ténèbres Embrasées")).toBe("tenebres-embrasees");
    expect(slugify("M Dracaufeu-EX !")).toBe("m-dracaufeu-ex");
    expect(setSlug({ id: "sv03.5", name: "151" })).toBe("sv03.5-151");
    expect(setSlug({ id: "P-A", name: "Promo-A" })).toBe("p-a-promo-a");
    expect(cardSlug({ localNumber: "TG01", name: "Pikachu" })).toBe("tg01-pikachu");
    expect(cardSlug({ localNumber: "?", name: "Zarbi" })).toBe("%3F-zarbi");
    expect(slugPrefixes("p-a-promo-a")).toEqual(["p-a-promo-a", "p-a-promo", "p-a", "p"]);
    expect(slugPrefixes("%3F-zarbi")).toEqual(["?-zarbi", "?"]);
  });
});

describe("public catalog", () => {
  beforeEach(async () => {
    const client = fakeClient([card("base1-4"), card("swsh3-136")]);
    await syncSet(sql, client, "fr", "base1");
    await syncSet(sql, client, "fr", "swsh3");
  });

  it("lists the sets that have cards, with their priced cards", async () => {
    const sets = await listPublicSets(sql, "fr");
    expect(sets.map((s) => s.id).sort()).toEqual(["base1", "swsh3"]);
    const swsh3 = sets.find((s) => s.id === "swsh3")!;
    expect(swsh3).toMatchObject({ name: "Ténèbres Embrasées", cards: 1, pricedCards: 1, cardCountOfficial: 189 });
    expect(await listPublicSets(sql, "en")).toEqual([]);
  });

  it("finds a set and a card from their address, whatever the name part says", async () => {
    const found = await getPublicSet(sql, "fr", "swsh3-tenebres-embrasees");
    expect(found?.set.id).toBe("swsh3");
    expect(found?.cards).toEqual([expect.objectContaining({ localNumber: "136", name: "Fouinar", fromCents: 9 })]);
    expect((await getPublicSet(sql, "fr", "swsh3-ancien-nom"))?.set.id).toBe("swsh3");
    expect(await getPublicSet(sql, "fr", "xy1-inconnue")).toBeNull();

    const charizard = await getPublicCard(sql, "fr", "base1-set-de-base", "4-dracaufeu");
    expect(charizard).toMatchObject({ localNumber: "4", name: "Dracaufeu", set: { id: "base1" }, previous: null, next: null });
    expect(charizard!.variants.length).toBeGreaterThan(0);
    const fouinar = await getPublicCard(sql, "fr", "swsh3", "136");
    const prices = fouinar!.variants.map((v) => [v.finish, v.price?.trendCents]);
    expect(prices).toEqual([["normal", 9], ["reverse", 28]]);
    expect(fouinar!.variants[0]!.history).toEqual([{ day: expect.any(String), cents: 9 }]);
    expect(await getPublicCard(sql, "fr", "swsh3", "999-absente")).toBeNull();
  });

  it("finds the same Pokémon in other sets by its Pokédex number, whatever its printed name", async () => {
    // Un autre Dracaufeu (numéro de Pokédex 6), sous un autre nom, dans une autre série.
    const charizardEx = { ...card("base1-4"), id: "sv03.5-6", localId: "6", name: "Dracaufeu ex", set: { id: "sv03.5", name: "151" } };
    await syncSet(sql, fakeClient([charizardEx as never]), "fr", "sv03.5");

    const charizard = await getPublicCard(sql, "fr", "base1", "4");
    expect(charizard).toMatchObject({ dexIds: [6], relatedBy: "pokedex" });
    expect(charizard!.related.map((c) => [c.setId, c.name])).toEqual([["sv03.5", "Dracaufeu ex"]]);
    expect(charizard!.related[0]).toMatchObject({ setName: "151", localNumber: "6" });

    const fouinar = await getPublicCard(sql, "fr", "swsh3", "136");
    expect(fouinar).toMatchObject({ illustrator: "tetsuya koizumi", hp: 110, types: ["Incolore"], stage: "Niveau 1" });
    expect(fouinar!.related).toEqual([]);
    // Même illustrateur que le Dracaufeu du Set de Base ? Seulement si c'est le cas dans les données.
    expect(Array.isArray(fouinar!.sameIllustrator)).toBe(true);
  });

  it("offers to search engines only the cards that have a price", async () => {
    await sql`delete from price_snapshots where variant_id in (
      select v.id from card_variants v join catalog_cards c on c.id = v.catalog_card_id where c.set_id = 'base1')`;
    const entries = await listPublicCardsForSitemap(sql, "fr");
    expect(entries.map((e) => `${e.setId}/${e.localNumber}`)).toEqual(["swsh3/136"]);
    expect(entries[0]!.setName).toBe("Ténèbres Embrasées");
  });
});
