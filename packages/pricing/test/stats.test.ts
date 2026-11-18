import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { createDirectSale, createLocation, packOrder, pickAllocation, receiveCard, shipOrder } from "@dexlane/inventory";
import { DEFAULT_ALERT_SETTINGS, getAlertSettings, getDashboard, listPriceMoves, saveAlertSettings } from "../src";

const sql = useTestDb("pricing");
const ACTOR = "test";
let seq = 0;

/** Carte en stock avec un historique de cote : `[joursAvant, centimes]`. */
async function owned(name: string, history: [number, number][], opts: { quantity?: number; target?: number } = {}) {
  const n = ++seq;
  const [card] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language) values ('base1', ${String(n)}, ${name}, 'fr') returning id`;
  const [v] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish) values (${card!.id}, 'holo') returning id`;
  for (const [daysAgo, cents] of history) {
    await sql`
      insert into price_snapshots (variant_id, source, quote_type, currency, amount_cents, observed_at)
      values (${v!.id}, 'cardmarket', 'LISTED_TREND', 'EUR', ${cents}, now() - make_interval(secs => ${daysAgo * 86400 + 60}))`;
  }
  await createLocation(sql, { code: "BOX-01" });
  const r = await receiveCard(sql, { variantId: v!.id, condition: "NM", quantity: opts.quantity ?? 1, location: { code: "BOX-01" }, unitCostCents: 100, actor: ACTOR });
  if (opts.target) await sql`update offers set target_price_cents = ${opts.target}, category = 'SINGLE' where id = ${r.offer.id}`;
  return { variantId: v!.id, offerId: r.offer.id };
}

describe("price moves on owned cards", () => {
  it("compares the latest quote with the one from before the window and flags moves beyond the thresholds", async () => {
    await owned("Dracaufeu", [[30, 20000], [8, 21000], [3, 24000], [0, 26000]], { target: 22000 });
    await owned("Rattata", [[10, 10], [0, 20]]); // +100 % mais 10 centimes : pas une alerte
    await owned("Pikachu", [[9, 1000], [0, 1050]], { quantity: 4 }); // +5 % : sous le seuil
    await owned("Mewtwo", [[2, 5000], [0, 9000]]); // aucun relevé d'avant la fenêtre
    await owned("Tortank", [[9, 8000], [0, 6000]], { quantity: 3 });

    const r = await listPriceMoves(sql);
    expect(r).toMatchObject({ settings: DEFAULT_ALERT_SETTINGS, alerts: 2, ownedVariants: 5, trackedVariants: 5 });
    expect(r.latestQuoteAt).toBeInstanceOf(Date);
    // Alertes d'abord, puis par enjeu (écart × exemplaires).
    expect(r.moves.map((m) => [m.cardName, m.deltaCents, m.deltaPercent, m.alert])).toEqual([
      ["Tortank", -2000, -25, true],
      ["Dracaufeu", 5000, 23.8, true],
      ["Pikachu", 50, 5, false],
      ["Rattata", 10, 100, false],
    ]);
    const charizard = r.moves[1]!;
    expect(charizard).toMatchObject({ previousCents: 21000, latestCents: 26000, quantity: 1, targetPriceCents: 22000 });
    expect(charizard.series.map((p) => p.cents)).toEqual([20000, 21000, 24000, 26000]);
    expect((await listPriceMoves(sql, { alertsOnly: true })).moves).toHaveLength(2);
  });

  it("applies saved alert settings and refuses nonsensical ones", async () => {
    await owned("Pikachu", [[9, 1000], [0, 1050]]);
    expect((await listPriceMoves(sql)).alerts).toBe(0);
    await saveAlertSettings(sql, { windowDays: 7, percent: 5, minChangeCents: 50 });
    expect(await getAlertSettings(sql)).toEqual({ windowDays: 7, percent: 5, minChangeCents: 50 });
    expect((await listPriceMoves(sql)).alerts).toBe(1);
    await expect(saveAlertSettings(sql, { windowDays: 0, percent: 5, minChangeCents: 50 })).rejects.toMatchObject({ code: "INVALID_ALERT_SETTINGS" });
  });

  it("reports nothing to compare without failing when quotes are missing", async () => {
    await owned("Sans cote", []);
    expect(await listPriceMoves(sql)).toMatchObject({ moves: [], alerts: 0, ownedVariants: 1, trackedVariants: 0, latestQuoteAt: null });
  });
});

describe("dashboard", () => {
  it("summarises stock value by category and shipped sales by month and channel", async () => {
    const a = await owned("Dracaufeu", [], { quantity: 2, target: 10000 });
    await owned("Rattata", []);
    const { orderId } = await createDirectSale(sql, { lines: [{ offerId: a.offerId, qty: 1, unitPriceCents: 9000 }], shippingMode: "HAND_DELIVERY", actor: ACTOR });
    const allocations = await sql<{ id: string; unitSku: string }[]>`
      select a.id, s.unit_sku from order_allocations a
        join order_lines l on l.id = a.order_line_id join stock_items s on s.id = a.stock_item_id
       where l.order_id = ${orderId}`;
    for (const a of allocations) await pickAllocation(sql, { allocationId: a.id, scannedUnitSku: a.unitSku, actor: ACTOR });
    await packOrder(sql, orderId, ACTOR);
    await shipOrder(sql, { orderId, actor: ACTOR });
    await createDirectSale(sql, { lines: [{ offerId: a.offerId, qty: 1, unitPriceCents: 9000 }], shippingMode: "HAND_DELIVERY", actor: ACTOR });

    const d = await getDashboard(sql);
    expect(d.stock.cards).toBe(2);
    expect(d.byCategory).toEqual([{ category: "SINGLE", cards: 1, valueCents: 10000 }, { category: "REVIEW", cards: 1, valueCents: 0 }]);
    expect(d.months).toHaveLength(6);
    expect(d.months.at(-1)).toMatchObject({ orders: 1, cards: 1, revenueCents: 9000, marginCents: 8900 });
    expect(d.months.slice(0, 5).every((m) => m.orders === 0 && m.revenueCents === 0)).toBe(true);
    expect(d.byChannel).toEqual([{ channel: "direct", orders: 1, revenueCents: 9000 }]);
    expect(d.openOrders).toBe(1);
    expect(d.topOffers[0]).toMatchObject({ cardName: "Dracaufeu", quantity: 1, unitCents: 10000 });
  });
});
