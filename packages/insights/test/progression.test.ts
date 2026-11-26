import { describe, expect, it } from "vitest";
import { recordEvent } from "@dexlane/db";
import { cancelOrder } from "@dexlane/inventory";
import {
  achievementsSince, confirmedSales, evaluateProgress, getProgress, levelFor, levelState, rebuildJournal, revokeAchievement,
} from "../src";
import { ACTOR, DAY, daysFrom, listedAt, makeOffer, sellAt, stockAt, useTestDb } from "./helpers";

const sql = useTestDb();
const TZ = "Europe/Paris";
const now = new Date();
const evaluate = (opts: { now?: Date; grant?: boolean } = {}) =>
  evaluateProgress(sql, {
    timezone: TZ, now: opts.now,
    hooks: opts.grant ? { grantBonusCards: async (tx, cards) => {
      await tx`insert into quota_packs (month, cards, price_cents, automatic, actor) values (date_trunc('month', now())::date, ${cards}, 0, true, 'progression')`;
      return { cards };
    } } : undefined,
  });

async function soldCards(n: number, opts: { daysAgo?: number; channel?: string; graded?: boolean; country?: string } = {}) {
  const o = await makeOffer(sql, { graded: opts.graded });
  await stockAt(sql, o.offerId, opts.graded ? 1 : n, daysFrom(now, -400));
  // Une commande de n exemplaires : n ventes (une vente = une unité vendue).
  const orderId = await sellAt(sql, o.offerSku, daysFrom(now, -(opts.daysAgo ?? 30)), { qty: opts.graded ? 1 : n, channel: opts.channel, country: opts.country });
  return { ...o, orders: [orderId] };
}

describe("level (D1)", () => {
  it("follows the confirmed sales thresholds; level 1 comes with the finished onboarding or the first confirmed sale", () => {
    expect(levelFor(0, false)).toBe(0);
    expect(levelFor(0, true)).toBe(1);
    expect(levelFor(1, false)).toBe(1);
    expect(levelFor(10, false)).toBe(2);
    expect(levelFor(49, false)).toBe(2);
    expect(levelFor(50, false)).toBe(3);
    expect(levelFor(40000, false)).toBe(10);
    expect(levelState(2, 30)).toEqual({ level: 2, confirmedSales: 30, next: { level: 3, threshold: 50, salesNeeded: 20 }, progressPercent: 50 });
    expect(levelState(10, 50000).next).toBeNull();
  });

  it("counts a sale only after the confirmation delay, and never one cancelled, refunded or returned before it", async () => {
    await soldCards(3, { daysAgo: 20 }); // confirmées
    await soldCards(2, { daysAgo: 5 }); // trop récentes
    const cancelled = await soldCards(1, { daysAgo: 20 });
    await cancelOrder(sql, cancelled.orders[0]!, ACTOR, "test");
    const refunded = await soldCards(1, { daysAgo: 20 });
    await recordEvent(sql, { type: "sale_refunded", key: `sale_refunded:${refunded.orders[0]}`, payload: { orderId: refunded.orders[0] } });
    await soldCards(1, { daysAgo: 20, channel: "direct" }); // vente directe : pas une vente d'annonce

    const r = await evaluate();
    expect(r.confirmed).toBe(3);
    expect(await confirmedSales(sql)).toBe(3);
    expect(r.level).toBe(1);

    // Quinze jours plus tard, les deux ventes récentes sont confirmées à leur tour.
    expect((await evaluate({ now: daysFrom(now, 15) })).confirmed).toBe(5);
  });

  it("never goes down, even when a confirmed sale is later returned", async () => {
    const big = await soldCards(10, { daysAgo: 30 });
    expect((await evaluate()).level).toBe(2);
    await sql`insert into shipments (order_id, mode, status) values (${big.orders[0]!}, 'LETTER_UNTRACKED', 'RETURNED')`;
    const again = await evaluate();
    expect(again).toMatchObject({ level: 2, confirmed: 10 });
    expect((await getProgress(sql)).level).toMatchObject({ level: 2, next: { level: 3, salesNeeded: 40 } });
  });

  it("gives no point for published listings", async () => {
    const o = await makeOffer(sql);
    for (let i = 0; i < 30; i++) await listedAt(sql, o.offerId, daysFrom(now, -i), { channel: i % 2 ? "ebay" : "cardtrader", status: "ENDED" });
    await rebuildJournal(sql);
    const r = await evaluate();
    expect(r.level).toBe(0);
    expect(r.unlocked).toEqual(["first_listing"]);
  });
});

