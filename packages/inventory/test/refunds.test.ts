import { describe, expect, it } from "vitest";
import { importOrder, refundOrder, setOrderFees } from "../src";
import { ACTOR, makeLocation, makeOffer, stock, useTestDb } from "./helpers";

const sql = useTestDb();

async function twoLineOrder() {
  const loc = await makeLocation(sql);
  const a = await makeOffer(sql);
  const b = await makeOffer(sql);
  await stock(sql, a.offerId, loc, 5);
  await stock(sql, b.offerId, loc, 5);
  const { orderId } = await importOrder(sql, {
    channel: "ebay", externalId: "EB-1", paymentStatus: "PAID", grossCents: 1000, currency: "EUR", orderedAt: new Date(),
    lines: [{ externalLineId: "1", offerSku: a.offerSku, qty: 1, unitPriceCents: 700 }, { externalLineId: "2", offerSku: b.offerSku, qty: 1, unitPriceCents: 300 }],
  });
  return orderId;
}

describe("marketplace fees (#95)", () => {
  it("spreads the order fee over its lines in proportion, to the cent, and notes the fees as known", async () => {
    const orderId = await twoLineOrder();
    await setOrderFees(sql, orderId, 101);
    const lines = await sql<{ fee: number }[]>`select fee_allocated_cents as fee from order_lines where order_id = ${orderId} order by external_line_id`;
    expect(lines.map((l) => l.fee)).toEqual([71, 30]); // 70,7 et 30,3 : le centime restant va au plus fort reste
    const [order] = await sql<{ feesSyncedAt: Date | null }[]>`select fees_synced_at from orders where id = ${orderId}`;
    expect(order!.feesSyncedAt).toBeInstanceOf(Date);
    await setOrderFees(sql, orderId, 0);
    expect((await sql`select 1 from order_lines where order_id = ${orderId} and fee_allocated_cents <> 0`).length).toBe(0);
  });
});

describe("refunds (#96)", () => {
  it("refunds a handed-over sale once, with its event; a sale not handed over is cancelled instead", async () => {
    const orderId = await twoLineOrder();
    await expect(refundOrder(sql, orderId, ACTOR, "test")).rejects.toMatchObject({ code: "NOT_SHIPPED" });
    await sql`update orders set fulfillment_status = 'SHIPPED' where id = ${orderId}`;
    await refundOrder(sql, orderId, ACTOR, "carte abîmée");
    await refundOrder(sql, orderId, ACTOR, "rejoué");
    const [order] = await sql<{ paymentStatus: string; refundedAt: Date | null }[]>`select payment_status, refunded_at from orders where id = ${orderId}`;
    expect(order).toMatchObject({ paymentStatus: "REFUNDED" });
    expect(order!.refundedAt).toBeInstanceOf(Date);
    const events = await sql`select 1 from account_events where dedupe_key = ${`sale_refunded:${orderId}`}`;
    expect(events.length).toBe(1);
    expect((await sql`select 1 from audit_events where action = 'order_refunded'`).length).toBe(1);
  });
});
