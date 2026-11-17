import { describe, expect, it } from "vitest";
import { adjustStock, createLocation, getStockItemDetail, moveStock, receiveBulk, receiveCard, searchInventory } from "../src";
import { ACTOR, makeVariant, useTestDb } from "./helpers";

const sql = useTestDb();

async function seed() {
  for (const code of ["BOX-01/ROW-01", "BOX-01/ROW-02", "BOX-02", "BOX-VRAC"]) await createLocation(sql, { code });
  const dracaufeu = await makeVariant(sql, { setId: "base1", number: "4", name: "Dracaufeu" });
  const evoli = await makeVariant(sql, { setId: "swsh3", number: "125", name: "Évoli", finish: "reverse" });
  const pikachuEn = await makeVariant(sql, { setId: "base1", number: "58", name: "Pikachu", language: "en", finish: "normal" });
  const input = { unitCostCents: 100, actor: ACTOR };
  return {
    dracaufeu: await receiveCard(sql, { ...input, variantId: dracaufeu.variantId, condition: "NM", quantity: 1, unique: true, location: { code: "BOX-01/ROW-01" } }),
    evoli: await receiveCard(sql, { ...input, variantId: evoli.variantId, condition: "EX", quantity: 4, location: { code: "BOX-01/ROW-02" } }),
    pikachu: await receiveCard(sql, { ...input, variantId: pikachuEn.variantId, condition: "NM", quantity: 2, draft: true, location: { code: "BOX-02" } }),
    bulk: await receiveBulk(sql, { descriptor: { setId: "swsh3", cardType: "communes", language: "fr" }, quantity: 500, totalCostCents: 1000, location: { code: "BOX-VRAC" }, actor: ACTOR }),
  };
}

const skus = (r: { items: { unitSku: string }[] }) => r.items.map((i) => i.unitSku).sort();

describe("searchInventory", () => {
  it("returns card, offer and location details for each position", async () => {
    const s = await seed();
    const { items, total } = await searchInventory(sql);
    expect(total).toBe(4);
    const evoli = items.find((i) => i.id === s.evoli.stockItem.id)!;
    expect(evoli).toMatchObject({
      unitSku: s.evoli.stockItem.unitSku, kind: "FUNGIBLE", onHand: 4, availableToSell: 4, locationCode: "BOX-01/ROW-02",
      offer: { offerSku: "OF-SWSH3-125-FR-R-EX", condition: "EX", isUnique: false },
      card: { name: "Évoli", setId: "swsh3", localNumber: "125", language: "fr", finish: "reverse" },
      bulk: null,
    });
    const bulk = items.find((i) => i.id === s.bulk.stockItem.id)!;
    expect(bulk).toMatchObject({ kind: "BULK", offer: null, card: null, bulk: { label: "Communes · swsh3 · FR", cardType: "communes" } });
  });

  it("finds a position by unit SKU, offer SKU or accent-insensitive name", async () => {
    const s = await seed();
    expect(skus(await searchInventory(sql, { q: s.dracaufeu.stockItem.unitSku.toLowerCase() }))).toEqual([s.dracaufeu.stockItem.unitSku]);
    expect(skus(await searchInventory(sql, { q: "OF-SWSH3-125" }))).toEqual([s.evoli.stockItem.unitSku]);
    expect(skus(await searchInventory(sql, { q: "evoli" }))).toEqual([s.evoli.stockItem.unitSku]);
    expect(skus(await searchInventory(sql, { q: "commune" }))).toEqual([s.bulk.stockItem.unitSku]);
    expect((await searchInventory(sql, { q: "100%_" })).total).toBe(0);
  });

  it("filters by location prefix, set, language, condition, kind and lifecycle", async () => {
    const s = await seed();
    const sku = (k: keyof typeof s) => s[k].stockItem.unitSku;
    expect(skus(await searchInventory(sql, { location: "box-01" }))).toEqual([sku("dracaufeu"), sku("evoli")].sort());
    expect(skus(await searchInventory(sql, { location: "BOX-01/ROW-02" }))).toEqual([sku("evoli")]);
    expect(skus(await searchInventory(sql, { location: "BOX-0" }))).toEqual([]);
    expect(skus(await searchInventory(sql, { setId: "swsh3" }))).toEqual([sku("evoli"), sku("bulk")].sort());
    expect(skus(await searchInventory(sql, { language: "en" }))).toEqual([sku("pikachu")]);
    expect(skus(await searchInventory(sql, { condition: "NM" }))).toEqual([sku("dracaufeu"), sku("pikachu")].sort());
    expect(skus(await searchInventory(sql, { kind: "UNIQUE" }))).toEqual([sku("dracaufeu")]);
    expect(skus(await searchInventory(sql, { lifecycle: "DRAFT" }))).toEqual([sku("pikachu")]);
  });

  it("hides archived positions by default and paginates with a stable total", async () => {
    const s = await seed();
    await adjustStock(sql, { stockItemId: s.dracaufeu.stockItem.id, countedOnHand: 0, reason: "perdue", actor: ACTOR });
    expect((await searchInventory(sql)).total).toBe(3);
    expect((await searchInventory(sql, { lifecycle: "ALL" })).total).toBe(4);

    const page1 = await searchInventory(sql, { limit: 2 });
    const page2 = await searchInventory(sql, { limit: 2, offset: 2 });
    expect([page1.items.length, page2.items.length, page1.total]).toEqual([2, 1, 3]);
    expect(new Set([...skus(page1), ...skus(page2)]).size).toBe(3);
  });

  it("finds a SKU and its location in well under 2 s among 10 000 positions", async () => {
    const s = await seed();
    await sql`
      insert into stock_items (unit_sku, kind, offer_id, location_id, on_hand, lifecycle)
      select 'GEN-' || g, 'FUNGIBLE', ${s.evoli.offer.id}, ${s.evoli.stockItem.locationId}, 1, 'ACTIVE'
        from generate_series(1, 10000) g`;

    const started = performance.now();
    const bySku = await searchInventory(sql, { q: s.dracaufeu.stockItem.unitSku });
    const byName = await searchInventory(sql, { q: "dracaufeu" });
    const elapsed = performance.now() - started;

    expect(bySku.items[0]).toMatchObject({ locationCode: "BOX-01/ROW-01" });
    expect(byName.total).toBe(1);
    expect((await searchInventory(sql)).total).toBe(10004);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("getStockItemDetail", () => {
  it("returns the position with its movement history, newest first", async () => {
    const s = await seed();
    const to = await createLocation(sql, { code: "BOX-02/ROW-05" });
    await moveStock(sql, s.evoli.stockItem.id, to.id, ACTOR);
    await adjustStock(sql, { stockItemId: s.evoli.stockItem.id, countedOnHand: 3, reason: "comptage", actor: ACTOR });

    const detail = await getStockItemDetail(sql, { unitSku: s.evoli.stockItem.unitSku.toLowerCase() });
    expect(detail).toMatchObject({ id: s.evoli.stockItem.id, onHand: 3, locationCode: "BOX-02/ROW-05" });
    expect(detail.movements.map((m) => [m.movementType, m.qtyDelta])).toEqual([["ADJUST", -1], ["MOVE", 0], ["RECEIVE", 4]]);
    expect(detail.movements[1]).toMatchObject({ fromLocationCode: "BOX-01/ROW-02", toLocationCode: "BOX-02/ROW-05" });

    await expect(getStockItemDetail(sql, { unitSku: "SI-999999" })).rejects.toMatchObject({ code: "STOCK_ITEM_NOT_FOUND" });
  });
});
