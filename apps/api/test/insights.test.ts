import { describe, expect, it } from "vitest";
import { OWNER_ACCOUNT_ID } from "@dexlane/db";
import { useTestDb } from "@dexlane/db/testing";
import { createApp } from "../src/app";
import { unsubscribeSignature } from "../src/insights";
import type { Mail } from "../src/mailer";

const sql = useTestDb("api");
const TOKEN = "test-token-0123456789abcdef";
const mails: Mail[] = [];
const errors: unknown[] = [];
const app = createApp({
  sql, token: TOKEN, recognizer: () => { throw new Error("no scan here"); }, mailer: { send: async (m) => { mails.push(m); } }, recapEmails: true,
  baseUrl: "https://dexlane.test", onError: (e) => errors.push(e),
});

async function call(method: string, path: string, body?: unknown, auth = true) {
  const headers: Record<string, string> = auth ? { Authorization: `Bearer ${TOKEN}` } : {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: (await res.json()) as any };
}

/** Un mois de ventes d'il y a deux mois : de quoi générer le récap du mois dernier n'est pas possible, mais les stats si. */
async function seed() {
  const [card] = await sql<{ id: string }[]>`insert into catalog_cards (set_id, local_number, name, language) values ('sv01', '1', 'Pikachu', 'fr') returning id`;
  const [variant] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish) values (${card!.id}, 'holo') returning id`;
  const [offer] = await sql<{ id: string }[]>`
    insert into offers (offer_sku, variant_id, condition, is_unique, status, category, target_price_cents) values ('OF-1', ${variant!.id}, 'NM', false, 'ACTIVE', 'SINGLE', 1000) returning id`;
  const [loc] = await sql<{ id: string }[]>`insert into locations (code) values ('BOX-1') returning id`;
  await sql`insert into stock_items (unit_sku, kind, offer_id, location_id, on_hand, lifecycle, created_at) values ('SI-1', 'FUNGIBLE', ${offer!.id}, ${loc!.id}, 3, 'ACTIVE', now() - interval '200 days')`;
  await sql`insert into listings (offer_id, channel, price_cents, status, created_at) values (${offer!.id}, 'ebay', 1000, 'ACTIVE', now() - interval '120 days')`;
  return offer!.id;
}

describe("insights routes", () => {
  it("serves the statistics of a period, the dormant cards and the home summary", async () => {
    const offerId = await seed();
    const stats = await call("GET", "/api/insights/stats?period=90d");
    expect(stats.status).toBe(200);
    expect(stats.json).toMatchObject({ revenue: null, cardsSold: null, period: { id: "90d", timezone: "Europe/Paris" } });
    expect((await call("GET", "/api/insights/stats?period=week")).status).toBe(400);

    const dormant = await call("GET", "/api/insights/dormant");
    expect(dormant.json.cards).toHaveLength(1);
    const preview = await call("POST", "/api/insights/dormant/preview", { offerIds: [offerId], percent: 10 });
    expect(preview.json.lines[0]).toMatchObject({ beforeCents: 1000, afterCents: 900 });
    expect((await call("POST", "/api/insights/dormant/reprice", { offerIds: [offerId], percent: 10 })).json.error.code).toBe("CONFIRMATION_REQUIRED");

    const home = await call("GET", "/api/insights/home");
    expect(home.json).toMatchObject({
      onboarding: { total: 7, hidden: false }, dormant: { count: 1, remind: false }, progression: { level: { level: 0 }, announce: [] },
    });
    expect(errors).toEqual([]);
  });

  it("runs the daily step: journal rebuilt, progression evaluated, recap generated and announced by e-mail once", async () => {
    const offerId = await seed();
    // Une vente le mois dernier : le récap du mois dernier sera dû.
    const [order] = await sql<{ id: string }[]>`
      insert into orders (channel, external_id, payment_status, gross_cents, currency, ordered_at)
      values ('ebay', 'E-1', 'PAID', 1000, 'EUR', date_trunc('month', now()) - interval '10 days') returning id`;
    await sql`insert into order_lines (order_id, offer_id, external_line_id, qty, unit_price_cents) values (${order!.id}, ${offerId}, '1', 1, 1000)`;
    await sql`insert into auth_users (id, name, email, "emailVerified", "accountId") values ('u1', 'Sam', 'sam@example.test', true, ${OWNER_ACCOUNT_ID})`;

    mails.length = 0;
    const daily = await call("POST", "/api/insights/daily");
    expect(daily.status).toBe(200);
    expect(daily.json.recaps).toHaveLength(1);
    expect(daily.json.emailed).toBe(1);
    expect(mails[0]).toMatchObject({ to: "sam@example.test" });
    expect(mails[0]!.text).toContain("https://dexlane.test/recap/");
    expect(mails[0]!.headers?.["List-Unsubscribe"]).toContain("/email/unsubscribe?a=");

    expect((await call("POST", "/api/insights/daily")).json).toMatchObject({ recaps: [], emailed: 0 });
    const list = await call("GET", "/api/insights/recaps");
    expect(list.json.recaps).toHaveLength(1);
    const recap = await call("GET", `/api/insights/recaps/${list.json.recaps[0].period}`);
    expect(recap.json).toMatchObject({ data: { cardsSold: 1 }, showProgression: true, referral: null });
    expect((await call("GET", "/api/insights/recaps/2001-01")).status).toBe(404);
  });

  it("unsubscribes from the recap e-mail with a signed link, without a session", async () => {
    const good = unsubscribeSignature(TOKEN, OWNER_ACCOUNT_ID, "u1");
    expect((await call("POST", "/api/public/recap-email/unsubscribe", { a: OWNER_ACCOUNT_ID, u: "u1", s: "forged" }, false)).status).toBe(401);
    // Les routes publiques passent par le serveur web, qui présente le jeton du serveur.
    expect((await call("POST", "/api/public/recap-email/unsubscribe", { a: OWNER_ACCOUNT_ID, u: "u1", s: "forged" })).status).toBe(403);
    expect((await call("POST", "/api/public/recap-email/unsubscribe", { a: OWNER_ACCOUNT_ID, u: "u1", s: good })).status).toBe(200);
    const [prefs] = await sql<{ recapEmail: boolean }[]>`select recap_email from user_preferences where user_id = 'u1'`;
    expect(prefs!.recapEmail).toBe(false);
  });
});
