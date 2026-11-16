import { describe, expect, it } from "vitest";
import {
  allocateOrder,
  allocateOrderLine,
  confirmHandover,
  confirmHandoverBatch,
  createShipment,
  getOfferAvailability,
  importOrder,
  packOrder,
  pickAllocation,
  releaseAllocation,
} from "../src";
import { ACTOR, lineOf, makeLocation, makeOffer, order, stock, stockRow, useTestDb } from "./helpers";

const sql = useTestDb();

describe("order import", () => {
  it("creates a single order when the same event is delivered twice", async () => {
    const { offerSku } = await makeOffer(sql);
    const first = await order(sql, offerSku, 1, "EBAY-42");
    const second = await order(sql, offerSku, 1, "EBAY-42");

    expect(first.created).toBe(true);
    expect(second).toEqual({ orderId: first.orderId, created: false });
    const [{ count } = { count: -1 }] = await sql<{ count: number }[]>`select count(*)::int as count from orders`;
    expect(count).toBe(1);
  });

  it("deduplicates concurrent deliveries of the same order", async () => {
    const { offerSku } = await makeOffer(sql);
    const results = await Promise.all(Array.from({ length: 5 }, () => order(sql, offerSku, 1, "EBAY-RACE")));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.orderId)).size).toBe(1);
  });

  it("rejects an order referencing an unknown offer and stores nothing", async () => {
    await expect(order(sql, "OF-DOES-NOT-EXIST")).rejects.toMatchObject({ code: "UNKNOWN_OFFER_SKU" });
    const [{ count } = { count: -1 }] = await sql<{ count: number }[]>`select count(*)::int as count from orders`;
    expect(count).toBe(0);
  });
});

describe("allocation", () => {
  it("reserves stock and lowers sellable quantity without touching physical stock", async () => {
    const { offerId, offerSku } = await makeOffer(sql);
    const item = await stock(sql, offerId, await makeLocation(sql), 3);
    const { orderId } = await order(sql, offerSku, 2);

    const res = await allocateOrderLine(sql, await lineOf(sql, orderId), ACTOR);

    expect(res.status).toBe("ALLOCATED");
    expect(await stockRow(sql, item.id)).toMatchObject({ onHand: 3, reserved: 2 });
    expect((await getOfferAvailability(sql, offerId)).availableToSell).toBe(1);
  });

  it("is idempotent", async () => {
    const { offerId, offerSku } = await makeOffer(sql);
    const item = await stock(sql, offerId, await makeLocation(sql), 3);
    const { orderId } = await order(sql, offerSku, 1);
    const lineId = await lineOf(sql, orderId);

    await allocateOrderLine(sql, lineId, ACTOR);
    const again = await allocateOrderLine(sql, lineId, ACTOR);
    await Promise.all([allocateOrderLine(sql, lineId, ACTOR), allocateOrderLine(sql, lineId, ACTOR)]);

    expect(again.status).toBe("ALREADY_ALLOCATED");
    expect(await stockRow(sql, item.id)).toMatchObject({ reserved: 1 });
  });

  it("splits a line across positions when needed", async () => {
    const { offerId, offerSku } = await makeOffer(sql);
    await stock(sql, offerId, await makeLocation(sql), 2);
    await stock(sql, offerId, await makeLocation(sql), 2);
    const { orderId } = await order(sql, offerSku, 3);

    const res = await allocateOrderLine(sql, await lineOf(sql, orderId), ACTOR);
    expect(res.status === "ALLOCATED" && res.allocations.map((a) => a.qty).sort()).toEqual([1, 2]);
  });

  it("allocates all lines of a multi-line order independently", async () => {
    const a = await makeOffer(sql);
    const b = await makeOffer(sql);
    await stock(sql, a.offerId, await makeLocation(sql), 1);
    const { orderId } = await importOrder(sql, {
      channel: "cardtrader", externalId: "CT-1", paymentStatus: "PAID", grossCents: 2000, currency: "EUR",
      orderedAt: new Date(),
      lines: [
        { externalLineId: "1", offerSku: a.offerSku, qty: 1, unitPriceCents: 1000 },
        { externalLineId: "2", offerSku: b.offerSku, qty: 1, unitPriceCents: 1000 },
      ],
    });
    const results = await allocateOrder(sql, orderId, ACTOR);
    expect(results.map((r) => r.status).sort()).toEqual(["ALLOCATED", "OVERSOLD"]);
  });
});