describe("achievements (D2, D5)", () => {
  it("are attributed once: an evaluation or an event replayed gives nothing more", async () => {
    await soldCards(1, { daysAgo: 20 });
    const first = await evaluate();
    expect(first.unlocked).toEqual(["first_sale"]);
    expect(first.retroactive).toBe(false);
    // Même événement rejoué : déjà au journal, rien ne change.
    const [event] = await sql<{ dedupeKey: string; type: "sale_paid" }[]>`select dedupe_key, type from account_events where type = 'sale_paid'`;
    expect(await recordEvent(sql, { type: event!.type, key: event!.dedupeKey })).toBe(false);
    expect((await evaluate()).unlocked).toEqual([]);
    await Promise.all([evaluate(), evaluate()]);
    const [count] = await sql<{ n: number }[]>`select count(*)::int as n from account_achievements`;
    expect(count!.n).toBe(1);
  });

  it("unlocks graded and export sales once confirmed", async () => {
    await soldCards(1, { daysAgo: 20, graded: true, country: "FR" });
    expect((await evaluate()).unlocked.sort()).toEqual(["first_sale", "graded_sale"]);
    await soldCards(1, { daysAgo: 20, country: "BE" });
    expect((await evaluate()).unlocked).toEqual(["export"]);
  });

  it("measures speed, regularity (ISO weeks) and flawless days from the journal", async () => {
    // 100 annonces en 59 minutes : record ; la régularité compte les semaines, pas les jours.
    const start = new Date("2026-06-01T08:00:00Z");
    for (let i = 0; i < 100; i++) {
      await recordEvent(sql, { type: "listing_published", key: `listing_published:burst-${i}`, occurredAt: new Date(start.getTime() + i * 35_000) });
    }
    for (let w = 1; w <= 7; w++) {
      await recordEvent(sql, { type: "listing_published", key: `listing_published:week-${w}`, occurredAt: new Date(start.getTime() + w * 7 * DAY) });
    }
    let r = await evaluate();
    expect(r.unlocked.sort()).toEqual(["first_listing", "record_session", "regular"]);

    // Sans faute : 30 jours d'affilée à 20 annonces ou plus, sans échec. Un échec casse la série.
    const day0 = new Date("2026-08-01T10:00:00Z");
    for (let d = 0; d < 30; d++) {
      for (let i = 0; i < 20; i++) {
        await recordEvent(sql, { type: "listing_published", key: `listing_published:d${d}-${i}`, occurredAt: new Date(day0.getTime() + d * DAY + i * 60_000) });
      }
    }
    await recordEvent(sql, { type: "listing_failed", key: "listing_failed:x", occurredAt: new Date(day0.getTime() + 15 * DAY) });
    expect((await evaluate()).unlocked).toEqual([]);
    for (let i = 0; i < 20; i++) {
      await recordEvent(sql, { type: "listing_published", key: `listing_published:d30-${i}`, occurredAt: new Date(day0.getTime() + 30 * DAY + i * 60_000) });
    }
    expect((await evaluate()).unlocked).toEqual([]); // 15 + 15 jours : toujours pas 30 d'affilée
    await sql`delete from account_events where dedupe_key = 'listing_failed:x'`;
    r = await evaluate();
    expect(r.unlocked).toEqual(["flawless"]);
  });

  it("applies level perks once: early access at level 3, bonus cards only where billing exists", async () => {
    await soldCards(50, { daysAgo: 30 });
    const community = await evaluate();
    expect(community.level).toBe(3);
    expect(community.perksApplied).toEqual([{ level: 3, perk: "beta" }]);
    expect((await getProgress(sql)).beta).toBe(true);
    expect((await evaluate()).perksApplied).toEqual([]);

    await soldCards(350, { daysAgo: 30 }); // 400 ventes : niveau 5
    const hosted = await evaluate({ grant: true });
    expect(hosted.level).toBe(5);
    expect(hosted.perksApplied).toEqual([{ level: 5, perk: "bonusCards" }]);
    const [pack] = await sql<{ cards: number; priceCents: number }[]>`select cards, price_cents from quota_packs`;
    expect(pack).toEqual({ cards: 100, priceCents: 0 });
    await evaluate({ grant: true });
    expect((await sql`select 1 from quota_packs`).length).toBe(1);
  });

  it("are never taken back, except for fraud by a manual admin action", async () => {
    await soldCards(1, { daysAgo: 20 });
    await evaluate();
    expect(await revokeAchievement(sql, { achievement: "first_sale", reason: "ventes fictives", actor: "admin" })).toBe(true);
    await evaluate();
    const view = await getProgress(sql);
    expect(view.achievements.find((a) => a.id === "first_sale")!.unlockedAt).toBeNull();
  });

  it("notifies live unlocks as one group, after what the user has already seen", async () => {
    await soldCards(1, { daysAgo: 20, graded: true });
    await evaluate();
    const seen = await achievementsSince(sql, null);
    expect(seen.map((a) => a.id).sort()).toEqual(["first_sale", "graded_sale"]);
    expect(await achievementsSince(sql, new Date(Date.now() + 1000))).toEqual([]);
  });
});

describe("retroactive attribution at launch (D5)", () => {
  it("computes level and achievements from an existing history, silently, once", async () => {
    // Compte existant au lancement (la migration lui pose une progression « rétroactive en attente »).
    await sql`insert into account_progress (retroactive_pending) values (true)`;
    const shop = await makeOffer(sql, { name: "Historique" });
    await stockAt(sql, shop.offerId, 15, new Date("2025-01-01T00:00:00Z"));
    await listedAt(sql, shop.offerId, new Date("2025-01-02T00:00:00Z"));
    for (let i = 0; i < 12; i++) await sellAt(sql, shop.offerSku, new Date(Date.UTC(2025, 1, 1 + i)));
    await sql`delete from account_events`; // l'historique précède le journal

    await rebuildJournal(sql);
    const r = await evaluate();
    expect(r).toMatchObject({ retroactive: true, level: 2, confirmed: 12 });
    expect(r.unlocked.sort()).toEqual(["first_listing", "first_sale"]);
    // Rien à annoncer une à une : ces succès sont rétroactifs ; un message unique les résume.
    expect(await achievementsSince(sql, null)).toEqual([]);
    expect((await getProgress(sql)).retroactiveCount).toBe(2);

    // Ensuite, les nouveaux succès redeviennent des succès « en direct ».
    await soldCards(1, { daysAgo: 20, graded: true });
    const next = await evaluate();
    expect(next).toMatchObject({ retroactive: false, unlocked: ["graded_sale"] });
    expect((await achievementsSince(sql, null)).map((a) => a.id)).toEqual(["graded_sale"]);
  });
});
