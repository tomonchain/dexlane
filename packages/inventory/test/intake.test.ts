import { describe, expect, it } from "vitest";
import {
  activateStock, adjustStock, allocateOrderLine, buildOfferSku, createAcquisitionLot, createLocation,
  extractCardFromBulk, getOfferAvailability, listLocations, receiveBulk, receiveCard,
} from "../src";
import { ACTOR, journalDrift, lineOf, makeVariant, order, stockRow, useTestDb } from "./helpers";

const sql = useTestDb();

const box = async (code = "BOX-01/ROW-01") => (await createLocation(sql, { code })).code;
const count = async (table: string) => (await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table}`))[0]!.n;

describe("buildOfferSku", () => {
  const base = {
    setId: "base1", localNumber: "4", language: "fr", finish: "holo", edition: "1st",
    promo: false, stamp: "", subtype: "", size: "standard", condition: "NM" as const,
  };

  it("builds a readable SKU from set, number, language, variant and condition", () => {
    expect(buildOfferSku(base)).toBe("OF-BASE1-004-FR-H1-NM");
    expect(buildOfferSku({ ...base, setId: "sv03.5", localNumber: "151", finish: "reverse", edition: "", condition: "EX" }))
      .toBe("OF-SV035-151-FR-R-EX");
  });

  it("keeps non-numeric numbers and encodes promo, subtype and unknown finishes", () => {
    expect(buildOfferSku({ ...base, localNumber: "TG05", edition: "" })).toBe("OF-BASE1-TG05-FR-H-NM");
    expect(buildOfferSku({ ...base, edition: "", promo: true, subtype: "sans ombre" })).toBe("OF-BASE1-004-FR-HPSO-NM");
    expect(buildOfferSku({ ...base, edition: "", finish: "Poké Ball" })).toBe("OF-BASE1-004-FR-POK-NM");
  });
});

describe("locations", () => {
  it("creates missing parents and is idempotent", async () => {
    const leaf = await createLocation(sql, { code: " box-03 / row-12/slot-04 ", description: "étagère du haut" });
    expect(leaf).toMatchObject({ code: "BOX-03/ROW-12/SLOT-04", created: true, description: "étagère du haut" });

    const all = await listLocations(sql);
    expect(all.map((l) => l.code)).toEqual(["BOX-03", "BOX-03/ROW-12", "BOX-03/ROW-12/SLOT-04"]);
    expect(all[2]!.parentId).toBe(all[1]!.id);
    expect(all[1]!.parentId).toBe(all[0]!.id);

    expect(await createLocation(sql, { code: "BOX-03/ROW-12/SLOT-04" })).toMatchObject({ id: leaf.id, created: false });
    expect(await count("locations")).toBe(3);
  });

  it("rejects codes that cannot be scanned unambiguously", async () => {
    for (const code of ["", "BOX 03", "BOX-03//SLOT", "A/B/C/D/E/F", "BOX_03%"]) {
      await expect(createLocation(sql, { code })).rejects.toMatchObject({ code: "INVALID_LOCATION_CODE" });
    }
  });
});

describe("receiveCard (Parcours A)", () => {
  it("creates the offer, the unit SKU and a sellable position at the given location", async () => {
    const { variantId } = await makeVariant(sql, { number: "4", edition: "1st" });
    const lot = await createAcquisitionLot(sql, { sourceType: "collection", purchaseDate: "2026-11-01", totalCostCents: 5000 });

    const r = await receiveCard(sql, {
      variantId, condition: "NM", quantity: 3, location: { code: await box() }, unitCostCents: 250,
      acquisitionLotId: lot.id, actor: ACTOR,
    });

    expect(r.offer).toMatchObject({ offerSku: "OF-BASE1-004-FR-H1-NM", isUnique: false, created: true });
    expect(r.stockItem).toMatchObject({ kind: "FUNGIBLE", onHand: 3, lifecycle: "ACTIVE", unitCostCents: 250, acquisitionLotId: lot.id });
    expect(r.stockItem.unitSku).toMatch(/^SI-\d{6}$/);
    expect(r.locationCode).toBe("BOX-01/ROW-01");
    expect(await getOfferAvailability(sql, r.offer.id)).toMatchObject({ availableToSell: 3, offerStatus: "DRAFT" });
    const [move] = await sql`select movement_type, qty_delta, actor from inventory_movements`;
    expect(move).toMatchObject({ movementType: "RECEIVE", qtyDelta: 3, actor: ACTOR });
  });

  it("adds a position to the existing offer for the same variant and condition", async () => {
    const { variantId } = await makeVariant(sql);
    const common = { variantId, condition: "NM" as const, unitCostCents: 100, actor: ACTOR };
    const a = await receiveCard(sql, { ...common, quantity: 1, location: { code: await box("BOX-01") } });
    const b = await receiveCard(sql, { ...common, quantity: 2, location: { code: await box("BOX-02") } });
    const c = await receiveCard(sql, { ...common, quantity: 3, location: { code: await box("BOX-03") } });
    const other = await receiveCard(sql, { ...common, condition: "EX", quantity: 1, location: { code: "BOX-03" } });

    expect([b.offer.id, c.offer.id]).toEqual([a.offer.id, a.offer.id]);
    expect(b.offer.created).toBe(false);
    expect(new Set([a, b, c].map((r) => r.stockItem.unitSku)).size).toBe(3);
    expect(await getOfferAvailability(sql, a.offer.id)).toMatchObject({ availableToSell: 6, activePositions: 3 });
    expect(other.offer.id).not.toBe(a.offer.id);
    expect(other.offer.offerSku).toMatch(/-EX$/);
  });

  it("creates a single offer when the same card is received concurrently", async () => {
    const { variantId } = await makeVariant(sql);
    const code = await box();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        receiveCard(sql, { variantId, condition: "NM", quantity: 1, location: { code }, unitCostCents: 0, actor: ACTOR })),
    );
    expect(new Set(results.map((r) => r.offer.id)).size).toBe(1);
    expect(results.filter((r) => r.offer.created)).toHaveLength(1);
    expect(await count("offers")).toBe(1);
    expect(await count("stock_items")).toBe(8);
  });

  it("gives each unique copy its own offer and refuses a quantity above one", async () => {
    const { variantId } = await makeVariant(sql, { number: "4" });
    const input = { variantId, condition: "NM" as const, quantity: 1, location: { code: await box() }, unitCostCents: 12000, unique: true, actor: ACTOR };
    const a = await receiveCard(sql, input);
    const b = await receiveCard(sql, input);

    expect(a.stockItem.kind).toBe("UNIQUE");
    expect(a.offer.offerSku).toBe(`OF-BASE1-004-FR-H-NM-U${a.stockItem.unitSku.slice(3)}`);
    expect(b.offer.id).not.toBe(a.offer.id);
    await expect(receiveCard(sql, { ...input, quantity: 2 })).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
  });

  it("keeps a draft position unsellable until it is validated", async () => {
    const { variantId } = await makeVariant(sql, { incomplete: true });
    const r = await receiveCard(sql, {
      variantId, condition: "NM", quantity: 1, location: { code: await box() }, unitCostCents: 100, draft: true, actor: ACTOR,
    });
    expect(r).toMatchObject({ variantIncomplete: true, stockItem: { lifecycle: "DRAFT" } });
    expect((await getOfferAvailability(sql, r.offer.id)).availableToSell).toBe(0);

    // Une commande sur une position non validée part en survente, elle n'est pas servie.
    const { orderId } = await order(sql, r.offer.offerSku);
    expect((await allocateOrderLine(sql, await lineOf(sql, orderId), ACTOR)).status).toBe("OVERSOLD");

    await activateStock(sql, r.stockItem.id, ACTOR);
    expect((await getOfferAvailability(sql, r.offer.id)).availableToSell).toBe(1);
  });

  it("creates nothing when the location, the variant or the acquisition lot is unknown", async () => {
    const { variantId } = await makeVariant(sql);
    const input = { variantId, condition: "NM" as const, quantity: 1, location: { code: await box() }, unitCostCents: 100, actor: ACTOR };
    const missing = "00000000-0000-4000-8000-000000000000";

    await expect(receiveCard(sql, { ...input, location: { code: "BOX-99" } })).rejects.toMatchObject({ code: "LOCATION_NOT_FOUND" });
    await expect(receiveCard(sql, { ...input, variantId: missing })).rejects.toMatchObject({ code: "VARIANT_NOT_FOUND" });
    await expect(receiveCard(sql, { ...input, acquisitionLotId: missing })).rejects.toMatchObject({ code: "ACQUISITION_LOT_NOT_FOUND" });
    await expect(receiveCard(sql, { ...input, quantity: 0 })).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
    expect([await count("offers"), await count("stock_items"), await count("locations")]).toEqual([0, 0, 2]);
  });

  it("suffixes the SKU when two variants would produce the same readable code", async () => {
    const a = await makeVariant(sql, { number: "7", subtype: "sans ombre" });
    const b = await makeVariant(sql, { number: "7", subtype: "série officielle" });
    const input = { condition: "NM" as const, quantity: 1, location: { code: await box() }, unitCostCents: 100, actor: ACTOR };
    const first = await receiveCard(sql, { ...input, variantId: a.variantId });
    const second = await receiveCard(sql, { ...input, variantId: b.variantId });
    expect(first.offer.offerSku).toBe("OF-BASE1-007-FR-HSO-NM");
    expect(second.offer.offerSku).toBe("OF-BASE1-007-FR-HSO-NM-2");
  });
});

describe("bulk (Parcours B)", () => {
  it("records 1 000 commons as one position and reuses the descriptor for the next lot", async () => {
    const code = await box("BOX-VRAC");
    const first = await receiveBulk(sql, {
      descriptor: { setId: "SV01", cardType: "Communes", language: "FR" }, quantity: 1000,
      location: { code }, totalCostCents: 1500, actor: ACTOR,
    });
    const second = await receiveBulk(sql, {
      descriptor: { setId: "sv01", cardType: "communes", language: "fr" }, quantity: 400,
      location: { code }, totalCostCents: 800, actor: ACTOR,
    });

    expect(first.descriptor).toMatchObject({ setId: "sv01", cardType: "communes", language: "fr", label: "Communes · sv01 · FR" });
    expect(second.descriptor.id).toBe(first.descriptor.id);
    expect(first.stockItem).toMatchObject({ kind: "BULK", onHand: 1000, lifecycle: "ACTIVE", unitCostCents: 2, offerId: null });
    expect([await count("stock_items"), await count("inventory_movements"), await count("bulk_descriptors")]).toEqual([2, 2, 1]);
  });

  it("extracts identified cards from a bulk lot into a new position, cost carried over", async () => {
    const code = await box("BOX-VRAC");
    const lot = await createAcquisitionLot(sql, { sourceType: "particulier", purchaseDate: "2026-11-10", totalCostCents: 2000 });
    const bulk = await receiveBulk(sql, {
      descriptor: { era: "EV", cardType: "communes" }, quantity: 1000, location: { code },
      totalCostCents: 2000, acquisitionLotId: lot.id, actor: ACTOR,
    });
    const { variantId } = await makeVariant(sql);

    const r = await extractCardFromBulk(sql, {
      bulkStockItemId: bulk.stockItem.id, variantId, condition: "EX", quantity: 5,
      location: { code: await box("BOX-01") }, actor: ACTOR,
    });

    expect(await stockRow(sql, bulk.stockItem.id)).toMatchObject({ onHand: 995 });
    expect(r.stockItem).toMatchObject({ kind: "FUNGIBLE", onHand: 5, unitCostCents: 2, acquisitionLotId: lot.id });
    expect((await getOfferAvailability(sql, r.offer.id)).availableToSell).toBe(5);
    expect(await journalDrift(sql)).toHaveLength(0);
  });

  it("leaves no orphan offer when the bulk lot is too small", async () => {
    const bulk = await receiveBulk(sql, {
      descriptor: { cardType: "énergies" }, quantity: 3, location: { code: await box() }, totalCostCents: 0, actor: ACTOR,
    });
    const { variantId } = await makeVariant(sql);
    await expect(
      extractCardFromBulk(sql, {
        bulkStockItemId: bulk.stockItem.id, variantId, condition: "NM", quantity: 4, location: { code: "BOX-01/ROW-01" }, actor: ACTOR,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(await count("offers")).toBe(0);
  });
});

describe("adjustStock", () => {
  async function position(quantity: number) {
    const { variantId } = await makeVariant(sql);
    return receiveCard(sql, { variantId, condition: "NM", quantity, location: { code: await box() }, unitCostCents: 100, actor: ACTOR });
  }

  it("records the difference as an ADJUST movement with an audit trail", async () => {
    const { stockItem } = await position(3);
    const after = await adjustStock(sql, { stockItemId: stockItem.id, countedOnHand: 2, reason: "comptage du 17/11", actor: ACTOR });

    expect(after.onHand).toBe(2);
    expect(await stockRow(sql, stockItem.id)).toMatchObject({ onHand: 2, lifecycle: "ACTIVE" });
    const [move] = await sql`select qty_delta, bucket, reason from inventory_movements where movement_type = 'ADJUST'`;
    expect(move).toMatchObject({ qtyDelta: -1, bucket: "on_hand", reason: "comptage du 17/11" });
    const [audit] = await sql`select before, after from audit_events where action = 'adjust'`;
    expect(audit).toMatchObject({ before: { onHand: 3 }, after: { onHand: 2, reason: "comptage du 17/11" } });
    expect(await journalDrift(sql)).toHaveLength(0);
  });

  it("does nothing when the count matches", async () => {
    const { stockItem } = await position(3);
    await adjustStock(sql, { stockItemId: stockItem.id, countedOnHand: 3, reason: "contrôle", actor: ACTOR });
    expect(await count("audit_events")).toBe(0);
  });

  it("refuses to drop below reserved quantities and requires a reason", async () => {
    const { stockItem, offer } = await position(2);
    const { orderId } = await order(sql, offer.offerSku, 2);
    await allocateOrderLine(sql, await lineOf(sql, orderId), ACTOR);

    await expect(adjustStock(sql, { stockItemId: stockItem.id, countedOnHand: 1, reason: "introuvable", actor: ACTOR }))
      .rejects.toMatchObject({ code: "ADJUST_BELOW_COMMITTED", details: { reserved: 2 } });
    await expect(adjustStock(sql, { stockItemId: stockItem.id, countedOnHand: 5, reason: "  ", actor: ACTOR }))
      .rejects.toMatchObject({ code: "REASON_REQUIRED" });
    expect(await stockRow(sql, stockItem.id)).toMatchObject({ onHand: 2, reserved: 2 });
  });

  it("archives an emptied position and reactivates it when the card is found again", async () => {
    const { stockItem } = await position(1);
    await adjustStock(sql, { stockItemId: stockItem.id, countedOnHand: 0, reason: "introuvable", actor: ACTOR });
    expect(await stockRow(sql, stockItem.id)).toMatchObject({ onHand: 0, lifecycle: "ARCHIVED" });
    await adjustStock(sql, { stockItemId: stockItem.id, countedOnHand: 1, reason: "retrouvée derrière la boîte", actor: ACTOR });
    expect(await stockRow(sql, stockItem.id)).toMatchObject({ onHand: 1, lifecycle: "ACTIVE" });
    expect(await journalDrift(sql)).toHaveLength(0);
  });
});
