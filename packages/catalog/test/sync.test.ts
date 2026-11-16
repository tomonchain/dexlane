import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { syncSet } from "../src";
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
