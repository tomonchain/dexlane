import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { attachPhotos, createLocation, receiveCard, recordPhoto } from "@dexlane/inventory";
import { getStockDetail, listStock, publishListing, setChannelMode } from "../src";

const sql = useTestDb("listings");
const ACTOR = "test";
let seq = 0;

async function card(name: string, opts: { quantity?: number; price?: number; draft?: boolean; location?: string; cost?: number } = {}) {
  const n = ++seq;
  await sql`insert into catalog_sets (id, language, name, serie_name, card_count_official) values ('base1', 'fr', 'Set de Base', 'Wizards', 102) on conflict do nothing`;
  const [c] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language) values ('base1', ${String(n)}, ${name}, 'fr') returning id`;
  const [v] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish) values (${c!.id}, 'holo') returning id`;
  await createLocation(sql, { code: opts.location ?? "BOX-01" });
  const r = await receiveCard(sql, {
    variantId: v!.id, condition: "NM", quantity: opts.quantity ?? 1, location: { code: opts.location ?? "BOX-01" },
    unitCostCents: opts.cost ?? 100, draft: opts.draft, actor: ACTOR,
  });
  if (opts.price) await sql`update offers set target_price_cents = ${opts.price}, category = 'SINGLE' where id = ${r.offer.id}`;
  return { ...r, variantId: v!.id };
}

describe("the stock, one line per card to sell", () => {
  it("tells where each card stands on the way to a sale and counts every status", async () => {
    await card("Brouillon", { draft: true });
    await card("Sans prix");
    await card("Prête", { price: 1500, quantity: 3 });
    const listed = await card("En ligne", { price: 9000 });
    const scan = await recordPhoto(sql, { kind: "SCAN_FRONT", storageKey: "s1", url: "https://blob.test/s1.jpg", contentType: "image/jpeg", byteSize: 1 });
    await attachPhotos(sql, [scan.id], { stockItemId: listed.stockItem.id, offerId: listed.offer.id });
    await setChannelMode(sql, {}, "ebay", "SIMULATION", ACTOR);
    await publishListing(sql, {}, { offerId: listed.offer.id, channel: "ebay", actor: ACTOR });

    const page = await listStock(sql, { sort: "name" });
    expect(page.items.map((r) => [r.name, r.status])).toEqual([["Brouillon", "DRAFT"], ["En ligne", "LISTED"], ["Prête", "READY"], ["Sans prix", "TO_PRICE"]]);
    expect(page.counts).toEqual({ ALL: 4, DRAFT: 1, TO_PRICE: 1, READY: 1, LISTED: 1 });
    expect(page.totals).toEqual({ cards: 6, valueCents: 13500 });
    expect(page.items[1]).toMatchObject({ photoUrl: "https://blob.test/s1.jpg", listings: [{ channel: "ebay", status: "ACTIVE" }] });
    expect(page.items[2]).toMatchObject({ onHand: 3, available: 3, reserved: 0, draft: 0, locations: ["BOX-01"], averageCostCents: 100, setName: "Set de Base" });

    const ready = await listStock(sql, { status: "READY" });
    expect([ready.total, ready.items.map((r) => r.name), ready.counts.ALL]).toEqual([1, ["Prête"], 4]);
    expect((await listStock(sql, { q: "sans" })).items.map((r) => r.name)).toEqual(["Sans prix"]);
    expect((await listStock(sql, { sort: "value" })).items[0]!.name).toBe("En ligne");
  });

  it("merges the positions of one card across locations", async () => {
    const first = await card("Pikachu", { quantity: 2, cost: 100 });
    await createLocation(sql, { code: "BOX-02" });
    await receiveCard(sql, { variantId: first.variantId, condition: "NM", quantity: 2, location: { code: "BOX-02" }, unitCostCents: 300, actor: ACTOR });
    const [row] = (await listStock(sql)).items;
    expect(row).toMatchObject({ onHand: 4, locations: ["BOX-01", "BOX-02"], averageCostCents: 200 });

    const detail = await getStockDetail(sql, row!.offerId);
    expect(detail.positions.map((p) => [p.locationCode, p.onHand])).toEqual([["BOX-01", 2], ["BOX-02", 2]]);
    expect(detail.missing).toEqual(["PRICE", "PHOTO"]);
    expect(detail.text.title).toMatch(/^Pikachu \d+\/102 Set de Base Holo FR NM/);
    await expect(getStockDetail(sql, crypto.randomUUID())).rejects.toMatchObject({ code: "OFFER_NOT_FOUND" });
  });
});
