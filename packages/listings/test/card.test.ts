import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { cancelOrder, createDirectSale, createLocation, receiveCard } from "@dexlane/inventory";
import { getCardDetail } from "../src";

const sql = useTestDb("listings");
const ACTOR = "test";

describe("the card page", () => {
  it("gathers every variant, offer, copy and sale of one catalogue card", async () => {
    await sql`insert into catalog_sets (id, language, name, serie_name, card_count_official) values ('base1', 'fr', 'Set de Base', 'Wizards', 102) on conflict do nothing`;
    const [c] = await sql<{ id: string }[]>`
      insert into catalog_cards (set_id, local_number, name, language, rarity) values ('base1', '4', 'Dracaufeu', 'fr', 'Rare') returning id`;
    const [other] = await sql<{ id: string }[]>`insert into catalog_cards (set_id, local_number, name, language) values ('base1', '5', 'Leveinard', 'fr') returning id`;
    const [unlimited] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish, subtype) values (${c!.id}, 'holo', 'illimité') returning id`;
    const [first] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish, edition) values (${c!.id}, 'holo', '1st') returning id`;
    const [unrelated] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish) values (${other!.id}, 'holo') returning id`;
    for (const code of ["BOX-01", "BOX-02"]) await createLocation(sql, { code });
    const receive = (variantId: string, condition: "NM" | "EX", quantity: number, location: string, cost: number) =>
      receiveCard(sql, { variantId, condition, quantity, location: { code: location }, unitCostCents: cost, actor: ACTOR });
    const nm = await receive(unlimited!.id, "NM", 2, "BOX-01", 20000);
    await receive(unlimited!.id, "EX", 1, "BOX-02", 15000);
    await receive(first!.id, "NM", 1, "BOX-02", 90000);
    await receive(unrelated!.id, "NM", 5, "BOX-01", 10);
    await sql`update offers set target_price_cents = 40000 where id = ${nm.offer.id}`;

    const sold = await createDirectSale(sql, { lines: [{ offerId: nm.offer.id, qty: 1, unitPriceCents: 42000 }], shippingMode: "HAND_DELIVERY", actor: ACTOR });
    const cancelled = await createDirectSale(sql, { lines: [{ offerId: nm.offer.id, qty: 1, unitPriceCents: 1 }], shippingMode: "HAND_DELIVERY", actor: ACTOR });
    await cancelOrder(sql, cancelled.orderId, ACTOR, "erreur");

    const detail = await getCardDetail(sql, c!.id);
    expect(detail.card).toMatchObject({ name: "Dracaufeu", setName: "Set de Base", serieName: "Wizards", localNumber: "4", officialCount: 102, rarity: "Rare" });
    expect(detail.variants.map((v) => [v.edition, v.subtype, v.onHand])).toEqual([["", "illimité", 3], ["1st", "", 1]]);
    // Une offre par variante et par état ; la carte voisine n'y est pas.
    expect(detail.offers.map((o) => [o.offerSku.slice(-4), o.onHand])).toHaveLength(3);
    expect(detail.offers.every((o) => o.catalogCardId === c!.id)).toBe(true);
    // Chaque exemplaire, rangé par boîte ; les réservations de la vente en cours se voient.
    expect(detail.copies.map((p) => [p.locationCode, p.condition, p.onHand, p.reserved])).toEqual([
      ["BOX-01", "NM", 2, 1], ["BOX-02", "EX", 1, 0], ["BOX-02", "NM", 1, 0],
    ]);
    expect(detail.sales).toMatchObject([{ externalId: sold.externalId, qty: 1, unitPriceCents: 42000, condition: "NM", variantId: unlimited!.id }]);
    expect(detail.totals).toEqual({ copies: 4, valueCents: 2 * 40000, costCents: 2 * 20000 + 15000 + 90000, soldCards: 1, soldCents: 42000 });
    await expect(getCardDetail(sql, crypto.randomUUID())).rejects.toMatchObject({ code: "CARD_NOT_FOUND" });
  });
});