describe("oversell (Parcours F)", () => {
  it("lets exactly one of two concurrent orders take the last card", async () => {
    const { offerId, offerSku } = await makeOffer(sql, { isUnique: true });
    const item = await stock(sql, offerId, await makeLocation(sql), 1, "UNIQUE");
    const ebay = await order(sql, offerSku, 1, "E-1", "ebay");
    const ct = await order(sql, offerSku, 1, "C-1", "cardtrader");

    const results = await Promise.all([
      allocateOrderLine(sql, await lineOf(sql, ebay.orderId), ACTOR),
      allocateOrderLine(sql, await lineOf(sql, ct.orderId), ACTOR),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(["ALLOCATED", "OVERSOLD"]);
    expect(await stockRow(sql, item.id)).toMatchObject({ onHand: 1, reserved: 1 });

    // Offre mise en pause, incident ouvert, événement urgent dans l'outbox.
    const [offer] = await sql<{ status: string }[]>`select status from offers where id = ${offerId}`;
    expect(offer!.status).toBe("PAUSED");
    const incidents = await sql`select * from oversell_incidents`;
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ requestedQty: 1, availableQty: 0, resolution: null });
    const [evt] = await sql<{ payload: { urgent: boolean } }[]>`
      select payload from outbox_events where event_type = 'StockReservationFailed'`;
    expect(evt!.payload.urgent).toBe(true);
  });

  it("never over-reserves under heavy concurrency", async () => {
    const { offerId, offerSku } = await makeOffer(sql);
    await stock(sql, offerId, await makeLocation(sql), 3);
    await stock(sql, offerId, await makeLocation(sql), 2);
    const orders = await Promise.all(Array.from({ length: 12 }, (_, i) => order(sql, offerSku, 1, `R-${i}`)));
    const lineIds = await Promise.all(orders.map((o) => lineOf(sql, o.orderId)));

    const results = await Promise.all(lineIds.map((id) => allocateOrderLine(sql, id, ACTOR)));

    expect(results.filter((r) => r.status === "ALLOCATED")).toHaveLength(5);
    expect(results.filter((r) => r.status === "OVERSOLD")).toHaveLength(7);
    expect(await getOfferAvailability(sql, offerId)).toMatchObject({ availableToSell: 0, reserved: 5, onHand: 5 });
  });
});

