import { describe, expect, it } from "vitest";
import { extractFromBulk, findStockBySku, getOfferAvailability, moveStock, receiveStock } from "../src";
import { ACTOR, makeLocation, makeOffer, stock, stockRow, useTestDb } from "./helpers";

const sql = useTestDb();

describe("stock positions", () => {
  it("sums availability of an offer across positions in different locations", async () => {
    const { offerId } = await makeOffer(sql);
    for (const qty of [1, 2, 3]) await stock(sql, offerId, await makeLocation(sql), qty);

    const a = await getOfferAvailability(sql, offerId);
    expect(a).toMatchObject({ availableToSell: 6, onHand: 6, reserved: 0, activePositions: 3 });
  });

  it("does not count DRAFT positions as sellable", async () => {
    const { offerId } = await makeOffer(sql);
    await receiveStock(sql, {
      unitSku: "SI-DRAFT", kind: "FUNGIBLE", offerId, locationId: await makeLocation(sql),
      unitCostCents: 50, quantity: 2, actor: ACTOR,
    });
    expect((await getOfferAvailability(sql, offerId)).availableToSell).toBe(0);
  });

  it("rejects a UNIQUE position with more than one card", async () => {
    const { offerId } = await makeOffer(sql, { isUnique: true });
    await expect(stock(sql, offerId, await makeLocation(sql), 2, "UNIQUE")).rejects.toThrow(/stock_unique_at_most_one/);
  });

  it("rejects a position whose kind contradicts its offer", async () => {
    const { offerId } = await makeOffer(sql, { isUnique: false });
    await expect(stock(sql, offerId, await makeLocation(sql), 1, "UNIQUE")).rejects.toThrow(/incompatible/);
  });

  it("allows only one UNIQUE position per unique offer", async () => {
    const { offerId } = await makeOffer(sql, { isUnique: true });
    await stock(sql, offerId, await makeLocation(sql), 1, "UNIQUE");
    await expect(stock(sql, offerId, await makeLocation(sql), 1, "UNIQUE")).rejects.toThrow(/one_unique_per_offer/);
  });

  it("refuses at database level any update that would make available_to_sell negative", async () => {
    const { offerId } = await makeOffer(sql);
    const item = await stock(sql, offerId, await makeLocation(sql), 1);
    await expect(sql`update stock_items set reserved = 2 where id = ${item.id}`).rejects.toThrow(
      /stock_available_non_negative/,
    );
  });

  it("keeps the movement journal append-only", async () => {
    const { offerId } = await makeOffer(sql);
    await stock(sql, offerId, await makeLocation(sql), 1);
    await expect(sql`update inventory_movements set qty_delta = 99`).rejects.toThrow(/append-only/);
    await expect(sql`delete from inventory_movements`).rejects.toThrow(/append-only/);
  });

  it("moves a position and logs the move", async () => {
    const { offerId } = await makeOffer(sql);
    const from = await makeLocation(sql, "BOX-01/ROW-01/SLOT-01");
    const to = await makeLocation(sql, "BOX-02/ROW-03/SLOT-04");
    const item = await stock(sql, offerId, from, 1);

    await moveStock(sql, item.id, to, ACTOR);

    expect((await findStockBySku(sql, item.unitSku))?.locationCode).toBe("BOX-02/ROW-03/SLOT-04");
    const [move] = await sql`select * from inventory_movements where stock_item_id = ${item.id} and movement_type = 'MOVE'`;
    expect(move).toMatchObject({ fromLocationId: from, toLocationId: to, qtyDelta: 0 });
  });
});

describe("bulk lots", () => {
  async function bulkLot(quantity: number) {
    const [desc] = await sql<{ id: string }[]>`
      insert into bulk_descriptors (card_type, label) values ('communes', 'Communes EV') returning id`;
    return receiveStock(sql, {
      unitSku: "BULK-1", kind: "BULK", bulkDescriptorId: desc!.id, locationId: await makeLocation(sql),
      unitCostCents: 2, quantity, activate: true, actor: ACTOR,
    });
  }

  it("records 1 000 commons as a single aggregated position", async () => {
    const lot = await bulkLot(1000);
    expect(await stockRow(sql, lot.id)).toMatchObject({ onHand: 1000 });
    const [{ count } = { count: -1 }] = await sql<{ count: number }[]>`select count(*)::int as count from inventory_movements`;
    expect(count).toBe(1);
  });

  it("extracts cards from bulk into a new position with linked movements", async () => {
    const lot = await bulkLot(1000);
    const { offerId } = await makeOffer(sql);

    const extracted = await extractFromBulk(sql, {
      bulkStockItemId: lot.id,
      quantity: 5,
      target: { unitSku: "SI-FROM-BULK", kind: "FUNGIBLE", offerId, locationId: await makeLocation(sql), activate: true },
      actor: ACTOR,
    });

    expect(await stockRow(sql, lot.id)).toMatchObject({ onHand: 995 });
    expect(await stockRow(sql, extracted.id)).toMatchObject({ onHand: 5 });
    expect(extracted.unitCostCents).toBe(2);

    const moves = await sql<{ movementType: string; qtyDelta: number; correlationId: string }[]>`
      select movement_type, qty_delta, correlation_id from inventory_movements
       where movement_type in ('BULK_EXTRACT', 'RECEIVE') and correlation_id is not null order by id`;
    expect(moves.map((m) => [m.movementType, m.qtyDelta])).toEqual([["BULK_EXTRACT", -5], ["RECEIVE", 5]]);
    expect(moves[0]!.correlationId).toBe(moves[1]!.correlationId);
  });

  it("refuses to extract more than the bulk lot holds", async () => {
    const lot = await bulkLot(3);
    const { offerId } = await makeOffer(sql);
    await expect(
      extractFromBulk(sql, {
        bulkStockItemId: lot.id, quantity: 4,
        target: { unitSku: "SI-X", kind: "FUNGIBLE", offerId, locationId: await makeLocation(sql) },
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  });
});
