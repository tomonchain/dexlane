import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { createLocation, receiveCard } from "@dexlane/inventory";
import { applyOrderUpdates, ingestChannelOrder, setChannelMode, syncChannels, toOrderUpdate, type ChannelAdapter, type ChannelOrderUpdate, type EbayOrder } from "../src";

const sql = useTestDb("listings");
const ACTOR = "test";
let seq = 0;

async function ebayOrder(externalId: string, opts: { shipped?: boolean } = {}) {
  const n = ++seq;
  const [card] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language) values ('base1', ${String(n)}, ${`Carte ${n}`}, 'fr') returning id`;
  const [variant] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish) values (${card!.id}, 'holo') returning id`;
  await createLocation(sql, { code: "BOX-01" });
  const r = await receiveCard(sql, { variantId: variant!.id, condition: "NM", quantity: 2, location: { code: "BOX-01" }, unitCostCents: 100, actor: ACTOR });
  const { orderId } = await ingestChannelOrder(sql, "ebay", {
    externalId, orderedAt: new Date(), buyerName: "Camille", shippingChargedCents: 0, shippingMode: "LETTER_TRACKED",
    lines: [{ externalLineId: "L1", offerSku: r.offer.offerSku, qty: 1, unitPriceCents: 1500 }],
  }, ACTOR);
  if (opts.shipped) await sql`update orders set fulfillment_status = 'SHIPPED' where id = ${orderId}`;
  return orderId;
}

const state = async (orderId: string) => (await sql<{ fulfillmentStatus: string; paymentStatus: string; feesSyncedAt: Date | null; fee: number }[]>`
  select o.fulfillment_status, o.payment_status, o.fees_synced_at, (select sum(fee_allocated_cents)::int from order_lines where order_id = o.id) as fee
    from orders o where o.id = ${orderId}`)[0]!;

describe("eBay order updates (#95, #96)", () => {
  it("reads fees, full refunds and cancellations from an eBay order", () => {
    const base: EbayOrder = { orderId: "1", creationDate: "2026-11-20T10:00:00Z", orderPaymentStatus: "PAID", lineItems: [{ lineItemId: "L1", sku: "OF-1", quantity: 1 }] };
    expect(toOrderUpdate({ ...base, totalMarketplaceFee: { value: "1.87", currency: "EUR" } })).toEqual({ externalId: "1", feeCents: 187, refunded: false, cancelled: false });
    expect(toOrderUpdate({ ...base, orderPaymentStatus: "FULLY_REFUNDED" })).toMatchObject({ feeCents: null, refunded: true });
    expect(toOrderUpdate({ ...base, orderPaymentStatus: "PARTIALLY_REFUNDED" })).toMatchObject({ refunded: false });
    expect(toOrderUpdate({ ...base, cancelStatus: { cancelState: "CANCELED" } })).toMatchObject({ cancelled: true });
    expect(toOrderUpdate({ ...base, lineItems: [{ lineItemId: "L1", quantity: 1 }] })).toBeNull(); // annonce faite à la main sur eBay
  });

  it("sets fees, cancels an order not handed over, refunds a handed-over one, and ignores unknown orders", async () => {
    const pending = await ebayOrder("E-PENDING");
    const shipped = await ebayOrder("E-SHIPPED", { shipped: true });
    const updates: ChannelOrderUpdate[] = [
      { externalId: "E-PENDING", feeCents: 190, refunded: false, cancelled: true },
      { externalId: "E-SHIPPED", feeCents: 210, refunded: true, cancelled: false },
      { externalId: "E-UNKNOWN", feeCents: 99, refunded: true, cancelled: false },
    ];
    expect(await applyOrderUpdates(sql, "ebay", updates, ACTOR)).toEqual({ fees: 2, refunded: 1, cancelled: 1 });
    expect(await state(pending)).toMatchObject({ fulfillmentStatus: "CANCELLED", fee: 190 });
    expect(await state(shipped)).toMatchObject({ fulfillmentStatus: "SHIPPED", paymentStatus: "REFUNDED", fee: 210 });
    // Rejoué : rien de plus.
    expect(await applyOrderUpdates(sql, "ebay", updates, ACTOR)).toEqual({ fees: 0, refunded: 0, cancelled: 0 });
  });

  it("applies the updates during the channel synchronisation", async () => {
    const orderId = await ebayOrder("E-SYNC", { shipped: true });
    const adapter: ChannelAdapter = {
      publish: async () => ({ externalId: "x", url: null }), setQuantity: async () => undefined, end: async () => undefined,
      fetchOrders: async () => [],
      fetchOrderUpdates: async () => [{ externalId: "E-SYNC", feeCents: 155, refunded: false, cancelled: false }],
    };
    await setChannelMode(sql, { ebay: adapter }, "ebay", "LIVE", ACTOR);
    await syncChannels(sql, { ebay: adapter }, ACTOR);
    expect(await state(orderId)).toMatchObject({ fee: 155, paymentStatus: "PAID" });
    expect((await state(orderId)).feesSyncedAt).toBeInstanceOf(Date);
  });
});
