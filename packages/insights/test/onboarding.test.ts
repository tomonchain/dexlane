import { describe, expect, it } from "vitest";
import { createLocation, markSlipsPrinted, receiveCard } from "@dexlane/inventory";
import { writeEbayConfig } from "@dexlane/listings";
import { onboardingState, rebuildJournal } from "../src";
import { ACTOR, listedAt, makeOffer, sellAt, stockAt, useTestDb } from "./helpers";

const sql = useTestDb();

describe("getting started (B1)", () => {
  it("detects each step from the data, with the next step to do", async () => {
    let s = await onboardingState(sql);
    expect(s).toMatchObject({ done: 0, total: 7, percent: 0, complete: false });
    expect(s.next?.id).toBe("ebay");

    await sql`insert into channel_accounts (channel, environment, refresh_token) values ('ebay', 'sandbox', 'r')`;
    s = await onboardingState(sql);
    expect(s.steps.filter((x) => x.done).map((x) => x.id)).toEqual(["ebay"]);
    expect(s.next?.id).toBe("policies");

    await writeEbayConfig(sql, "settings", { fulfillmentPolicyId: "f", paymentPolicyId: "p", returnPolicyId: "r" });
    const o = await makeOffer(sql);
    await stockAt(sql, o.offerId, 9, new Date());
    s = await onboardingState(sql);
    expect(s.steps.find((x) => x.id === "policies")!.done).toBe(true);
    expect(s.steps.find((x) => x.id === "stock")!.done).toBe(false); // 9 cartes sur 10
    expect(s.steps.find((x) => x.id === "locations")!.done).toBe(true);

    await createLocation(sql, { code: "BOX-A" });
    const [variant] = await sql<{ id: string }[]>`select variant_id as id from offers where id = ${o.offerId}`;
    await receiveCard(sql, { variantId: variant!.id, condition: "EX", quantity: 1, location: { code: "BOX-A" }, unitCostCents: 0, actor: ACTOR });
    await listedAt(sql, o.offerId, new Date(), { simulated: true });
    s = await onboardingState(sql);
    expect(s.steps.find((x) => x.id === "stock")!.done).toBe(true);
    expect(s.steps.find((x) => x.id === "listing")!.done).toBe(false); // une annonce simulée ne compte pas

    await listedAt(sql, o.offerId, new Date(), { channel: "cardtrader" });
    const orderId = await sellAt(sql, o.offerSku, new Date());
    s = await onboardingState(sql);
    expect(s).toMatchObject({ done: 6, percent: 86 });
    expect(s.next?.id).toBe("slip");

    await markSlipsPrinted(sql, [orderId]);
    s = await onboardingState(sql);
    expect(s).toMatchObject({ done: 7, percent: 100, complete: true, next: null });
  });

  it("gives every step a button to its action", async () => {
    const s = await onboardingState(sql);
    for (const step of s.steps) expect(step.href).toMatch(/^\//);
  });
});

describe("event journal (E1)", () => {
  it("writes events where they happen and rebuilds the missing ones from history without duplicates", async () => {
    await createLocation(sql, { code: "BOX-B" });
    const o = await makeOffer(sql);
    const [variant] = await sql<{ id: string }[]>`select variant_id as id from offers where id = ${o.offerId}`;
    await receiveCard(sql, { variantId: variant!.id, condition: "NM", quantity: 3, location: { code: "BOX-B" }, unitCostCents: 100, actor: ACTOR });
    const orderId = await sellAt(sql, o.offerSku, new Date());
    await markSlipsPrinted(sql, [orderId]);
    await markSlipsPrinted(sql, [orderId]); // réimpression : pas un nouvel événement
    const live = await sql<{ type: string }[]>`select type from account_events order by type`;
    expect(live.map((e) => e.type)).toEqual(["card_added", "sale_paid", "slip_printed"]);

    // Ce qui précède le journal (données d'avant le lancement) : une annonce et une position entrées sans événement.
    await listedAt(sql, o.offerId, new Date());
    await stockAt(sql, o.offerId, 2, new Date("2026-01-01T00:00:00Z"));
    expect(await rebuildJournal(sql)).toBe(2);
    expect(await rebuildJournal(sql)).toBe(0);
    const counts = await sql<{ type: string; n: number }[]>`select type, count(*)::int as n from account_events group by type order by type`;
    expect(counts).toEqual([
      { type: "card_added", n: 2 }, { type: "listing_published", n: 1 }, { type: "sale_paid", n: 1 }, { type: "slip_printed", n: 1 },
    ]);
  });
});