describe("picking, packing and handover", () => {
  async function allocatedOrder(qtyPerPosition: number[] = [1]) {
    const { offerId, offerSku } = await makeOffer(sql);
    const items = [];
    for (const q of qtyPerPosition) items.push(await stock(sql, offerId, await makeLocation(sql), q));
    const { orderId } = await order(sql, offerSku, 1);
    const res = await allocateOrderLine(sql, await lineOf(sql, orderId), ACTOR);
    if (res.status !== "ALLOCATED") throw new Error("setup failed");
    return { offerId, items, orderId, allocation: res.allocations[0]! };
  }

  it("refuses a scan of the wrong card", async () => {
    const { allocation } = await allocatedOrder();
    const other = await makeOffer(sql);
    const wrong = await stock(sql, other.offerId, await makeLocation(sql), 1);

    await expect(
      pickAllocation(sql, { allocationId: allocation.id, scannedUnitSku: wrong.unitSku, actor: ACTOR }),
    ).rejects.toMatchObject({ code: "WRONG_ITEM" });
  });

  it("accepts a card from another position of the same offer and moves the reservation", async () => {
    const { items, allocation } = await allocatedOrder([1, 1]);
    const reservedOn = items.find((i) => i.id === allocation.stockItemId)!;
    const other = items.find((i) => i.id !== allocation.stockItemId)!;

    const picked = await pickAllocation(sql, { allocationId: allocation.id, scannedUnitSku: other.unitSku, actor: ACTOR });

    expect(picked).toMatchObject({ status: "PICKED", stockItemId: other.id });
    expect(await stockRow(sql, reservedOn.id)).toMatchObject({ reserved: 0 });
    expect(await stockRow(sql, other.id)).toMatchObject({ reserved: 1 });
  });

  it("ships out on handover of an untracked letter, idempotently", async () => {
    const { items, orderId, allocation } = await allocatedOrder();
    await pickAllocation(sql, { allocationId: allocation.id, scannedUnitSku: items[0]!.unitSku, actor: ACTOR });
    await packOrder(sql, orderId, ACTOR);
    const shipment = await createShipment(sql, { orderId, mode: "LETTER_UNTRACKED" });

    expect(await confirmHandover(sql, shipment.id, ACTOR)).toMatchObject({ status: "HANDED_OVER" });
    expect(await confirmHandover(sql, shipment.id, ACTOR)).toMatchObject({ status: "ALREADY_HANDED_OVER" });

    expect(await stockRow(sql, items[0]!.id)).toMatchObject({ onHand: 0, reserved: 0, lifecycle: "ARCHIVED" });
    const [o] = await sql<{ fulfillmentStatus: string }[]>`select fulfillment_status from orders where id = ${orderId}`;
    expect(o!.fulfillmentStatus).toBe("SHIPPED");
    const [s] = await sql<{ tracking: string | null; handoverConfirmedBy: string }[]>`
      select tracking, handover_confirmed_by from shipments where id = ${shipment.id}`;
    expect(s).toMatchObject({ tracking: null, handoverConfirmedBy: ACTOR });
  });

  it("confirms a batch of 10 untracked letters without any tracking number", async () => {
    const shipmentIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const { items, orderId, allocation } = await allocatedOrder();
      await pickAllocation(sql, { allocationId: allocation.id, scannedUnitSku: items[0]!.unitSku, actor: ACTOR });
      await packOrder(sql, orderId, ACTOR);
      shipmentIds.push((await createShipment(sql, { orderId, mode: "LETTER_UNTRACKED" })).id);
    }
    const results = await confirmHandoverBatch(sql, shipmentIds, ACTOR);
    expect(results.every((r) => r.status === "HANDED_OVER")).toBe(true);
  });

  it("refuses handover of a tracked shipment without tracking, and of an unpacked order", async () => {
    const { items, orderId } = await allocatedOrder();
    const tracked = await createShipment(sql, { orderId, mode: "LETTER_TRACKED" });
    const results = await confirmHandoverBatch(sql, [tracked.id], ACTOR);
    expect(results[0]).toMatchObject({ status: "REJECTED", code: "TRACKING_REQUIRED" });

    const letter = await createShipment(sql, { orderId, mode: "LETTER_UNTRACKED" });
    await expect(confirmHandover(sql, letter.id, ACTOR)).rejects.toMatchObject({ code: "NOT_FULLY_PACKED" });
    expect(await stockRow(sql, items[0]!.id)).toMatchObject({ onHand: 1, reserved: 1 });
  });

  it("cancellation before handover makes the card sellable again", async () => {
    const { offerId, allocation } = await allocatedOrder();
    expect((await getOfferAvailability(sql, offerId)).availableToSell).toBe(0);

    await releaseAllocation(sql, allocation.id, ACTOR, "buyer cancelled");

    expect((await getOfferAvailability(sql, offerId)).availableToSell).toBe(1);
  });

  it("keeps counters equal to the replay of the movement journal", async () => {
    const { items, orderId, allocation } = await allocatedOrder([2]);
    await pickAllocation(sql, { allocationId: allocation.id, scannedUnitSku: items[0]!.unitSku, actor: ACTOR });
    await packOrder(sql, orderId, ACTOR);
    await confirmHandover(sql, (await createShipment(sql, { orderId, mode: "LETTER_UNTRACKED" })).id, ACTOR);

    const drift = await sql`
      select s.id from stock_items s
      left join lateral (
        select coalesce(sum(qty_delta) filter (where bucket = 'on_hand'), 0)  as on_hand,
               coalesce(sum(qty_delta) filter (where bucket = 'reserved'), 0) as reserved
          from inventory_movements m where m.stock_item_id = s.id
      ) j on true
      where j.on_hand <> s.on_hand or j.reserved <> s.reserved`;
    expect(drift).toHaveLength(0);
  });
});
