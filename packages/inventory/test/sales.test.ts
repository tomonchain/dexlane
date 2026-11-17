import { describe, expect, it } from "vitest";
import {
  cancelOrder, createDirectSale, createLocation, getOfferAvailability, getOrderDetail, listOrders, packOrder, pickAllocation,
  receiveCard, searchSellableOffers, shipOrder,
} from "../src";
import { ACTOR, journalDrift, makeVariant, stockRow, useTestDb } from "./helpers";

const sql = useTestDb();
const count = async (table: string) => (await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table}`))[0]!.n;

async function stocked(name: string, quantity: number, unitCostCents = 100, location = "BOX-01") {
  await createLocation(sql, { code: location });
  const { variantId } = await makeVariant(sql, { name });
  return receiveCard(sql, { variantId, condition: "NM", quantity, location: { code: location }, unitCostCents, actor: ACTOR });
}
const sale = (lines: { offerId: string; qty: number; unitPriceCents: number }[], over: Partial<Parameters<typeof createDirectSale>[1]> = {}) =>
  createDirectSale(sql, { lines, shippingMode: "LETTER_UNTRACKED", actor: ACTOR, ...over });

/** Prélève toutes les réservations d'une vente en scannant la position prévue, puis emballe. */
async function prepare(orderId: string) {
  for (const line of (await getOrderDetail(sql, orderId)).lines) {
    for (const a of line.allocations) await pickAllocation(sql, { allocationId: a.id, scannedUnitSku: a.unitSku, actor: ACTOR });
  }
  await packOrder(sql, orderId, ACTOR);
}

describe("direct sale", () => {
  it("reserves the cards at once and tells where to pick them", async () => {
    const pika = await stocked("Pikachu", 3, 100, "BOX-01/ROW-02");
    const mew = await stocked("Mewtwo", 1, 4000);
    const { orderId, externalId } = await sale(
      [{ offerId: pika.offer.id, qty: 2, unitPriceCents: 500 }, { offerId: mew.offer.id, qty: 1, unitPriceCents: 9000 }],
      { shippingChargedCents: 250, buyerName: " Camille ", note: "salon de Lyon" },
    );

    expect(externalId).toMatch(/^V-\d{6}$/);
    expect((await getOfferAvailability(sql, pika.offer.id)).availableToSell).toBe(1);
    const detail = await getOrderDetail(sql, orderId);
    expect(detail).toMatchObject({
      channel: "direct", stage: "TO_PREPARE", buyerName: "Camille", note: "salon de Lyon", cards: 3, cardNames: ["Pikachu", "Mewtwo"],
      shipment: { mode: "LETTER_UNTRACKED", status: "PENDING" },
      totals: { grossCents: 10250, itemsCents: 10000, shippingChargedCents: 250, costCents: 4200, postageCents: 0, marginCents: 6050 },
    });
    expect(detail.lines[0]).toMatchObject({
      qty: 2, unitPriceCents: 500, card: { name: "Pikachu" },
      allocations: [{ status: "RESERVED", qty: 2, unitSku: pika.stockItem.unitSku, locationCode: "BOX-01/ROW-02" }],
    });
    expect((await listOrders(sql)).counts).toEqual({ TO_PREPARE: 1, PACKED: 0, SHIPPED: 0, CANCELLED: 0 });
  });

  it("refuses a sale the stock cannot cover and leaves no trace", async () => {
    const pika = await stocked("Pikachu", 1);
    await expect(sale([{ offerId: pika.offer.id, qty: 2, unitPriceCents: 500 }])).rejects.toMatchObject({
      code: "INSUFFICIENT_STOCK", details: { requested: 2, available: 1 },
    });
    expect([await count("orders"), await count("oversell_incidents"), await count("order_allocations")]).toEqual([0, 0, 0]);
    expect((await getOfferAvailability(sql, pika.offer.id)).availableToSell).toBe(1);

    await expect(sale([])).rejects.toMatchObject({ code: "EMPTY_ORDER" });
    await expect(sale([{ offerId: pika.offer.id, qty: 1, unitPriceCents: 1 }, { offerId: pika.offer.id, qty: 1, unitPriceCents: 1 }]))
      .rejects.toMatchObject({ code: "DUPLICATE_LINE" });
    await expect(sale([{ offerId: "00000000-0000-4000-8000-000000000000", qty: 1, unitPriceCents: 1 }])).rejects.toMatchObject({ code: "OFFER_NOT_FOUND" });
  });

  it("goes through picking, packing and handover, then counts in the 30-day totals", async () => {
    const pika = await stocked("Pikachu", 3, 100);
    const { orderId } = await sale([{ offerId: pika.offer.id, qty: 2, unitPriceCents: 500 }]);

    await expect(shipOrder(sql, { orderId, actor: ACTOR })).rejects.toMatchObject({ code: "NOT_FULLY_PACKED" });
    await prepare(orderId);
    expect((await getOrderDetail(sql, orderId)).stage).toBe("PACKED");
    expect(await stockRow(sql, pika.stockItem.id)).toMatchObject({ onHand: 3, reserved: 2 });

    expect(await shipOrder(sql, { orderId, postageCostCents: 143, actor: ACTOR })).toMatchObject({ status: "HANDED_OVER" });
    expect(await stockRow(sql, pika.stockItem.id)).toMatchObject({ onHand: 1, reserved: 0 });
    const shipped = await getOrderDetail(sql, orderId);
    expect(shipped).toMatchObject({ stage: "SHIPPED", totals: { grossCents: 1000, costCents: 200, postageCents: 143, marginCents: 657 } });
    expect(shipped.lines[0]!.allocations[0]!.status).toBe("SHIPPED");

    const list = await listOrders(sql, { stage: "SHIPPED" });
    expect(list.items).toHaveLength(1);
    expect(list.last30Days).toEqual({ orders: 1, grossCents: 1000, costCents: 200, postageCents: 143, marginCents: 657 });
    expect(await shipOrder(sql, { orderId, actor: ACTOR })).toMatchObject({ status: "ALREADY_HANDED_OVER" });
    expect(await journalDrift(sql)).toHaveLength(0);
  });

  it("requires a tracking number for tracked modes only", async () => {
    const a = await stocked("Pikachu", 2);
    const tracked = await sale([{ offerId: a.offer.id, qty: 1, unitPriceCents: 2000 }], { shippingMode: "LETTER_TRACKED" });
    const inPerson = await sale([{ offerId: a.offer.id, qty: 1, unitPriceCents: 2000 }], { shippingMode: "HAND_DELIVERY" });
    await prepare(tracked.orderId);
    await prepare(inPerson.orderId);

    await expect(shipOrder(sql, { orderId: tracked.orderId, actor: ACTOR })).rejects.toMatchObject({ code: "TRACKING_REQUIRED" });
    expect(await shipOrder(sql, { orderId: tracked.orderId, tracking: " 1A2B3C ", actor: ACTOR })).toMatchObject({ status: "HANDED_OVER" });
    expect((await getOrderDetail(sql, tracked.orderId)).shipment).toMatchObject({ tracking: "1A2B3C", status: "HANDED_OVER" });
    expect(await shipOrder(sql, { orderId: inPerson.orderId, actor: ACTOR })).toMatchObject({ status: "HANDED_OVER" });
  });

  it("cancels before handover, freeing the cards, and refuses afterwards", async () => {
    const pika = await stocked("Pikachu", 2);
    const first = await sale([{ offerId: pika.offer.id, qty: 2, unitPriceCents: 500 }]);
    await prepare(first.orderId);
    await cancelOrder(sql, first.orderId, ACTOR, "acheteur désisté");

    expect(await stockRow(sql, pika.stockItem.id)).toMatchObject({ onHand: 2, reserved: 0 });
    expect(await getOrderDetail(sql, first.orderId)).toMatchObject({ stage: "CANCELLED", shipment: null, totals: { costCents: 0 } });
    await cancelOrder(sql, first.orderId, ACTOR, "encore"); // sans effet
    expect(await count("audit_events")).toBe(1);

    const second = await sale([{ offerId: pika.offer.id, qty: 2, unitPriceCents: 500 }]);
    await prepare(second.orderId);
    await shipOrder(sql, { orderId: second.orderId, actor: ACTOR });
    await expect(cancelOrder(sql, second.orderId, ACTOR, "trop tard")).rejects.toMatchObject({ code: "ALREADY_SHIPPED" });
    expect(await journalDrift(sql)).toHaveLength(0);
  });

  it("offers only what is actually available to sell", async () => {
    const pika = await stocked("Pikachu", 1);
    await stocked("Évoli", 2);
    expect((await searchSellableOffers(sql)).map((o) => [o.card.name, o.availableToSell])).toEqual([["Évoli", 2], ["Pikachu", 1]]);
    expect((await searchSellableOffers(sql, { q: "evo" })).map((o) => o.card.name)).toEqual(["Évoli"]);
    await sale([{ offerId: pika.offer.id, qty: 1, unitPriceCents: 500 }]);
    expect((await searchSellableOffers(sql)).map((o) => o.card.name)).toEqual(["Évoli"]);
  });
});
