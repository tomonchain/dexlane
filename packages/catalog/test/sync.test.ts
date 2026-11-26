import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { importNextSets, syncSet, syncSetList } from "../src";
import { card, fakeClient } from "./fixtures";

const sql = useTestDb("catalog");
const count = async (table: string) => {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)}`;
  return r!.n;
};

describe("syncSet", () => {
  it("stores set, cards, variants and dated prices", async () => {
    const stats = await syncSet(sql, fakeClient([card("swsh3-136")]), "fr", "swsh3");

    expect(stats).toMatchObject({ cards: 1, variants: 2, incompleteVariants: 0, errors: [] });
    const [set] = await sql`select * from catalog_sets where id = 'swsh3' and language = 'fr'`;
    expect(set).toMatchObject({ name: "Ténèbres Embrasées", cardCountOfficial: 189, abbreviation: "DAA" });

    const prices = await sql<{ quoteType: string; amountCents: number; finish: string; observedAt: Date }[]>`
      select p.quote_type, p.amount_cents, v.finish, p.observed_at
        from price_snapshots p join card_variants v on v.id = p.variant_id
       where p.quote_type = 'LISTED_TREND' order by v.finish`;
    expect(prices.map((p) => [p.finish, p.amountCents])).toEqual([["normal", 9], ["reverse", 28]]);
    const updated = card("swsh3-136").variants_detailed![0]!.pricing!.cardmarket!.updated!;
    expect(prices[0]!.observedAt.toISOString()).toBe(new Date(updated).toISOString());
  });

  it("keeps the card details: Pokédex number, illustrator, HP, types and stage", async () => {
    await syncSet(sql, fakeClient([card("swsh3-136")]), "fr", "swsh3");
    const [row] = await sql`select dex_ids, illustrator, hp, types, stage from catalog_cards where set_id = 'swsh3' and local_number = '136'`;
    expect(row).toMatchObject({ dexIds: [162], illustrator: "tetsuya koizumi", hp: 110, types: ["Incolore"], stage: "Niveau 1" });
    const [set] = await sql`select details_synced_at from catalog_sets where id = 'swsh3' and language = 'fr'`;
    expect(set!.detailsSyncedAt).toBeInstanceOf(Date);
  });

  it("takes up again, after the missing sets, the sets imported before card details were kept", async () => {
    const client = fakeClient([card("swsh3-136"), card("base1-4")], {
      listSets: async () => [{ id: "base1", name: "Set de Base" }, { id: "swsh3", name: "Ténèbres Embrasées" }] as never,
    });
    await syncSetList(sql, client, "fr");
    await syncSet(sql, client, "fr", "swsh3");
    // Comme une série importée avant la migration 0036 : cartes présentes, détails absents.
    await sql`update catalog_cards set dex_ids = null, illustrator = null where set_id = 'swsh3'`;
    await sql`update catalog_sets set details_synced_at = null, import_attempted_at = null where id = 'swsh3'`;

    const run = await importNextSets(sql, client, "fr", { budgetMs: 60_000 });
    // La série absente d'abord, puis la reprise de l'ancienne.
    expect(run.imported.map((x) => x.setId)).toEqual(["base1", "swsh3"]);
    const [row] = await sql`select dex_ids, illustrator from catalog_cards where set_id = 'swsh3' and local_number = '136'`;
    expect(row).toMatchObject({ dexIds: [162], illustrator: "tetsuya koizumi" });
    expect((await importNextSets(sql, client, "fr", { budgetMs: 60_000 })).imported).toEqual([]);
  });

  it("falls back to the English image of the same card when the source has none in this language", async () => {
    const withImage = card("swsh3-136");
    const { image: _image, ...withoutImage } = card("swsh3-136");
    await syncSet(sql, fakeClient([{ ...withoutImage, id: "swsh3-136", localId: "136" }]), "fr", "swsh3");
    const [row] = await sql<{ imageUrl: string }[]>`select image_url from catalog_cards where set_id = 'swsh3' and local_number = '136'`;
    expect(row!.imageUrl).toBe("https://assets.tcgdex.net/en/swsh/swsh3/136");
    // L'image dans la langue de la carte, publiée ensuite, remplace le repli.
    await syncSet(sql, fakeClient([withImage]), "fr", "swsh3");
    const [after] = await sql<{ imageUrl: string }[]>`select image_url from catalog_cards where set_id = 'swsh3' and local_number = '136'`;
    expect(after!.imageUrl).toBe("https://assets.tcgdex.net/fr/swsh/swsh3/136");
  });

  it("keeps what a full import learned when the set list is refreshed with a sparser summary", async () => {
    await syncSet(sql, fakeClient([card("swsh3-136")]), "fr", "swsh3");
    const listed = await syncSetList(sql, fakeClient([], { listSets: async () => [{ id: "swsh3", name: "Ténèbres Embrasées" }, { id: "sv01", name: "Écarlate et Violet", cardCount: { official: 198, total: 258 } }] }), "fr");
    expect(listed).toBe(2);
    const sets = await sql`select id, card_count_official, abbreviation from catalog_sets where language = 'fr' order by id`;
    expect(sets).toEqual([
      { id: "sv01", cardCountOfficial: 198, abbreviation: null },
      { id: "swsh3", cardCountOfficial: 189, abbreviation: "DAA" },
    ]);
  });

  it("attaches every known set to its block, imported or not, and survives a failing block lookup", async () => {
    await syncSet(sql, fakeClient([card("swsh3-136")]), "fr", "swsh3");
    const client = fakeClient([], {
      listSets: async () => [{ id: "swsh3", name: "Ténèbres Embrasées" }, { id: "sm1", name: "Soleil et Lune" }, { id: "base1", name: "Set de Base" }],
      listSeries: async () => [{ id: "base", name: "Wizards" }, { id: "sm", name: "Soleil et Lune" }, { id: "swsh", name: "Épée et Bouclier" }],
      getSerie: async (_lang, id) => ({ id, name: id === "swsh" ? "Épée et Bouclier" : id === "sm" ? "Soleil et Lune" : "Wizards", sets: [{ id: id === "swsh" ? "swsh3" : id === "sm" ? "sm1" : "base1", name: "" }] }),
    });
    await syncSetList(sql, client, "fr");
    const sets = await sql`select id, serie_id, serie_name, serie_position from catalog_sets where language = 'fr' order by serie_position`;
    expect(sets).toEqual([
      { id: "base1", serieId: "base", serieName: "Wizards", seriePosition: 1 },
      { id: "sm1", serieId: "sm", serieName: "Soleil et Lune", seriePosition: 2 },
      { id: "swsh3", serieId: "swsh", serieName: "Épée et Bouclier", seriePosition: 3 },
    ]);

    const broken = fakeClient([], { listSets: async () => [{ id: "sv01", name: "Écarlate et Violet" }], listSeries: async () => { throw new Error("fetch failed"); } });
    expect(await syncSetList(sql, broken, "fr")).toBe(1);
  });

  it("is idempotent", async () => {
    const client = fakeClient([card("swsh3-136"), card("base1-4")]);
    await syncSet(sql, client, "fr", "swsh3");
    await syncSet(sql, client, "fr", "base1");
    const before = [await count("catalog_cards"), await count("card_variants"), await count("price_snapshots")];

    const again = await syncSet(sql, client, "fr", "swsh3");

    expect(again.pricesInserted).toBe(0);
    expect([await count("catalog_cards"), await count("card_variants"), await count("price_snapshots")]).toEqual(before);
  });

  it("completes a placeholder variant in place once TCGdex documents it", async () => {
    const early = card("me06-104");
    await syncSet(sql, fakeClient([early]), "fr", "me06");
    const [before] = await sql<{ id: string; incomplete: boolean }[]>`select id, incomplete from card_variants`;
    expect(before!.incomplete).toBe(true);

    const documented = card("me06-104");
    documented.variants_detailed![0]!.variantId = "real-id-123";
    await syncSet(sql, fakeClient([documented]), "fr", "me06");

    const rows = await sql<{ id: string; incomplete: boolean; tcgdexVariantId: string }[]>`
      select id, incomplete, tcgdex_variant_id from card_variants`;
    expect(rows).toEqual([{ id: before!.id, incomplete: false, tcgdexVariantId: "real-id-123" }]);
  });

  it("isolates per-card failures", async () => {
    const client = fakeClient([card("swsh3-136")], {
      getSet: async () => ({
        id: "swsh3", name: "Ténèbres Embrasées",
        cards: [{ id: "swsh3-136", localId: "136", name: "Fouinar" }, { id: "swsh3-999", localId: "999", name: "?" }],
      }),
    });
    const stats = await syncSet(sql, client, "fr", "swsh3");
    expect(stats.cards).toBe(1);
    expect(stats.errors).toEqual([{ cardId: "swsh3-999", message: "card not found in this language" }]);
  });
});
