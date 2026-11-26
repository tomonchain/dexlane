import { beforeEach, describe, expect, it } from "vitest";
import { syncSet, type TcgdexClient } from "@dexlane/catalog";
import { OWNER_ACCOUNT_ID } from "@dexlane/db";
import { testDatabaseUrl, useTestDb } from "@dexlane/db/testing";
import type { CardReadingRaw, CardRecognizer } from "@dexlane/scan";
import { card, fakeClient } from "../../../packages/catalog/test/fixtures";
import { createApp } from "../src/app";
import type { Mail } from "../src/mailer";
import { createMemoryPhotoStore } from "../src/photos";

const sql = useTestDb("api");
const TOKEN = "test-token-0123456789abcdef";

const reading: CardReadingRaw = {
  card_detected: true, name: "Fouinar", collector_number: "136/189", set_code: "DAA", language: "fr",
  finish_hint: "reverse", first_edition_stamp: false, name_legibility: "clear", number_legibility: "clear", notes: null,
};
let recognize: CardRecognizer["recognize"];
const errors: unknown[] = [];
let tcgdex: TcgdexClient;
const app = createApp({
  sql, token: TOKEN, recognizer: () => ({ recognize: (image) => recognize(image) }), tcgdex: () => tcgdex, photos: createMemoryPhotoStore(),
  onError: (e) => errors.push(e),
});

beforeEach(async () => {
  errors.length = 0;
  recognize = async () => ({
    reading, model: "claude-opus-5-5", servedBy: "claude-opus-5-5",
    usage: { inputTokens: 1000, outputTokens: 200, costUsd: 0.008 }, latencyMs: 900,
  });
  const client = fakeClient(["swsh3-136", "base1-4"].map(card));
  tcgdex = fakeClient(["swsh3-136", "base1-4", "sv03.5-151"].map(card), {
    listSets: async () => [{ id: "swsh3", name: "Ténèbres Embrasées" }, { id: "sv03.5", name: "151", cardCount: { official: 165, total: 207 } }],
  });
  await syncSet(sql, client, "fr", "swsh3");
  await syncSet(sql, client, "fr", "base1");
});

let keySeq = 0;
interface CallOptions { body?: unknown; key?: string | null; token?: string | null; headers?: Record<string, string> }

/** Requête JSON authentifiée ; une clé d'idempotence neuve est jointe à chaque POST sauf `key: null`. */
async function call(method: string, path: string, opts: CallOptions = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token !== null) headers.Authorization = `Bearer ${opts.token ?? TOKEN}`;
  if (method === "POST" && opts.key !== null) headers["Idempotency-Key"] = opts.key ?? `test-key-${++keySeq}`;
  let body: RequestInit["body"];
  if (opts.body instanceof Uint8Array || opts.body instanceof FormData || typeof opts.body === "string") body = opts.body as RequestInit["body"];
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await app.request(path, { method, headers, body });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, headers: res.headers, json: (await res.json()) as any };
}

const scan = (opts: CallOptions = {}) =>
  call("POST", "/api/scans", { body: new Uint8Array([0xff, 0xd8, 0xff]), headers: { "Content-Type": "image/jpeg" }, key: null, ...opts });

async function fouinarReverse(): Promise<string> {
  const { json } = await scan();
  return json.suggestedVariantId as string;
}

const count = async (table: string) => (await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table}`))[0]!.n;

describe("phone notifications", () => {
  it("subscribes a device, sends a test, drops vanished devices, and sends the morning digest once per alert", async () => {
    const sent: { endpoint: string; body: string; url: string }[] = [];
    const vanished = new Set<string>();
    const pushApp = createApp({
      sql, token: TOKEN, recognizer: () => ({ recognize: (image) => recognize(image) }), photos: createMemoryPhotoStore(), tcgdex: () => tcgdex, onError: (e) => errors.push(e),
      push: async (subscription, message) => {
        if (vanished.has(subscription.endpoint)) return "gone";
        sent.push({ endpoint: subscription.endpoint, body: message.body.replace(/[\u00a0\u202f]/g, " "), url: message.url });
        return "sent";
      },
    });
    const pcall = async (method: string, path: string, body?: unknown) => {
      const res = await pushApp.request(path, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    const info = await pcall("GET", "/api/notifications");
    expect(info.json).toMatchObject({ devices: 0, preferences: { sales: true, watched: true, publications: true } });
    expect(info.json.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect((await pcall("GET", "/api/notifications")).json.publicKey).toBe(info.json.publicKey); // clés créées une seule fois

    const phone = { endpoint: "https://push.example/phone", keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) }, locale: "fr" };
    const laptop = { endpoint: "https://push.example/laptop", keys: { p256dh: "q".repeat(87), auth: "b".repeat(22) }, locale: "en" };
    expect((await pcall("POST", "/api/notifications/subscriptions", phone)).json).toEqual({ devices: 1 });
    expect((await pcall("POST", "/api/notifications/subscriptions", phone)).json).toEqual({ devices: 1 }); // même appareil
    expect((await pcall("POST", "/api/notifications/subscriptions", laptop)).json).toEqual({ devices: 2 });
    expect((await pcall("POST", "/api/notifications/subscriptions", { endpoint: "pas une adresse", keys: phone.keys })).status).toBe(400);

    expect((await pcall("POST", "/api/notifications/test")).json).toEqual({ sent: 2, removed: 0, failed: 0 });
    expect(sent.map((m) => m.body)).toEqual(["Les notifications sont activées sur cet appareil.", "Notifications are on for this device."]);

    // Rien de nouveau : pas de notification.
    sent.length = 0;
    expect((await pcall("POST", "/api/notifications/digest")).json).toMatchObject({ sent: 0 });

    // Une carte suivie passe sous le prix cible : le résumé la signale, dans la langue de chaque appareil, une seule fois.
    tcgdex = fakeClient(["sv03.5-151"].map(card));
    await call("POST", "/api/catalog/sets/sv03.5/sync", { body: {}, key: null });
    const variantId = (await call("GET", "/api/catalog/cards?name=mew")).json.candidates[0].variants[0].id as string;
    await call("POST", "/api/watchlist", { body: { variantId, targetCents: 500 }, key: null });
    vanished.add(laptop.endpoint);
    const digest = (await pcall("POST", "/api/notifications/digest")).json;
    expect(digest).toMatchObject({ sent: 1, removed: 1, digest: { targets: [{ name: "Mew-ex", cents: 298 }] } });
    expect(sent).toEqual([{ endpoint: phone.endpoint, body: "Mew-ex est sous votre prix cible (2,98 €)", url: "/buying" }]);
    expect((await pcall("GET", "/api/notifications")).json.devices).toBe(1);
    sent.length = 0;
    expect((await pcall("POST", "/api/notifications/digest")).json).toMatchObject({ sent: 0 });

    // Préférence coupée : plus d'alerte de carte suivie.
    await call("PUT", "/api/app-settings", { body: { notifications: { sales: true, watched: false, publications: true } } });
    expect((await pcall("GET", "/api/notifications")).json.preferences.watched).toBe(false);

    expect((await pcall("POST", "/api/notifications/subscriptions/remove", { endpoint: phone.endpoint })).json).toEqual({ devices: 0 });
  });
});

describe("supplies", () => {
  it("counts supplies out at each handover, by card or by postal shipment, and alerts once when one reaches its reorder point", async () => {
    const sent: { body: string; url: string }[] = [];
    const pushApp = createApp({
      sql, token: TOKEN, recognizer: () => ({ recognize: (image) => recognize(image) }), photos: createMemoryPhotoStore(), tcgdex: () => tcgdex, onError: (e) => errors.push(e),
      push: async (_subscription, message) => {
        sent.push({ body: message.body.replace(/[\u00a0\u202f]/g, " "), url: message.url });
        return "sent";
      },
    });
    const pcall = async (method: string, path: string, body?: unknown) => {
      const res = await pushApp.request(path, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: (res.status === 204 ? null : await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    await pcall("POST", "/api/notifications/subscriptions", { endpoint: "https://push.example/phone", keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) }, locale: "fr" });

    const sleeves = (await pcall("POST", "/api/supplies", { name: "Sleeves", usage: "PER_CARD", onHand: 5, reorderPoint: 2, reorderQuantity: 100 })).json;
    expect(sleeves).toMatchObject({ name: "Sleeves", perUse: 1, onHand: 5, status: "OK", daysLeft: null, modes: ["LETTER_UNTRACKED", "LETTER_TRACKED", "PARCEL_TRACKED", "HAND_DELIVERY"] });
    const envelopes = (await pcall("POST", "/api/supplies", { name: "Enveloppes", usage: "PER_SHIPMENT", modes: ["LETTER_UNTRACKED", "LETTER_TRACKED"], onHand: 10, reorderPoint: 3 })).json;
    expect((await pcall("POST", "/api/supplies", { name: "", usage: "PER_CARD" })).status).toBe(400);
    expect((await pcall("POST", "/api/supplies", { name: "Scotch", usage: "MANUAL", modes: [] })).status).toBe(400);

    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const variantId = await fouinarReverse();
    const received = (await call("POST", "/api/inventory/receive", { body: { variantId, condition: "NM", quantity: 5, locationCode: "BOX-01", unitCostCents: 20 } })).json;
    const number = String(Number((received.stockItem.unitSku as string).slice(3)));
    const sell = async (qty: number, shippingMode: string) => {
      const order = (await pcall("POST", "/api/orders", { lines: [{ offerId: received.offer.id, qty, unitPriceCents: 100 }], shippingMode })).json;
      await pcall("POST", `/api/orders/${order.id}/pick`, { allocationId: order.lines[0].allocations[0].id, unitSku: number });
      await pcall("POST", `/api/orders/${order.id}/pack`);
      return pcall("POST", `/api/orders/${order.id}/handover`, {});
    };

    // Remise en main propre de 2 cartes : 2 sleeves, pas d'enveloppe.
    expect((await sell(2, "HAND_DELIVERY")).json.stage).toBe("SHIPPED");
    expect((await pcall("GET", `/api/supplies/${sleeves.id}`)).json).toMatchObject({ onHand: 3, used30Days: 2, status: "OK", movements: [{ kind: "CONSUME", qtyDelta: -2 }, { kind: "RECEIVE", qtyDelta: 5, note: "initial" }] });
    expect((await pcall("GET", `/api/supplies/${envelopes.id}`)).json.onHand).toBe(10);
    expect(sent).toEqual([]);

    // Lettre de 1 carte : 1 sleeve, 1 enveloppe ; les sleeves atteignent leur seuil, une alerte part.
    await sell(1, "LETTER_UNTRACKED");
    expect((await pcall("GET", `/api/supplies/${envelopes.id}`)).json.onHand).toBe(9);
    const list = (await pcall("GET", "/api/supplies")).json;
    expect(list.toReorder).toBe(1);
    expect(list.supplies[0]).toMatchObject({ name: "Sleeves", onHand: 2, status: "LOW" });
    expect(sent).toEqual([{ body: "Sleeves : plus que 2. Pensez à recommander.", url: "/stock?section=supplies" }]);

    // Plus de sleeves que le stock : il reste à zéro, sans bloquer la remise, et l'alerte n'est pas répétée.
    expect((await sell(2, "HAND_DELIVERY")).json.stage).toBe("SHIPPED");
    expect((await pcall("GET", `/api/supplies/${sleeves.id}`)).json).toMatchObject({ onHand: 0, status: "OUT" });
    expect(sent).toHaveLength(1);

    // Commandées : plus « à commander » ; reçues : stock refait, alerte réarmée.
    expect((await pcall("POST", `/api/supplies/${sleeves.id}/ordered`, { ordered: true })).json.orderedAt).toEqual(expect.any(String));
    expect((await pcall("GET", "/api/supplies")).json.toReorder).toBe(0);
    expect((await pcall("POST", `/api/supplies/${sleeves.id}/receive`, { quantity: 100 })).json).toMatchObject({ onHand: 100, orderedAt: null, status: "OK" });
    expect((await pcall("POST", `/api/supplies/${sleeves.id}/count`, { onHand: 1, note: "inventaire" })).json).toMatchObject({ onHand: 1, status: "LOW" });
    expect(sent).toHaveLength(2);
    expect((await pcall("POST", `/api/supplies/${sleeves.id}/receive`, { quantity: 0 })).status).toBe(400);

    // Seuil relevé par modification ; puis retirée de la liste.
    expect((await pcall("PATCH", `/api/supplies/${envelopes.id}`, { reorderPoint: 9, supplierUrl: "https://shop.example/enveloppes" })).json).toMatchObject({ status: "LOW", supplierUrl: "https://shop.example/enveloppes" });
    expect(sent.at(-1)).toEqual({ body: "Enveloppes : plus que 9. Pensez à recommander.", url: "/stock?section=supplies" });
    expect((await pcall("DELETE", `/api/supplies/${envelopes.id}`)).status).toBe(204);
    expect((await pcall("GET", "/api/supplies")).json.supplies.map((x: { name: string }) => x.name)).toEqual(["Sleeves"]);
    expect((await pcall("POST", "/api/notifications/digest")).json.digest.suppliesToReorder).toBe(1);
  });
});

describe("supply costs in the margin", () => {
  it("counts supplies at their stock unit cost once one is priced, per card or per shipment for the modes that use them", async () => {
    await call("PUT", "/api/shipping-costs", { body: { postage: { LETTER_UNTRACKED: 100, LETTER_TRACKED: null, PARCEL_TRACKED: null }, supplies: { sleeveCents: 10, toploaderCents: 10, envelopeCents: 10 } } });
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const variantId = await fouinarReverse();
    const offerId = (await call("POST", "/api/inventory/receive", { body: { variantId, condition: "NM", quantity: 6, locationCode: "BOX-01", unitCostCents: 20 } })).json.offer.id as string;
    const sale = async (qty: number, shippingMode: string) =>
      (await call("POST", "/api/orders", { body: { lines: [{ offerId, qty, unitPriceCents: 100 }], shippingMode } })).json;

    // Sans prix dans le stock : les frais d'envoi (2 × 20 + 10).
    expect((await call("GET", "/api/shipping-costs")).json.stock).toBeNull();
    expect((await sale(2, "LETTER_UNTRACKED")).totals).toMatchObject({ suppliesCents: 50, estimated: true });

    // Un prix dans le stock : les fournitures du stock, chacune pour ses modes ; une fourniture sans prix compte 0.
    await call("POST", "/api/supplies", { body: { name: "Sleeves", usage: "PER_CARD", unitCostCents: 3 }, key: null });
    await call("POST", "/api/supplies", { body: { name: "Top-loaders", usage: "PER_CARD" }, key: null });
    await call("POST", "/api/supplies", { body: { name: "Enveloppes", usage: "PER_SHIPMENT", modes: ["LETTER_UNTRACKED", "LETTER_TRACKED"], unitCostCents: 20 }, key: null });
    await call("POST", "/api/supplies", { body: { name: "Scotch", usage: "MANUAL", unitCostCents: 500 }, key: null });
    const costs = (await call("GET", "/api/shipping-costs")).json;
    expect(costs.stock).toMatchObject({ perCardCents: 3, perShipmentCents: { LETTER_UNTRACKED: 20, HAND_DELIVERY: 0, PARCEL_TRACKED: 0 } });
    expect(costs.stock.items.map((x: { name: string }) => x.name)).toEqual(["Enveloppes", "Sleeves", "Top-loaders"]);

    const letter = await sale(2, "LETTER_UNTRACKED");
    expect(letter.totals.suppliesCents).toBe(2 * 3 + 20);
    const hand = await sale(1, "HAND_DELIVERY");
    expect(hand.totals.suppliesCents).toBe(3);

    // Figé à la remise : changer le prix ensuite ne réécrit pas la vente.
    const allocation = hand.lines[0].allocations[0];
    await call("POST", `/api/orders/${hand.id}/pick`, { body: { allocationId: allocation.id, unitSku: allocation.unitSku }, key: null });
    await call("POST", `/api/orders/${hand.id}/pack`, { key: null });
    expect((await call("POST", `/api/orders/${hand.id}/handover`, { body: {}, key: null })).json.totals).toMatchObject({ suppliesCents: 3, estimated: false });
    const sleeves = (await call("GET", "/api/supplies")).json.supplies.find((x: { name: string }) => x.name === "Sleeves");
    await call("PATCH", `/api/supplies/${sleeves.id}`, { body: { unitCostCents: 9 } });
    expect((await call("GET", `/api/orders/${hand.id}`)).json.totals.suppliesCents).toBe(3);
    expect((await call("GET", `/api/orders/${letter.id}`)).json.totals.suppliesCents).toBe(2 * 9 + 20);
  });
});

describe("delivery tracking and reviews", () => {
  it("follows shipments with the carrier, notes deliveries, and reminds once to ask for a review 24 h after delivery", async () => {
    const sent: { body: string; url: string }[] = [];
    const answers = new Map<string, { status: "IN_TRANSIT" | "DELIVERED"; event: string; eventAt: Date | null; deliveredAt: Date | null } | null>();
    const asked: string[] = [];
    const trackApp = createApp({
      sql, token: TOKEN, recognizer: () => ({ recognize: (image) => recognize(image) }), photos: createMemoryPhotoStore(), tcgdex: () => tcgdex, onError: (e) => errors.push(e),
      push: async (_s, message) => { sent.push({ body: message.body.replace(/[\u00a0\u202f]/g, " "), url: message.url }); return "sent"; },
      tracking: { LA_POSTE: async (sh) => { asked.push(sh.tracking); return answers.get(sh.tracking) ?? null; } },
    });
    const tcall = async (method: string, path: string, body?: unknown) => {
      const res = await trackApp.request(path, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    await tcall("POST", "/api/notifications/subscriptions", { endpoint: "https://push.example/phone", keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) }, locale: "fr" });
    expect((await tcall("GET", "/api/shipments/tracking")).json).toEqual({ carriers: { LA_POSTE: true, MONDIAL_RELAY: false } });

    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const variantId = await fouinarReverse();
    const received = (await call("POST", "/api/inventory/receive", { body: { variantId, condition: "NM", quantity: 5, locationCode: "BOX-01", unitCostCents: 20 } })).json;
    const sell = async (shippingMode: string, buyerName: string, handover: Record<string, string>) => {
      const order = (await tcall("POST", "/api/orders", { lines: [{ offerId: received.offer.id, qty: 1, unitPriceCents: 100 }], shippingMode, buyerName })).json;
      await tcall("POST", `/api/orders/${order.id}/pick`, { allocationId: order.lines[0].allocations[0].id, unitSku: order.lines[0].allocations[0].unitSku });
      await tcall("POST", `/api/orders/${order.id}/pack`);
      return (await tcall("POST", `/api/orders/${order.id}/handover`, handover)).json;
    };

    // Lettre suivie : le transporteur se déduit du numéro, saisi avec des espaces.
    const letter = await sell("LETTER_TRACKED", "Léa", { tracking: "6a 1234 5678 901" });
    expect(letter.delivery).toMatchObject({ carrier: "LA_POSTE", tracking: "6A12345678901", status: "HANDED_OVER", deliveredAt: null, reviewDue: false });
    // Remise en main propre : livrée sur-le-champ, avis dû 24 h plus tard.
    const hand = await sell("HAND_DELIVERY", "Hugo", {});
    expect(hand.delivery).toMatchObject({ status: "DELIVERED", reviewDue: false });
    expect(hand.delivery.deliveredAt).toEqual(expect.any(String));

    // Pas encore connu du transporteur, puis en route, puis livré il y a deux jours.
    expect((await tcall("POST", "/api/shipments/tracking/refresh")).json).toEqual({ checked: 1, delivered: 0, failed: 0 });
    expect((await tcall("POST", "/api/shipments/tracking/refresh")).json.checked).toBe(0); // vu il y a moins de 3 h
    answers.set("6A12345678901", { status: "IN_TRANSIT", event: "Votre colis est en cours d'acheminement.", eventAt: new Date(), deliveredAt: null });
    await tcall("POST", "/api/shipments/tracking/refresh?force=true");
    expect((await tcall("GET", `/api/orders/${letter.id}`)).json.shipment).toMatchObject({ status: "IN_TRANSIT", trackingEvent: "Votre colis est en cours d'acheminement." });
    const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000);
    answers.set("6A12345678901", { status: "DELIVERED", event: "Votre colis est livré.", eventAt: twoDaysAgo, deliveredAt: twoDaysAgo });
    expect((await tcall("POST", "/api/shipments/tracking/refresh?force=true")).json).toEqual({ checked: 1, delivered: 1, failed: 0 });
    expect(asked).toEqual(["6A12345678901", "6A12345678901", "6A12345678901"]);
    expect((await tcall("POST", "/api/shipments/tracking/refresh?force=true")).json.checked).toBe(0); // livré : plus suivi

    // Livrée depuis plus de 24 h : avis à demander, rappelé une seule fois ; la remise en main propre d'il y a une heure, pas encore.
    const due = (await tcall("GET", "/api/orders?review=DUE")).json;
    expect(due.items.map((o: { buyerName: string }) => o.buyerName)).toEqual(["Léa"]);
    expect(due.counts.REVIEW_DUE).toBe(1);
    expect((await tcall("POST", "/api/sales/reviews/remind")).json).toEqual({ reminded: 1, sent: 1 });
    expect(sent.at(-1)).toEqual({ body: "Léa a reçu sa commande hier : c'est le moment de demander un avis.", url: `/sales/${letter.id}` });
    expect((await tcall("POST", "/api/sales/reviews/remind")).json).toEqual({ reminded: 0, sent: 0 });

    // Demande faite : la vente sort de la liste ; annulée : elle y revient (sans nouveau rappel).
    expect((await tcall("POST", `/api/orders/${letter.id}/review`, { requested: true })).json.delivery).toMatchObject({ reviewDue: false, reviewRequestedAt: expect.any(String) });
    expect((await tcall("GET", "/api/orders?review=DUE")).json.items).toHaveLength(0);
    await tcall("POST", `/api/orders/${letter.id}/review`, { requested: false });
    expect((await tcall("GET", "/api/orders?review=DUE")).json.items).toHaveLength(1);

    // Lettre sans suivi automatique (Mondial Relay non configuré) : numéro corrigé, puis livraison notée à la main.
    const relay = await sell("PARCEL_TRACKED", "Inès", { tracking: "12345678" });
    expect(relay.delivery).toMatchObject({ carrier: "MONDIAL_RELAY" });
    expect((await tcall("PATCH", `/api/orders/${relay.id}/tracking`, { tracking: "LA123456789FR" })).json.delivery).toMatchObject({ carrier: "LA_POSTE", tracking: "LA123456789FR" });
    expect((await tcall("POST", `/api/orders/${relay.id}/delivered`)).json.delivery).toMatchObject({ status: "DELIVERED" });
    const pending = (await tcall("POST", "/api/orders", { lines: [{ offerId: received.offer.id, qty: 1, unitPriceCents: 100 }], shippingMode: "LETTER_TRACKED" })).json;
    expect((await tcall("POST", `/api/orders/${pending.id}/delivered`)).json.error.code).toBe("NOT_SHIPPED");
  });
});

describe("full catalog import", () => {
  it("imports the missing sets newest first, batch by batch, and sets aside the ones without cards for a week", async () => {
    tcgdex = fakeClient(["swsh3-136", "base1-4", "sv03.5-151"].map(card), {
      listSets: async () => [
        { id: "base1", name: "Set de Base" }, { id: "swsh3", name: "Ténèbres Embrasées" },
        { id: "sv03.5", name: "151" }, { id: "vide1", name: "Série vide" },
      ] as never,
    });
    const before = (await call("GET", "/api/catalog/import?language=fr")).json;
    // Deux séries déjà importées à la main (jeu de départ des tests).
    expect(before).toMatchObject({ language: "fr", total: 2, imported: 2, cards: 2, listComplete: false });

    const run = (await call("POST", "/api/catalog/import/next", { body: { language: "fr", budgetSeconds: 30 }, key: null })).json;
    expect(run.imported.map((x: { setId: string }) => x.setId)).toEqual(["vide1", "sv03.5"]);
    expect(run.imported[0]).toMatchObject({ setId: "vide1", cards: 0 });
    expect(run.status).toMatchObject({ total: 4, imported: 3, remaining: 0, skipped: 1, cards: 3, listComplete: true });

    // Rien de plus à importer : la série vide attend une semaine avant d'être retentée.
    expect((await call("POST", "/api/catalog/import/next", { body: { language: "fr", budgetSeconds: 30 }, key: null })).json.imported).toEqual([]);
    expect((await call("POST", "/api/catalog/import/next", { body: { language: "fr", budgetSeconds: 1 }, key: null })).status).toBe(400);
  });
});

describe("set codes", () => {
  it("shows the usual set code in the stock, finds cards by it however it is typed, and lets it be corrected per set", async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const variantId = await fouinarReverse();
    await call("POST", "/api/inventory/receive", { body: { variantId, condition: "NM", quantity: 1, locationCode: "BOX-01", unitCostCents: 20 } });
    const search = async (q: string) => (await call("GET", `/api/stock?q=${encodeURIComponent(q)}`)).json.items.map((r: { setCode: string }) => r.setCode);

    // swsh3 en français : Épée et Bouclier 3 → « EB03 ».
    expect(await search("")).toEqual(["EB03"]);
    expect(await search("eb 3")).toEqual(["EB03"]);
    expect(await search("EB03")).toEqual(["EB03"]);
    expect(await search("ev03")).toEqual([]);
    expect((await call("GET", "/api/stock/facets")).json.sets[0].name).toBe("EB03 · Ténèbres Embrasées");
    expect((await call("GET", "/api/catalog/sets/swsh3?language=fr")).json.set).toMatchObject({ code: "EB03", codeOverride: null });

    // Corrigé à la main pour la série, puis rendu au code déduit.
    expect((await call("PUT", "/api/catalog/sets/swsh3/code", { body: { language: "fr", code: "teb" } })).json).toEqual({ code: "TEB", codeOverride: "TEB" });
    expect(await search("teb")).toEqual(["TEB"]);
    expect((await call("PUT", "/api/catalog/sets/swsh3/code", { body: { language: "fr", code: "pas ça !" } })).status).toBe(422);
    expect((await call("PUT", "/api/catalog/sets/inconnue/code", { body: { language: "fr", code: "X1" } })).status).toBe(404);
    expect((await call("PUT", "/api/catalog/sets/swsh3/code", { body: { language: "fr", code: null } })).json).toEqual({ code: "EB03", codeOverride: null });
  });
});

describe("stock journal", () => {
  it("lists card and supply movements together, newest first, with filters, pages and a summary", async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    await call("POST", "/api/locations", { body: { code: "ETAGERE-1" } });
    const variantId = await fouinarReverse();
    const received = (await call("POST", "/api/inventory/receive", { body: { variantId, condition: "NM", quantity: 3, locationCode: "BOX-01", unitCostCents: 20 } })).json;
    await call("POST", `/api/inventory/${received.stockItem.id}/adjust`, { body: { countedOnHand: 2, reason: "carte abîmée" } });
    await call("POST", `/api/inventory/${received.stockItem.id}/move`, { body: { locationCode: "ETAGERE-1" } });

    const sleeves = (await call("POST", "/api/supplies", { body: { name: "Sleeves", usage: "PER_CARD", onHand: 10, unitCostCents: 2, reference: "SLV-100", locationCode: "etagere-1" }, key: null })).json;
    expect(sleeves).toMatchObject({ reference: "SLV-100", unitCostCents: 2, locationCode: "ETAGERE-1", valueCents: 20 });
    expect((await call("POST", "/api/supplies", { body: { name: "Scotch", usage: "MANUAL", locationCode: "NULLE-PART" }, key: null })).json.error.code).toBe("LOCATION_NOT_FOUND");
    await call("POST", `/api/supplies/${sleeves.id}/receive`, { body: { quantity: 5, note: "commande 42" }, key: null });
    expect((await call("PATCH", `/api/supplies/${sleeves.id}`, { body: { locationCode: null, unitCostCents: 3 } })).json).toMatchObject({ locationCode: null, valueCents: 45 });
    expect((await call("GET", "/api/supplies")).json.totals).toEqual({ items: 1, units: 15, valueCents: 45 });

    const all = (await call("GET", "/api/stock-movements")).json;
    expect(all.movements.map((m: { category: string; kind: string; qtyDelta: number }) => [m.category, m.kind, m.qtyDelta])).toEqual([
      ["SUPPLY", "IN", 5], ["SUPPLY", "IN", 10], ["CARD", "MOVE", 0], ["CARD", "ADJUST", -1], ["CARD", "IN", 3],
    ]);
    expect(all.movements[0]).toMatchObject({ name: "Sleeves", detail: "SLV-100", reason: "commande 42", supplyId: sleeves.id, actor: "owner" });
    expect(all.movements[2]).toMatchObject({ name: "Fouinar", fromLocation: "BOX-01", toLocation: "ETAGERE-1", unitSku: received.stockItem.unitSku, offerId: received.offer.id });
    expect(all.movements[3]).toMatchObject({ type: "ADJUST", reason: "carte abîmée" });
    expect(all.movements[4].detail).toMatch(/· 136 · NM$/);
    expect(all.summary).toEqual({ days: 30, in: 18, out: 0, adjusted: -1, moves: 1 });
    expect(all.next).toBeNull();

    expect((await call("GET", "/api/stock-movements?category=CARD&kind=IN")).json.movements).toHaveLength(1);
    expect((await call("GET", `/api/stock-movements?offerId=${received.offer.id}`)).json.summary).toMatchObject({ in: 3, adjusted: -1, moves: 1 });
    const first = (await call("GET", "/api/stock-movements?limit=2")).json;
    const second = (await call("GET", `/api/stock-movements?limit=2&before=${first.next}`)).json;
    const third = (await call("GET", `/api/stock-movements?limit=2&before=${second.next}`)).json;
    expect([...first.movements, ...second.movements, ...third.movements].map((m: { id: string }) => m.id)).toEqual(all.movements.map((m: { id: string }) => m.id));
    expect(third.next).toBeNull();
    expect((await call("GET", "/api/stock-movements?before=nimporte")).status).toBe(422);
  });
});

describe("agents (MCP server)", () => {
  it("lets an agent token use the MCP tools only, on behalf of the agent, until it is revoked", async () => {
    const created = await call("POST", "/api/agent-tokens", { body: { name: "Airth" }, key: null });
    expect(created.status).toBe(201);
    const token = created.json.token as string;
    expect(token).toMatch(/^dxl_[A-Za-z0-9_-]{43}$/);
    expect((await call("GET", "/api/agent-tokens")).json.tokens).toEqual([expect.objectContaining({ name: "Airth", prefix: token.slice(0, 10), lastUsedAt: null })]);
    expect(JSON.stringify((await call("GET", "/api/agent-tokens")).json)).not.toContain(token);

    let id = 0;
    const mcp = async (method: string, params: unknown = {}, bearer = token) => {
      const res = await app.request("/api/mcp", {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      });
      return { status: res.status, json: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const tool = async (name: string, args: unknown = {}) => {
      const { json } = await mcp("tools/call", { name, arguments: args });
      return { isError: json.result.isError === true, data: JSON.parse(json.result.content[0].text) };
    };

    const init = await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    expect(init.json.result).toMatchObject({ serverInfo: { name: "dexlane" }, capabilities: { tools: {} } });
    expect(init.json.result.instructions).toContain("euro cents");
    const tools = (await mcp("tools/list")).json.result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["get_business_overview", "search_stock", "set_offer_price", "record_direct_sale", "list_supplies", "mark_supply_ordered"]));
    expect(tools.find((t) => t.name === "search_stock")!.annotations.readOnlyHint).toBe(true);

    // Un peu d'activité : une carte en stock, une fourniture sous son seuil.
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const variantId = await fouinarReverse();
    const offerId = (await call("POST", "/api/inventory/receive", { body: { variantId, condition: "NM", quantity: 3, locationCode: "BOX-01", unitCostCents: 20 } })).json.offer.id as string;
    const sleeves = (await call("POST", "/api/supplies", { body: { name: "Sleeves", usage: "PER_CARD", onHand: 3, reorderPoint: 10 }, key: null })).json;

    const overview = await tool("get_business_overview");
    expect(overview.isError).toBe(false);
    expect(overview.data).toMatchObject({ supplies: { toReorder: 1, items: [{ name: "Sleeves", status: "LOW", ordered: false }] }, last30Days: { cardsSold: 0 } });
    expect((await tool("search_stock", { query: "fouinar" })).data.items[0]).toMatchObject({ offerId });

    // Actions, journalisées au nom de l'agent.
    expect((await tool("set_offer_price", { offerId, targetPriceCents: 250 })).isError).toBe(false);
    const sale = await tool("record_direct_sale", { lines: [{ offerId, qty: 1, unitPriceCents: 250 }], shippingMode: "HAND_DELIVERY", buyerName: "Léa", idempotencyKey: "agent-sale-0001" });
    expect(sale.data).toMatchObject({ stage: "TO_PREPARE", buyerName: "Léa" });
    expect((await tool("record_direct_sale", { lines: [{ offerId, qty: 1, unitPriceCents: 250 }], shippingMode: "HAND_DELIVERY", buyerName: "Léa", idempotencyKey: "agent-sale-0001" })).data.id).toBe(sale.data.id);
    expect((await tool("mark_supply_ordered", { supplyId: sleeves.id, ordered: true })).data.orderedAt).toEqual(expect.any(String));
    const [audit] = await sql<{ actor: string }[]>`select actor from audit_events where action = 'agent_token_created' or actor like 'agent:%' order by id desc limit 1`;
    expect(audit!.actor).toBe("agent:Airth");

    // Refus métier : résultat en erreur, lisible par l'agent.
    const refused = await tool("record_direct_sale", { lines: [{ offerId, qty: 50, unitPriceCents: 250 }], shippingMode: "HAND_DELIVERY" });
    expect(refused).toMatchObject({ isError: true, data: { error: { code: "INSUFFICIENT_STOCK" } } });
    // Arguments invalides : refusés par le serveur MCP.
    expect((await mcp("tools/call", { name: "set_offer_price", arguments: { offerId: "x", targetPriceCents: -1 } })).json.result.isError).toBe(true);

    // Le jeton d'agent n'ouvre rien d'autre ; une méthode autre que POST est refusée ; un jeton révoqué non plus.
    expect((await app.request("/api/stock", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await app.request("/api/mcp", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(405);
    expect((await call("GET", "/api/agent-tokens")).json.tokens[0].lastUsedAt).toEqual(expect.any(String));
    expect((await app.request(`/api/agent-tokens/${created.json.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(204);
    expect((await mcp("tools/list")).status).toBe(401);
    expect((await mcp("tools/list", {}, "dxl_" + "x".repeat(43))).status).toBe(401);
  });
});

describe("database outages", () => {
  /** Base factice : les `failures` premiers appels échouent comme une connexion qui n'aboutit pas. */
  function flakySql(failures: number) {
    let calls = 0;
    const fake = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls++;
      if (calls <= failures) return Promise.reject(Object.assign(new Error("write CONNECT_TIMEOUT"), { code: "CONNECT_TIMEOUT" }));
      return sql(strings, ...(values as never[]));
    }) as unknown as typeof sql;
    return { fake, calls: () => calls };
  }

  it("retries a read when the database does not answer, then reports it as unavailable", async () => {
    const once = flakySql(1);
    const recovering = createApp({ sql: once.fake, token: TOKEN, recognizer: () => ({ recognize: (image) => recognize(image) }), photos: createMemoryPhotoStore(), onError: () => undefined });
    const ok = await recovering.request("/api/health");
    expect([ok.status, once.calls()]).toEqual([200, 2]);

    const down = flakySql(Infinity);
    const outage = createApp({ sql: down.fake, token: TOKEN, recognizer: () => ({ recognize: (image) => recognize(image) }), photos: createMemoryPhotoStore(), onError: () => undefined });
    const failed = await outage.request("/api/health");
    expect(failed.status).toBe(503);
    expect(((await failed.json()) as { error: { code: string } }).error.code).toBe("DATABASE_UNAVAILABLE");
    expect(down.calls()).toBe(3); // la lecture et deux nouvelles tentatives
  });
});

describe("authentication", () => {
  it("leaves only the health check open", async () => {
    expect((await call("GET", "/api/health", { token: null })).json).toEqual({ status: "ok" });
    for (const token of [null, "wrong", `${TOKEN}x`]) {
      const res = await call("GET", "/api/inventory", { token });
      expect(res.status).toBe(401);
      expect(res.json.error.code).toBe("UNAUTHORIZED");
    }
    expect((await call("GET", "/api/inventory")).status).toBe(200);
    expect((await call("GET", "/api/nope")).status).toBe(404);
  });
});

describe("Parcours A — scan, confirmation, entrée en stock", () => {
  it("goes from a photo to a located, sellable position", async () => {
    const scanned = await scan();
    expect(scanned.status).toBe(200);
    expect(scanned.json).toMatchObject({
      requiresReview: false, language: "fr", reading: { name: "Fouinar" },
      model: { servedBy: "claude-opus-5-5" }, usage: { costUsd: 0.008 },
    });
    expect(scanned.json.candidates[0]).toMatchObject({ setId: "swsh3", localNumber: "136", name: "Fouinar" });
    const variantId = scanned.json.suggestedVariantId;
    expect(scanned.json.candidates[0].variants.find((v: { id: string }) => v.id === variantId).finish).toBe("reverse");

    expect((await call("POST", "/api/locations", { body: { code: "box-03/row-12/slot-04" } })).status).toBe(201);
    const lot = await call("POST", "/api/acquisition-lots", {
      body: { sourceType: "collection personnelle", purchaseDate: "2026-11-01", totalCostCents: 4000 },
    });
    expect(lot.json).toMatchObject({ purchaseDate: "2026-11-01", totalCostCents: 4000 });

    const received = await call("POST", "/api/inventory/receive", {
      body: { variantId, condition: "NM", quantity: 2, locationCode: "BOX-03/ROW-12/SLOT-04", unitCostCents: 150, acquisitionLotId: lot.json.id },
    });
    expect(received.status).toBe(201);
    expect(received.json).toMatchObject({
      offer: { offerSku: "OF-SWSH3-136-FR-R-NM", created: true },
      stockItem: { kind: "FUNGIBLE", onHand: 2, lifecycle: "ACTIVE" },
      locationCode: "BOX-03/ROW-12/SLOT-04",
    });
    const { id, unitSku } = received.json.stockItem;

    const found = await call("GET", `/api/inventory?q=fouinar&location=BOX-03`);
    expect(found.json).toMatchObject({ total: 1, items: [{ unitSku, availableToSell: 2, card: { name: "Fouinar" } }] });

    await call("POST", "/api/locations", { body: { code: "BOX-04" } });
    const moved = await call("POST", `/api/inventory/${id}/move`, { body: { locationCode: "BOX-04" }, key: null });
    expect(moved.json).toMatchObject({ locationCode: "BOX-04", movements: [{ movementType: "MOVE", actor: "owner" }, { movementType: "RECEIVE" }] });

    const adjusted = await call("POST", `/api/inventory/${id}/adjust`, { body: { countedOnHand: 1, reason: "une carte abîmée retirée" } });
    expect(adjusted.json).toMatchObject({ onHand: 1, movements: [{ movementType: "ADJUST", qtyDelta: -1 }, {}, {}] });

    expect((await call("GET", "/api/inventory/summary")).json).toEqual({
      positions: 1, cards: 1, bulkCards: 0, sellable: 1, reserved: 0, drafts: 0, costCents: 150,
      marketValueCents: expect.any(Number), unpricedCards: expect.any(Number),
    });

    const detail = await call("GET", `/api/inventory/${unitSku}`);
    expect(detail.json).toMatchObject({ id, onHand: 1, locationCode: "BOX-04" });
    expect(detail.json.movements).toHaveLength(3);
  });

  it("validates a draft position once, idempotently", async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const received = await call("POST", "/api/inventory/receive", {
      body: { variantId: await fouinarReverse(), condition: "EX", quantity: 1, locationCode: "BOX-01", unitCostCents: 0, draft: true },
    });
    const id = received.json.stockItem.id;
    expect(received.json.stockItem.lifecycle).toBe("DRAFT");
    for (let i = 0; i < 2; i++) {
      const res = await call("POST", `/api/inventory/${id}/activate`, { key: null });
      expect([res.status, res.json.lifecycle]).toEqual([200, "ACTIVE"]);
    }
    expect(await count("audit_events")).toBe(1);
  });

  it("finds catalog cards manually when the scan is not usable", async () => {
    const byName = await call("GET", "/api/catalog/cards?name=dracaufeu");
    expect(byName.json.candidates[0]).toMatchObject({ setId: "base1", localNumber: "4" });
    expect(byName.json.candidates[0].variants.length).toBeGreaterThan(0);
    expect((await call("GET", "/api/catalog/cards?number=136&set=SWSH3")).json.candidates[0]).toMatchObject({ name: "Fouinar" });
    expect((await call("GET", "/api/catalog/cards?language=fr")).status).toBe(400);
  });
});

describe("catalog synchronisation", () => {
  it("lists sets, refreshes the list and imports a set on demand", async () => {
    const before = await call("GET", "/api/catalog/sets");
    expect(before.json.sets.map((x: { id: string }) => x.id).sort()).toEqual(["base1", "swsh3"]);
    expect(before.json.sets.find((x: { id: string }) => x.id === "swsh3")).toMatchObject({ name: "Ténèbres Embrasées", cardsSynced: 1 });

    expect((await call("POST", "/api/catalog/sets/refresh", { body: {}, key: null })).json).toEqual({ count: 2 });
    const listed = await call("GET", "/api/catalog/sets?language=fr");
    expect(listed.json.sets.find((x: { id: string }) => x.id === "sv03.5")).toMatchObject({ name: "151", cardsSynced: 0, cardCountTotal: 207 });
    expect((await call("GET", "/api/catalog/cards?name=mew")).json.candidates).toEqual([]);

    const synced = await call("POST", "/api/catalog/sets/SV03.5/sync", { body: { language: "fr" }, key: null });
    expect([synced.status, synced.json]).toMatchObject([200, { setId: "sv03.5", cards: 1, errorCount: 0 }]);
    expect((await call("GET", "/api/catalog/cards?name=mew")).json.candidates[0]).toMatchObject({ name: "Mew-ex", setId: "sv03.5" });

    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const mew = (await call("GET", "/api/catalog/cards?name=mew")).json.candidates[0];
    await call("POST", "/api/inventory/receive", {
      body: { variantId: mew.variants[0].id, condition: "NM", quantity: 3, locationCode: "BOX-01", unitCostCents: 0 },
    });
    const detail = await call("GET", "/api/catalog/sets/sv03.5?language=fr");
    expect(detail.json.set).toMatchObject({ id: "sv03.5", name: "151", cardsSynced: 1 });
    expect(detail.json.cards).toHaveLength(1);
    expect(detail.json.cards[0]).toMatchObject({ name: "Mew-ex", localNumber: "151", owned: 3 });
    expect(detail.json.cards[0].variants[0]).toMatchObject({ id: mew.variants[0].id, finish: "holo" });
    expect(detail.json.cards[0].variants[0].trendCents).toBeGreaterThan(0);
    // Mew-ex se vend 7,88 € sur la semaine et 7,32 € sur le mois : estimation d'après les ventes à 7,60 €, fiable.
    expect(detail.json.cards[0].variants[0].estimate).toMatchObject({
      cents: 760, variantAmbiguous: false,
      sales: { cents: 760, confidence: "HIGH", sales: [{ quoteType: "SOLD_AVG_7D", amountCents: 788 }, { quoteType: "SOLD_AVG_30D", amountCents: 732 }, { quoteType: "SOLD_AVG_1D", amountCents: 720 }] },
    });
    expect((await call("GET", "/api/catalog/sets/inconnue")).status).toBe(404);

    // Rejouer n'ajoute rien.
    await call("POST", "/api/catalog/sets/sv03.5/sync", { body: {}, key: null });
    const after = await call("GET", "/api/catalog/sets");
    expect(after.json.sets.find((x: { id: string }) => x.id === "sv03.5").cardsSynced).toBe(1);
    expect(after.json.sets[0].cardsSynced).toBeGreaterThan(0); // séries synchronisées en tête
  });

  it("reports an unknown set and an unreachable source distinctly", async () => {
    tcgdex = fakeClient([], {
      getSet: async (_lang, id) => {
        throw new Error(id === "nope" ? "TCGdex /fr/sets/nope → HTTP 404" : "fetch failed");
      },
      listSets: async () => {
        throw new Error("fetch failed");
      },
    });
    const unknown = await call("POST", "/api/catalog/sets/nope/sync", { body: {}, key: null });
    expect([unknown.status, unknown.json.error.code]).toEqual([404, "CATALOG_SET_NOT_FOUND"]);
    const down = await call("POST", "/api/catalog/sets/swsh3/sync", { body: {}, key: null });
    expect([down.status, down.json.error.code]).toEqual([502, "CATALOG_SOURCE_UNAVAILABLE"]);
    expect((await call("POST", "/api/catalog/sets/refresh", { body: {}, key: null })).status).toBe(502);
    expect((await call("POST", "/api/catalog/sets/bad id!/sync", { body: {}, key: null })).status).toBe(400);
  });
});

describe("pricing", () => {
  it("prices a card at intake from the imported quote, lists it, and records a manual decision", async () => {
    tcgdex = fakeClient(["sv03.5-151"].map(card));
    await call("POST", "/api/catalog/sets/sv03.5/sync", { body: {}, key: null });
    const mew = (await call("GET", "/api/catalog/cards?name=mew")).json.candidates[0];
    const variantId = mew.variants[0].id as string;

    // Une cotation ancienne donne une estimation, mais qui part en revue.
    await sql`update price_snapshots set observed_at = now() - interval '40 days'`;
    const preview = await call("GET", `/api/pricing/variants/${variantId}?condition=EX`);
    expect(preview.json.reasons).toContain("STALE_REFERENCE");
    expect(preview.json.suggestedCents).toBeGreaterThan(0);
    await sql`update price_snapshots set observed_at = now() - interval '1 day'`;
    const fresh = (await call("GET", `/api/pricing/variants/${variantId}?condition=NM`)).json;
    // Le prix part des ventes réussies : 7,88 € sur la semaine, 7,32 € sur le mois.
    expect(fresh).toMatchObject({
      reasons: [], category: "SINGLE", suggestedCents: 760,
      reference: { quoteType: "SOLD_ESTIMATE", amountCents: 760 }, sales: { cents: 760, confidence: "HIGH" },
    });
    // Il se place dans la fourchette des ventes, entre ce qui part tout de suite et le plus haut soutenu.
    expect(fresh.market.liquidCents).toBeLessThanOrEqual(fresh.suggestedCents);
    expect(fresh.suggestedCents).toBeLessThanOrEqual(fresh.market.richCents);

    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const received = await call("POST", "/api/inventory/receive", {
      body: { variantId, condition: "NM", quantity: 2, locationCode: "BOX-01", unitCostCents: 200 },
    });
    // Rien ne fait douter : le prix est posé d'office à l'entrée en stock.
    expect(received.json.pricing).toMatchObject({ category: "SINGLE", targetPriceCents: fresh.suggestedCents, priceSource: "AUTO", reasons: [], onHand: 2 });

    const queue = await call("GET", "/api/pricing/offers?status=ALL");
    expect(queue.json).toMatchObject({ reviewCount: 0, allCount: 1, items: [{ offerId: received.json.offer.id, card: { name: "Mew-ex" } }] });
    expect((await call("GET", "/api/inventory/summary")).json).toMatchObject({ marketValueCents: 2 * fresh.suggestedCents, unpricedCards: 0 });

    const decided = await call("POST", `/api/pricing/offers/${received.json.offer.id}/price`, { body: { targetPriceCents: 900, category: "SINGLE" }, key: null });
    expect(decided.json).toMatchObject({ targetPriceCents: 900, floorPriceCents: 720, category: "SINGLE", priceSource: "MANUAL", reasons: [] });
    expect((await call("GET", "/api/pricing/offers?status=REVIEW")).json.reviewCount).toBe(0);
    expect((await call("GET", `/api/inventory/${received.json.stockItem.id}`)).json.offer).toMatchObject({ targetPriceCents: 900, floorPriceCents: 720, priceSource: "MANUAL" });
    expect((await call("GET", "/api/inventory/summary")).json.marketValueCents).toBe(1800);

    const bad = await call("POST", `/api/pricing/offers/${received.json.offer.id}/price`, { body: { targetPriceCents: 500, floorPriceCents: 600, category: "LOT" }, key: null });
    expect([bad.status, bad.json.error.code]).toEqual([422, "FLOOR_ABOVE_TARGET"]);
  });

  it("reads and replaces the rules, repricing existing offers", async () => {
    const settings = (await call("GET", "/api/pricing/settings")).json;
    expect(settings).toMatchObject({ strategy: "BALANCED", singleFromCents: 1500, conditionPercent: { EX: 80 }, roundFromCents: 1000, roundStepCents: 100 });
    const saved = await call("PUT", "/api/pricing/settings", { body: { ...settings, maxAgeDays: 30, strategy: "FAST" } });
    expect(saved.json).toMatchObject({ settings: { maxAgeDays: 30, strategy: "FAST" }, repriced: 0 });
    expect((await call("PUT", "/api/pricing/settings", { body: { ...settings, strategy: "YOLO" } })).status).toBe(400);
    const invalid = await call("PUT", "/api/pricing/settings", { body: { ...settings, lotBelowCents: 1 } });
    expect([invalid.status, invalid.json.error.code]).toEqual([422, "INVALID_PRICING_SETTINGS"]);
    expect((await call("PUT", "/api/pricing/settings", { body: { basis: "LISTED_TREND" } })).status).toBe(400);
    expect((await call("POST", "/api/pricing/recompute", { key: null })).json).toEqual({ repriced: 0 });
  });
});

describe("photos", () => {
  it("keeps the scan photo and attaches front and back to the position created from it", async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const scanned = await scan();
    expect(scanned.json.photo).toMatchObject({ kind: "SCAN_FRONT", url: expect.stringMatching(/^data:image\/jpeg;base64,/) });
    const back = await call("POST", "/api/photos?kind=SCAN_BACK", { body: new Uint8Array([0xff, 0xd8, 0xff, 0x00]), headers: { "Content-Type": "image/jpeg" }, key: null });
    expect([back.status, back.json.kind]).toEqual([201, "SCAN_BACK"]);

    const body = { variantId: scanned.json.suggestedVariantId, condition: "NM", quantity: 1, locationCode: "BOX-01", unitCostCents: 0 };
    const received = await call("POST", "/api/inventory/receive", { body: { ...body, photoIds: [scanned.json.photo.id, back.json.id] } });
    const detail = await call("GET", `/api/inventory/${received.json.stockItem.id}`);
    expect(detail.json.photos.map((p: { kind: string }) => p.kind)).toEqual(["SCAN_BACK", "SCAN_FRONT"]);
    expect(detail.json.photos[1]).toMatchObject({ id: scanned.json.photo.id, offerId: received.json.offer.id });

    // Une photo déjà rattachée ne suit pas une autre entrée en stock.
    const second = await call("POST", "/api/inventory/receive", { body: { ...body, photoIds: [scanned.json.photo.id] } });
    expect((await call("GET", `/api/inventory/${second.json.stockItem.id}`)).json.photos).toEqual([]);
    expect((await call("POST", "/api/photos", { body: new Uint8Array(0), headers: { "Content-Type": "image/jpeg" }, key: null })).status).toBe(400);
    expect((await call("POST", "/api/photos", { body: new Uint8Array(4), headers: { "Content-Type": "application/pdf" }, key: null })).status).toBe(415);
  });
});

describe("listings", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
  const upload = (query: string, body = jpeg) => call("POST", `/api/photos?${query}`, { body, headers: { "Content-Type": "image/jpeg" }, key: null });

  it("renders the listing of a sellable offer and composes one listing photo per scan", async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const scanned = await scan();
    const received = await call("POST", "/api/inventory/receive", {
      body: { variantId: scanned.json.suggestedVariantId, condition: "NM", quantity: 1, locationCode: "BOX-01", unitCostCents: 0, photoIds: [scanned.json.photo.id] },
    });

    const settings = await call("GET", "/api/listings/settings");
    expect(settings.json.titleTemplate).toContain("{nom}");
    const saved = await call("PUT", "/api/listings/settings", { body: { ...settings.json, titleTemplate: "{nom} {numero} {etat} | {variante}" } });
    expect(saved.status).toBe(200);
    expect((await call("PUT", "/api/listings/settings", { body: { ...settings.json, titleTemplate: "" } })).status).toBe(422);
    expect((await call("PUT", "/api/listings/settings", { body: { ...settings.json, extra: true } })).status).toBe(400);

    // Le visuel d'annonce hérite de l'offre du scan ; le recomposer remplace le précédent.
    expect((await upload("kind=LISTING")).status).toBe(400);
    expect((await upload(`kind=LISTING&source=${crypto.randomUUID()}`)).status).toBe(404);
    const first = await upload(`kind=LISTING&source=${scanned.json.photo.id}`);
    expect(first.json).toMatchObject({ kind: "LISTING", offerId: received.json.offer.id, sourcePhotoId: scanned.json.photo.id });
    const second = await upload(`kind=LISTING&source=${scanned.json.photo.id}`, new Uint8Array([0xff, 0xd8, 0xff, 0x02]));
    const content = await app.request(`/api/photos/${second.json.id}/content`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect([content.status, content.headers.get("content-type")]).toEqual([200, "image/jpeg"]);
    expect([...new Uint8Array(await content.arrayBuffer())]).toEqual([0xff, 0xd8, 0xff, 0x02]);

    const offers = await call("GET", "/api/listings/offers");
    expect(offers.json.total).toBe(1);
    expect(offers.json.items[0].text.title).toBe("Fouinar 136/189 NM | Reverse");
    expect(offers.json.items[0].photos.map((p: { kind: string; id: string }) => [p.kind, p.id])).toEqual([["LISTING", second.json.id], ["SCAN_FRONT", scanned.json.photo.id]]);
  });

  it("stores a background image and accepts it in the photo style", async () => {
    const background = await upload("kind=BACKGROUND");
    expect([background.status, background.json.kind]).toEqual([201, "BACKGROUND"]);
    const settings = (await call("GET", "/api/listings/settings")).json;
    const saved = await call("PUT", "/api/listings/settings", {
      body: { ...settings, photo: { ...settings.photo, background: { type: "image", photoId: background.json.id } } },
    });
    expect(saved.json.photo.background).toEqual({ type: "image", photoId: background.json.id });
  });
});

describe("scan batches", () => {
  const jpeg = (byte: number) => new Uint8Array([0xff, 0xd8, 0xff, byte]);
  const upload = (path: string, byte = 1) => call("POST", path, { body: jpeg(byte), headers: { "Content-Type": "image/jpeg" }, key: null });

  it("stores each scanned card at its rank, lets the review fix it, then receives the batch in order", async () => {
    await call("POST", "/api/locations", { body: { code: "BOITE-07" } });
    expect((await call("POST", "/api/scan-batches", { body: { locationCode: "NOPE" } })).status).toBe(404);
    const batch = (await call("POST", "/api/scan-batches", { body: { locationCode: "BOITE-07", unitCostCents: 10 } })).json;

    const first = await upload(`/api/scan-batches/${batch.id}/items?position=1&fileName=scan_1.jpg`);
    expect([first.status, first.json.sure, first.json.card.name, first.json.frontPhoto.url.slice(0, 15)]).toEqual([201, true, "Fouinar", "data:image/jpeg"]);
    // Le même rang renvoyé (page rechargée) : pas de nouvelle lecture, pas de doublon.
    const replay = await upload(`/api/scan-batches/${batch.id}/items?position=1&fileName=scan_1.jpg`, 9);
    expect([replay.status, replay.json.id]).toEqual([200, first.json.id]);
    expect((await upload(`/api/scan-items/${first.json.id}/back`, 2)).json.backPhoto).not.toBeNull();

    // Lecture en panne : la carte est gardée à son rang, à identifier à la main.
    recognize = async () => { throw new Error("vision down"); };
    const second = await upload(`/api/scan-batches/${batch.id}/items?position=2&fileName=scan_2.jpg`);
    expect([second.status, second.json.card, second.json.scanError]).toEqual([201, null, "SCAN_UNAVAILABLE"]);

    expect((await call("POST", `/api/scan-batches/${batch.id}/receive`)).json.error).toMatchObject({ code: "BATCH_NOT_READY", details: { positions: [1, 2] } });
    await call("PATCH", `/api/scan-batches/${batch.id}`, { body: { defaultCondition: "NM" } });
    const fixed = await call("PATCH", `/api/scan-items/${second.json.id}`, { body: { catalogCardId: first.json.card.id, variantId: first.json.card.variants[0].id, condition: "GD" } });
    expect(fixed.json).toMatchObject({ ready: true, condition: "GD" });

    const received = await call("POST", `/api/scan-batches/${batch.id}/receive`);
    expect(received.json).toMatchObject({ received: 2, batch: { counts: { items: 2, received: 2, toReview: 0 } } });
    const detail = await call("GET", `/api/scan-batches/${batch.id}`);
    expect(detail.json.items.map((i: { unitSku: string }) => i.unitSku)).toEqual([received.json.firstSku, received.json.lastSku]);
    const position = await call("GET", `/api/inventory/${received.json.firstSku}`);
    expect(position.json).toMatchObject({ locationCode: "BOITE-07", unitCostCents: 10 });
    expect(position.json.photos).toHaveLength(2);
    expect(position.json.offer.suggestedPriceCents).not.toBeNull(); // tarifée à l'entrée
    expect((await call("GET", "/api/scan-batches")).json.batches[0].receivedAt).not.toBeNull();
  });
});

describe("stock bulk actions", () => {
  it("validates drafts, moves every position and accepts suggested prices for a selection, leaving the rest alone", async () => {
    for (const code of ["BOX-01", "BOX-02"]) await call("POST", "/api/locations", { body: { code } });
    const fouinar = await fouinarReverse();
    const dracaufeu = (await call("GET", "/api/catalog/cards?name=dracaufeu")).json.candidates[0].variants[0].id as string;
    const draft = await call("POST", "/api/inventory/receive", { body: { variantId: fouinar, condition: "EX", quantity: 1, locationCode: "BOX-01", unitCostCents: 0, draft: true } });
    const active = await call("POST", "/api/inventory/receive", { body: { variantId: dracaufeu, condition: "NM", quantity: 2, locationCode: "BOX-01", unitCostCents: 0 } });
    const offerIds = [draft.json.offer.id, active.json.offer.id] as string[];
    const bulk = (body: unknown) => call("POST", "/api/stock/bulk", { body });

    expect((await bulk({ action: "ACTIVATE", offerIds })).json).toEqual({ affected: 1 });
    expect((await bulk({ action: "ACTIVATE", offerIds })).json).toEqual({ affected: 0 });

    expect((await bulk({ action: "MOVE", offerIds, locationCode: "BOX-02" })).json).toEqual({ affected: 2 });
    expect((await bulk({ action: "MOVE", offerIds, locationCode: "BOX-02" })).json).toEqual({ affected: 0 });
    const stock = (await call("GET", "/api/stock")).json.items as { locations: string[]; draft: number }[];
    expect(stock.map((r) => [r.locations, r.draft])).toEqual([[["BOX-02"], 0], [["BOX-02"], 0]]);

    await sql`update offers set target_price_cents = null where id in ${sql(offerIds)}`;
    const suggested = await sql<{ n: number }[]>`select count(*)::int as n from offers where id in ${sql(offerIds)} and suggested_price_cents is not null`;
    expect((await bulk({ action: "ACCEPT_PRICE", offerIds })).json).toEqual({ affected: suggested[0]!.n });
    const priced = await sql<{ target: number | null; suggested: number | null }[]>`
      select target_price_cents as target, suggested_price_cents as suggested from offers where id in ${sql(offerIds)}`;
    for (const o of priced) expect(o.target).toBe(o.suggested);

    expect((await bulk({ action: "MOVE", offerIds })).status).toBe(400);
    expect((await bulk({ action: "MOVE", offerIds, locationCode: "NOWHERE" })).status).toBe(404);
  });
});

describe("photos added after the fact", () => {
  it("lets a card that entered stock without a photo get one later, which unblocks its listing, and removes it again", async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const { candidates } = (await call("GET", "/api/catalog/cards?name=fouinar")).json;
    const received = await call("POST", "/api/inventory/receive", {
      body: { variantId: candidates[0].variants[0].id, condition: "NM", quantity: 1, locationCode: "BOX-01", unitCostCents: 0 },
    });
    const offerId = received.json.offer.id;
    await call("PUT", "/api/channels/ebay", { body: { mode: "SIMULATION" } });
    const jpeg = { body: new Uint8Array([0xff, 0xd8, 0xff, 5]), headers: { "Content-Type": "image/jpeg" }, key: null };

    expect((await call("GET", `/api/stock/${offerId}`)).json.missing).toEqual(["PHOTO"]);
    expect((await call("POST", `/api/listings/offers/${offerId}/publish`, { body: { channel: "ebay" } })).json.error.code).toBe("LISTING_NOT_READY");
    expect((await call("POST", `/api/stock/${crypto.randomUUID()}/photos`, jpeg)).status).toBe(404);

    const added = await call("POST", `/api/stock/${offerId}/photos?kind=SCAN_FRONT`, jpeg);
    expect([added.status, added.json.kind, added.json.offerId, added.json.stockItemId]).toEqual([201, "SCAN_FRONT", offerId, received.json.stockItem.id]);
    const detail = (await call("GET", `/api/stock/${offerId}`)).json;
    expect([detail.missing, detail.photos.length, detail.photoUrl]).toEqual([[], 1, added.json.url]);
    expect((await call("POST", `/api/listings/offers/${offerId}/publish`, { body: { channel: "ebay" } })).json.status).toBe("ACTIVE");

    // Le visuel d'annonce tiré de la photo part avec elle.
    await call("POST", `/api/photos?kind=LISTING&source=${added.json.id}`, jpeg);
    expect((await call("DELETE", `/api/photos/${added.json.id}`, { key: null })).status).toBe(200);
    expect((await call("GET", `/api/stock/${offerId}`)).json).toMatchObject({ photos: [], missing: ["PHOTO"] });
    expect((await call("DELETE", `/api/photos/${added.json.id}`, { key: null })).status).toBe(404);
  });
});

describe("purchases", () => {
  it("watches a card with a target price, lists it with each platform's price, and finds deals", async () => {
    tcgdex = fakeClient(["sv03.5-151"].map(card));
    await call("POST", "/api/catalog/sets/sv03.5/sync", { body: {}, key: null });
    const mew = (await call("GET", "/api/catalog/cards?name=mew")).json.candidates[0];
    const variantId = mew.variants[0].id as string;

    const watched = await call("POST", "/api/watchlist", { body: { variantId, targetCents: 500 }, key: null });
    expect(watched.status).toBe(201);
    const list = (await call("GET", "/api/watchlist")).json;
    // Mew-ex : ventes 7,88 € / 7,32 €, annonce la moins chère 2,98 €, TCGplayer 6,79 $.
    expect(list.items[0]).toMatchObject({
      targetCents: 500, card: { name: "Mew-ex" },
      cardmarket: { sales: { cents: 760 }, lowCents: 298 }, tcgplayer: { marketCents: 679 }, alerts: ["TARGET_REACHED"],
    });
    expect(list.alerts).toBe(1);
    expect((await call("PATCH", `/api/watchlist/${watched.json.id}`, { body: { targetCents: null }, key: null })).status).toBe(200);
    expect((await call("POST", "/api/watchlist", { body: { variantId, targetCents: -1 }, key: null })).status).toBe(400);

    // Relevé de la veille (synchronisé par le test) : 7,60 € vendu, annonce à 2,98 € — sous 10 € par défaut, visible à partir de 5 €.
    await sql`update price_snapshots set observed_at = now() - interval '1 day'`;
    const isMew = (d: { variantId: string }) => d.variantId === variantId;
    expect((await call("GET", "/api/deals")).json.deals.some(isMew)).toBe(false);
    const deals = (await call("GET", "/api/deals?minCents=500")).json;
    expect(deals.deals.find(isMew)).toMatchObject({ estimateCents: 760, lowCents: 298, discountPercent: 61, watchedId: watched.json.id });
    expect((await call("GET", "/api/deals?minDiscount=200")).status).toBe(400);

    // Recherche libre : une ligne par variante, avec son prix et son suivi ; les plus grosses cartes du moment.
    const found = (await call("GET", "/api/catalog/search?q=mew%20151")).json.results;
    expect(found).toMatchObject([{ variantId, name: "Mew-ex", estimate: { cents: 760 }, watchedId: watched.json.id }]);
    expect((await call("GET", "/api/catalog/search?q=m")).json.results).toEqual([]);
    // Cartes demandées : Dracaufeu (Set de Base) s'est vendu la veille, 454 € sur la semaine contre 410 € sur le mois : +11 %.
    const trending = (await call("GET", "/api/purchases/trending?limit=5")).json.cards;
    expect(trending[0]).toMatchObject({ card: { name: "Dracaufeu" }, trendPercent: 11 });
    expect(trending.map((t: { card: { name: string } }) => t.card.name)).not.toContain("Mew-ex"); // moins de 10 €

    // Fiche de la carte : variantes avec leurs prix sur chaque plateforme et leur suivi.
    const page = (await call("GET", `/api/cards/${mew.catalogCardId}`)).json;
    expect(page.card).toMatchObject({ name: "Mew-ex", setName: "151", localNumber: "151" });
    expect(page.variants).toMatchObject([{ id: variantId, prices: { cardmarket: { sales: { cents: 760 }, lowCents: 298 }, tcgplayer: { marketCents: 679 } }, watched: { id: watched.json.id } }]);
    expect(page).toMatchObject({ offers: [], copies: [], sales: [], totals: { copies: 0 } });
    expect((await call("GET", `/api/cards/${crypto.randomUUID()}`)).status).toBe(404);

    expect((await call("DELETE", `/api/watchlist/${watched.json.id}`, { key: null })).status).toBe(200);
    expect((await call("DELETE", `/api/watchlist/${watched.json.id}`, { key: null })).status).toBe(404);
  });
});

describe("application settings", () => {
  it("remembers the onboarding progress and the way cards come in", async () => {
    const blank = { slipPaper: "ROLL_80", seller: { name: "", address: "", legal: "" }, notifications: { sales: true, watched: true, publications: true, supplies: true, reviews: true }, reviewMessage: "" };
    expect((await call("GET", "/api/app-settings")).json).toEqual({ onboardingDone: false, intakeMode: null, ...blank });
    expect((await call("PUT", "/api/app-settings", { body: { intakeMode: "CAMERA" } })).json).toEqual({ onboardingDone: false, intakeMode: "CAMERA", ...blank });
    expect((await call("PUT", "/api/app-settings", { body: { onboardingDone: true } })).json).toEqual({ onboardingDone: true, intakeMode: "CAMERA", ...blank });
    expect((await call("PUT", "/api/app-settings", { body: { intakeMode: "FAX" } })).status).toBe(400);
    // Papier de l'imprimante et en-tête des bons de livraison.
    const seller = { name: "Cartes du Rhône", address: "3 quai Victor Augagneur\n69003 Lyon", legal: "SIRET 000 000 000 00000" };
    expect((await call("PUT", "/api/app-settings", { body: { slipPaper: "LABEL_100X150", seller } })).json).toMatchObject({ intakeMode: "CAMERA", slipPaper: "LABEL_100X150", seller });
    expect((await call("PUT", "/api/app-settings", { body: { slipPaper: "A5" } })).status).toBe(400);
  });
});

describe("scheduled publications", () => {
  it("plans ready offers day by day, publishes what is due with the promo image last, and cancels the rest", async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const scanned = await scan();
    const received = await call("POST", "/api/inventory/receive", {
      body: { variantId: scanned.json.suggestedVariantId, condition: "NM", quantity: 1, locationCode: "BOX-01", unitCostCents: 0, photoIds: [scanned.json.photo.id] },
    });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

    expect((await call("POST", "/api/publications/plan", { body: { channel: "ebay", startOn: today, perDay: 10 } })).status).toBe(409);
    await call("PUT", "/api/channels/ebay", { body: { mode: "SIMULATION" } });
    expect((await call("POST", "/api/publications/plan", { body: { channel: "ebay", startOn: "2020-01-01", perDay: 10 } })).status).toBe(422);

    const promo = await call("POST", "/api/photos?kind=PROMO", { body: new Uint8Array([0xff, 0xd8, 0xff, 7]), headers: { "Content-Type": "image/jpeg" }, key: null });
    const settings = (await call("GET", "/api/listings/settings")).json;
    expect(settings.promoPhotoId).toBeNull();
    expect((await call("PUT", "/api/listings/settings", { body: { ...settings, promoPhotoId: promo.json.id } })).json.promoPhotoId).toBe(promo.json.id);
    expect((await call("PUT", "/api/listings/settings", { body: { ...settings, promoPhotoId: scanned.json.photo.id } })).status).toBe(422);

    const plan = await call("POST", "/api/publications/plan", { body: { channel: "ebay", startOn: today, perDay: 10 } });
    expect(plan.json).toMatchObject({ planned: 1, days: 1, firstDay: today });
    expect((await call("GET", "/api/publications")).json).toMatchObject({ pending: 1, days: [{ plannedOn: today, count: 1, cardNames: ["Fouinar"] }] });
    expect((await call("GET", "/api/stock")).json.items[0].planned).toMatchObject({ channel: "ebay", plannedOn: today });

    expect((await call("POST", "/api/publications/run")).json).toEqual({ published: 1, failed: 0, postponed: 0, packsAdded: 0 });
    const stock = (await call("GET", "/api/stock")).json.items[0];
    expect([stock.status, stock.planned, stock.offerId]).toEqual(["LISTED", null, received.json.offer.id]);
    expect((await call("POST", "/api/publications/cancel", { body: {} })).json).toEqual({ cancelled: 0 });
  });
});

describe("publication calendar", () => {
  it("shows planned, published and failed publications day by day, card by card, and moves or replans one", async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const offers: string[] = [];
    for (const condition of ["NM", "EX"]) {
      const scanned = await scan();
      offers.push((await call("POST", "/api/inventory/receive", {
        body: { variantId: scanned.json.suggestedVariantId, condition, quantity: 1, locationCode: "BOX-01", unitCostCents: 0, photoIds: [scanned.json.photo.id] },
      })).json.offer.id);
    }
    await call("PUT", "/api/channels/ebay", { body: { mode: "SIMULATION" } });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
    const plus = (n: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    expect((await call("POST", "/api/publications/plan", { body: { channel: "ebay", startOn: today, perDay: 1 } })).json).toMatchObject({ planned: 2, days: 2 });

    const calendar = async () => (await call("GET", `/api/publications/calendar?from=${today}&to=${plus(7)}`)).json.days;
    expect(await calendar()).toEqual([
      { date: today, planned: { ebay: 1 }, published: 0, failed: 0 },
      { date: plus(1), planned: { ebay: 1 }, published: 0, failed: 0 },
    ]);
    const tomorrow = (await call("GET", `/api/publications/day/${plus(1)}`)).json;
    expect(tomorrow.entries).toEqual([expect.objectContaining({ status: "PENDING", channel: "ebay", cardName: "Fouinar", setCode: "EB03", priceCents: expect.any(Number), photoUrl: expect.any(String) })]);

    // Avancée à aujourd'hui ; une date passée est refusée.
    const id = tomorrow.entries[0].id as string;
    expect((await call("PATCH", `/api/publications/${id}`, { body: { plannedOn: "2020-01-01" } })).status).toBe(422);
    expect((await call("PATCH", `/api/publications/${id}`, { body: { plannedOn: today } })).json).toEqual({ ok: true });
    expect(await calendar()).toEqual([{ date: today, planned: { ebay: 2 }, published: 0, failed: 0 }]);

    // Publiées : le jour les montre publiées ; un échec se replanifie.
    expect((await call("POST", "/api/publications/run")).json).toEqual({ published: 2, failed: 0, postponed: 0, packsAdded: 0 });
    expect(await calendar()).toEqual([{ date: today, planned: {}, published: 2, failed: 0 }]);
    expect((await call("GET", `/api/publications/day/${today}`)).json.entries.map((e: { status: string }) => e.status)).toEqual(["DONE", "DONE"]);
    expect((await call("PATCH", `/api/publications/${id}`, { body: { plannedOn: plus(2) } })).json.error.code).toBe("PUBLICATION_DONE");
    const [failed] = await sql<{ id: string }[]>`
      insert into scheduled_publications (offer_id, channel, planned_on, status, error_code, done_at)
      values (${offers[0]!}, 'ebay', ${today}, 'FAILED', 'LISTING_NOT_READY', now()) returning id`;
    expect((await calendar())[0]).toMatchObject({ failed: 1 });
    await call("PATCH", `/api/publications/${failed!.id}`, { body: { plannedOn: plus(3) } });
    expect((await calendar()).find((d: { date: string }) => d.date === plus(3))).toMatchObject({ planned: { ebay: 1 } });
    expect((await call("GET", `/api/publications/calendar?from=${plus(1)}&to=${today}`)).status).toBe(400);
  });
});

describe("statistics and price alerts", () => {
  it("refreshes the quotes of owned cards, exposes the dashboard and the price moves, and saves alert thresholds", async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const scanned = await scan();
    await call("POST", "/api/inventory/receive", { body: { variantId: scanned.json.suggestedVariantId, condition: "NM", quantity: 2, locationCode: "BOX-01", unitCostCents: 10 } });

    // Sont relevées la carte détenue et les « grosses » cartes du catalogue (Dracaufeu, coté plus de 10 €), pas les autres ;
    // la cotation du jour étant déjà connue, rien n'est ajouté en double.
    const refreshed = await call("POST", "/api/prices/refresh");
    expect(refreshed.json).toMatchObject({ cards: 2, pricesInserted: 0, errors: 0, remaining: 0, repriced: 0 });

    // Une cote plus ancienne et plus basse : la variation apparaît, et devient une alerte une fois le seuil abaissé.
    await sql`
      insert into price_snapshots (variant_id, source, quote_type, currency, amount_cents, observed_at)
      select variant_id, source, quote_type, currency, greatest(amount_cents - 5, 1), observed_at - interval '10 days'
        from price_snapshots where variant_id = ${scanned.json.suggestedVariantId} and quote_type = 'LISTED_TREND'`;
    const moves = await call("GET", "/api/stats/price-moves");
    expect(moves.json).toMatchObject({ alerts: 0, ownedVariants: 1, trackedVariants: 1, settings: { windowDays: 7, percent: 15, minChangeCents: 100 } });
    expect(moves.json.moves[0]).toMatchObject({ cardName: "Fouinar", quantity: 2, deltaCents: 5, alert: false });
    expect(moves.json.moves[0].series).toHaveLength(2);

    expect((await call("PUT", "/api/stats/alert-settings", { body: { windowDays: 0, percent: 5, minChangeCents: 1 } })).status).toBe(422);
    expect((await call("PUT", "/api/stats/alert-settings", { body: { windowDays: 7, percent: 5, minChangeCents: 1 } })).status).toBe(200);
    expect((await call("GET", "/api/stats/price-moves?alerts=true")).json).toMatchObject({ alerts: 1, moves: [{ cardName: "Fouinar", alert: true }] });

    const dashboard = await call("GET", "/api/stats/dashboard");
    expect(dashboard.json).toMatchObject({ stock: { cards: 2, costCents: 20 }, openOrders: 0, byChannel: [] });
    expect(dashboard.json.months).toHaveLength(6);
    expect(dashboard.json.topOffers[0]).toMatchObject({ cardName: "Fouinar", quantity: 2 });
  });
});

describe("what sells", () => {
  it("breaks recent sales down by set, price band, condition, delay and top cards, without cancelled sales", async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const fouinar = await fouinarReverse();
    const dracaufeu = (await call("GET", "/api/catalog/cards?name=dracaufeu")).json.candidates[0].variants[0].id as string;
    const receive = async (variantId: string, quantity: number, unitCostCents: number) =>
      (await call("POST", "/api/inventory/receive", { body: { variantId, condition: "NM", quantity, locationCode: "BOX-01", unitCostCents } })).json.offer.id as string;
    const cheap = await receive(fouinar, 3, 20);
    const rare = await receive(dracaufeu, 2, 5000);
    const sell = (offerId: string, qty: number, unitPriceCents: number) =>
      call("POST", "/api/orders", { body: { lines: [{ offerId, qty, unitPriceCents }], shippingMode: "HAND_DELIVERY" } });
    await sell(cheap, 2, 80);
    await sell(rare, 1, 12000);
    const cancelled = (await sell(cheap, 1, 80)).json.id as string;
    await call("POST", `/api/orders/${cancelled}/cancel`, { body: { reason: "Acheteur absent" } });

    const { status, json } = await call("GET", "/api/stats/sales?days=30");
    expect(status).toBe(200);
    expect(json.days).toBe(30);
    expect(json.totals).toMatchObject({
      orders: 2, cards: 3, revenueCents: 12160, marginCents: 12160 - 40 - 5000, averageCardCents: 4053, averageOrderCents: 6080, medianDaysToSell: 0,
    });
    // 3 vendues, 1 Fouinar et 1 Dracaufeu encore en stock (l'annulée est revenue) : 3 / 5.
    expect(json.totals.sellThroughPercent).toBe(60);
    expect(json.byPriceBand.map((b: { key: string; cards: number }) => [b.key, b.cards])).toEqual([["lt1", 2], ["1-5", 0], ["5-10", 0], ["10-20", 0], ["20-50", 0], ["gte50", 1]]);
    expect(json.byCondition).toEqual([{ key: "NM", label: "Near Mint", cards: 3, revenueCents: 12160 }]);
    expect(json.bySet.map((x: { key: string; cards: number; inStock: number }) => [x.key, x.cards, x.inStock])).toEqual([["swsh3", 2, 1], ["base1", 1, 1]]);
    expect(json.topCards[0]).toMatchObject({ name: "Fouinar", cards: 2, averageCents: 80 });
    expect(json.daysToSell[0]).toMatchObject({ key: "lt7", cards: 3 });
    expect(json.byWeekday).toHaveLength(7);
    expect(json.months).toHaveLength(12);
    // Jamais passées en ligne mais vendues en direct : les deux positions comptent comme mises en vente (3 + 2).
    expect(json.totals.listed).toBe(5);
    expect(json.months.at(-1)).toMatchObject({ cards: 3, revenueCents: 12160, listed: 5 });
    expect(json.previous).toEqual({ orders: 0, cards: 0, revenueCents: 0, listed: 0 });
    // Une carte reçue puis mise en ligne compte à sa mise en ligne ; une carte seulement en stock, pas encore.
    const listedLater = await receive(fouinar, 4, 20);
    await call("POST", "/api/inventory/receive", { body: { variantId: dracaufeu, condition: "LP", quantity: 1, locationCode: "BOX-01", unitCostCents: 100 } });
    await sql`insert into listings (offer_id, channel, price_cents, status) values (${listedLater}, 'ebay', 100, 'ACTIVE')`;
    expect((await call("GET", "/api/stats/sales?days=30")).json.totals.listed).toBe(9);
    expect((await call("GET", "/api/stats/sales?days=3")).status).toBe(400);
  });
});

describe("sales channels", () => {
  it("runs the whole marketplace circuit in simulation: publish, direct sale lowers the listing, simulated order, end", async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const scanned = await scan();
    const received = await call("POST", "/api/inventory/receive", {
      body: { variantId: scanned.json.suggestedVariantId, condition: "NM", quantity: 3, locationCode: "BOX-01", unitCostCents: 0, photoIds: [scanned.json.photo.id] },
    });
    const offerId = received.json.offer.id;
    const listing = async () => (await call("GET", "/api/listings/offers")).json.items[0].listings[0];

    expect((await call("GET", "/api/channels")).json.channels.map((c: { id: string; mode: string }) => [c.id, c.mode])).toEqual([["ebay", "OFF"], ["cardtrader", "OFF"]]);
    expect((await call("POST", `/api/listings/offers/${offerId}/publish`, { body: { channel: "ebay" } })).status).toBe(409);
    expect((await call("PUT", "/api/channels/ebay", { body: { mode: "LIVE" } })).json.error.code).toBe("CHANNEL_NOT_CONFIGURED");
    expect((await call("PUT", "/api/channels/vinted", { body: { mode: "SIMULATION" } })).status).toBe(400);
    expect((await call("PUT", "/api/channels/ebay", { body: { mode: "SIMULATION" } })).json.channels[0].mode).toBe("SIMULATION");

    const published = await call("POST", `/api/listings/offers/${offerId}/publish`, { body: { channel: "ebay" } });
    expect(published.json).toMatchObject({ status: "ACTIVE", simulated: true, quantitySent: 3 });

    // Une vente directe retire aussitôt la carte de l'annonce.
    await call("POST", "/api/orders", { body: { lines: [{ offerId, qty: 1, unitPriceCents: 100 }], shippingMode: "HAND_DELIVERY" } });
    expect(await listing()).toMatchObject({ quantitySent: 2, status: "ACTIVE" });

    const order = await call("POST", `/api/listings/${published.json.id}/simulate-order`, { body: { qty: 2 } });
    expect([order.status, order.json.channel, order.json.stage, order.json.oversold]).toEqual([201, "ebay", "TO_PREPARE", false]);
    expect(await listing()).toMatchObject({ quantitySent: 0, status: "PAUSED" });
    expect((await call("GET", "/api/orders")).json.counts.TO_PREPARE).toBe(2);

    expect((await call("POST", `/api/listings/${published.json.id}/end`)).status).toBe(200);
    expect((await call("POST", `/api/listings/${published.json.id}/end`)).status).toBe(404);
    expect(await call("POST", "/api/channels/sync")).toMatchObject({ status: 200, json: { orders: 0, updated: 0, errors: 0 } });
  });

  it("says when the eBay application keys are missing, and keeps the eBay settings", async () => {
    expect((await call("GET", "/api/channels/ebay/connection")).json).toMatchObject({
      configured: false, account: null, missing: ["FULFILLMENT_POLICY", "PAYMENT_POLICY", "RETURN_POLICY", "LOCATION"],
    });
    expect((await call("POST", "/api/channels/ebay/connect")).json.error.code).toBe("CHANNEL_NOT_CONFIGURED");
    expect((await call("GET", "/api/channels/ebay/options")).status).toBe(409);
    const saved = await call("PUT", "/api/channels/ebay/settings", { body: { marketplaceId: "EBAY_DE", paymentPolicyId: "P1" } });
    expect(saved.json.settings).toMatchObject({ marketplaceId: "EBAY_DE", paymentPolicyId: "P1", categoryId: "183454" });
    expect((await call("PUT", "/api/channels/ebay/settings", { body: { marketplaceId: "EBAY_US" } })).status).toBe(400);
    // Les réglages eBay ne changent rien au mode du canal.
    expect((await call("GET", "/api/channels")).json.channels[0]).toMatchObject({ mode: "OFF", liveAvailable: false, liveBlocker: null });
  });
});

describe("direct sales", () => {
  it("sells from stock end to end: reservation, picking by SKU, packing, handover, margin", async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-01/ROW-03" } });
    const variantId = await fouinarReverse();
    const received = (await call("POST", "/api/inventory/receive", {
      body: { variantId, condition: "NM", quantity: 3, locationCode: "BOX-01/ROW-03", unitCostCents: 20 },
    })).json;
    const offerId = received.offer.id as string;
    const number = String(Number((received.stockItem.unitSku as string).slice(3)));

    expect((await call("GET", "/api/offers/sellable?q=fouin")).json.offers).toMatchObject([{ offerId, availableToSell: 3, card: { name: "Fouinar" } }]);

    const body = { lines: [{ offerId, qty: 2, unitPriceCents: 150 }], shippingMode: "LETTER_UNTRACKED", shippingChargedCents: 200, buyerName: "Camille" };
    const created = await call("POST", "/api/orders", { body, key: "sale-key-0001" });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ stage: "TO_PREPARE", buyerName: "Camille", totals: { grossCents: 500, costCents: 40, marginCents: 460 } });
    const replay = await call("POST", "/api/orders", { body, key: "sale-key-0001" });
    expect(replay.json.id).toBe(created.json.id);
    expect((await call("GET", "/api/offers/sellable")).json.offers[0].availableToSell).toBe(1);

    const id = created.json.id as string;
    const allocation = created.json.lines[0].allocations[0];
    expect(allocation).toMatchObject({ locationCode: "BOX-01/ROW-03", unitSku: received.stockItem.unitSku, qty: 2 });

    const tooMany = await call("POST", "/api/orders", { body: { ...body, lines: [{ offerId, qty: 2, unitPriceCents: 150 }] } });
    expect([tooMany.status, tooMany.json.error.code]).toEqual([409, "INSUFFICIENT_STOCK"]);
    expect((await call("POST", `/api/orders/${id}/pack`, { key: null })).json.error.code).toBe("NOT_FULLY_PICKED");
    expect((await call("POST", `/api/orders/${id}/pick`, { body: { allocationId: allocation.id, unitSku: "999999" }, key: null })).json.error.code).toBe("UNKNOWN_SKU");

    // Préparation du jour : la commande, son prélèvement, puis la marque d'impression.
    const run = (await call("GET", "/api/orders/preparation")).json;
    expect(run).toMatchObject({ slipPaper: "ROLL_80", seller: { name: "" }, orders: [{ id, slipPrintedAt: null, addressLines: [], lines: [{ allocations: [{ locationCode: "BOX-01/ROW-03" }] }] }] });
    expect((await call("POST", "/api/orders/preparation/printed", { body: { orderIds: [id] }, key: null })).json).toEqual({ marked: 1 });
    expect((await call("GET", "/api/orders/preparation")).json.orders[0].slipPrintedAt).toEqual(expect.any(String));
    expect((await call("POST", "/api/orders/preparation/printed", { body: { orderIds: [] }, key: null })).status).toBe(400);

    const picked = await call("POST", `/api/orders/${id}/pick`, { body: { allocationId: allocation.id, unitSku: number }, key: null });
    expect(picked.json.lines[0].allocations[0].status).toBe("PICKED");
    expect((await call("POST", `/api/orders/${id}/pack`, { key: null })).json.stage).toBe("PACKED");
    const shipped = await call("POST", `/api/orders/${id}/handover`, { body: { postageCostCents: 129 }, key: null });
    expect(shipped.json).toMatchObject({ stage: "SHIPPED", totals: { postageCents: 129, marginCents: 331 }, shipment: { status: "HANDED_OVER" } });

    const list = (await call("GET", "/api/orders?stage=SHIPPED")).json;
    expect(list).toMatchObject({ counts: { SHIPPED: 1, TO_PREPARE: 0 }, last30Days: { orders: 1, grossCents: 500, marginCents: 331 } });
    expect(list.items[0]).toMatchObject({ externalId: created.json.externalId, cards: 2, cardNames: ["Fouinar"] });
    expect((await call("GET", `/api/inventory/${received.stockItem.id}`)).json).toMatchObject({ onHand: 1, reserved: 0 });
    expect((await call("POST", `/api/orders/${id}/cancel`, { body: { reason: "trop tard" }, key: null })).json.error.code).toBe("ALREADY_SHIPPED");
  });

  it("cancels a sale before handover and frees the cards", async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const received = (await call("POST", "/api/inventory/receive", {
      body: { variantId: await fouinarReverse(), condition: "NM", quantity: 1, locationCode: "BOX-01", unitCostCents: 0 },
    })).json;
    const created = await call("POST", "/api/orders", { body: { lines: [{ offerId: received.offer.id, qty: 1, unitPriceCents: 100 }], shippingMode: "HAND_DELIVERY" } });
    expect((await call("GET", "/api/offers/sellable")).json.offers).toEqual([]);
    const cancelled = await call("POST", `/api/orders/${created.json.id}/cancel`, { body: { reason: "acheteur désisté" }, key: null });
    expect(cancelled.json).toMatchObject({ stage: "CANCELLED", shipment: null });
    expect((await call("GET", "/api/offers/sellable")).json.offers[0].availableToSell).toBe(1);
    expect((await call("GET", "/api/orders/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});

describe("locations", () => {
  it("creates a series at once, edits a description, and only deletes unused leaves", async () => {
    const batch = await call("POST", "/api/locations/batch", { body: { codes: ["box-01/row-01", "BOX-01/ROW-02", "BOX-01/ROW-02"] }, key: null });
    expect(batch.status).toBe(201);
    expect(batch.json.created.map((l: { code: string }) => l.code)).toEqual(["BOX-01/ROW-01", "BOX-01/ROW-02"]);
    const again = await call("POST", "/api/locations/batch", { body: { codes: ["BOX-01/ROW-01", "BOX-01/ROW-03"] }, key: null });
    expect([again.json.created.length, again.json.existing.length]).toEqual([1, 1]);
    const invalid = await call("POST", "/api/locations/batch", { body: { codes: ["BOX-02", "BOX 03"] }, key: null });
    expect(invalid.json.error.code).toBe("INVALID_LOCATION_CODE");

    const { locations } = (await call("GET", "/api/locations")).json;
    expect(locations.map((l: { code: string }) => l.code)).toEqual(["BOX-01", "BOX-01/ROW-01", "BOX-01/ROW-02", "BOX-01/ROW-03"]);
    const id = (code: string) => locations.find((l: { code: string }) => l.code === code).id as string;

    const described = await call("PATCH", `/api/locations/${id("BOX-01")}`, { body: { description: "Étagère du haut" } });
    expect(described.json).toMatchObject({ code: "BOX-01", description: "Étagère du haut" });

    await call("POST", "/api/inventory/receive", {
      body: { variantId: await fouinarReverse(), condition: "NM", quantity: 1, locationCode: "BOX-01/ROW-01", unitCostCents: 0 },
    });
    expect((await call("DELETE", `/api/locations/${id("BOX-01")}`)).json.error.code).toBe("LOCATION_HAS_CHILDREN");
    const used = await call("DELETE", `/api/locations/${id("BOX-01/ROW-01")}`);
    expect([used.status, used.json.error.code]).toEqual([409, "LOCATION_IN_USE"]);
    expect((await call("DELETE", `/api/locations/${id("BOX-01/ROW-03")}`)).status).toBe(200);
    expect((await call("DELETE", `/api/locations/${id("BOX-01/ROW-03")}`)).status).toBe(404);
    expect(await count("locations")).toBe(3);
  });
});

describe("idempotency", () => {
  const receiveBody = async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    return { variantId: await fouinarReverse(), condition: "NM", quantity: 1, locationCode: "BOX-01", unitCostCents: 100 };
  };

  it("replays the original response instead of receiving the card twice", async () => {
    const body = await receiveBody();
    const first = await call("POST", "/api/inventory/receive", { body, key: "scan-session-42" });
    const second = await call("POST", "/api/inventory/receive", { body, key: "scan-session-42" });

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.json).toEqual(first.json);
    expect([first.headers.get("Idempotent-Replay"), second.headers.get("Idempotent-Replay")]).toEqual([null, "true"]);
    expect(await count("stock_items")).toBe(1);
  });

  it("serializes simultaneous retries of the same request", async () => {
    const body = await receiveBody();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => call("POST", "/api/inventory/receive", { body, key: "double-tap-0001" })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
    expect(new Set(results.map((r) => r.json.stockItem.unitSku)).size).toBe(1);
    expect(await count("stock_items")).toBe(1);
  });

  it("requires a key and refuses to reuse one for a different request", async () => {
    const body = await receiveBody();
    const missing = await call("POST", "/api/inventory/receive", { body, key: null });
    expect([missing.status, missing.json.error.code]).toEqual([400, "IDEMPOTENCY_KEY_REQUIRED"]);

    await call("POST", "/api/inventory/receive", { body, key: "reused-key-01" });
    const reused = await call("POST", "/api/inventory/receive", { body: { ...body, quantity: 5 }, key: "reused-key-01" });
    expect([reused.status, reused.json.error.code]).toEqual([422, "IDEMPOTENCY_KEY_REUSED"]);
    expect(await count("stock_items")).toBe(1);
  });

  it("does not burn the key when the request fails", async () => {
    const body = { ...(await receiveBody()), locationCode: "BOX-77" };
    const failed = await call("POST", "/api/inventory/receive", { body, key: "retry-after-fix" });
    expect([failed.status, failed.json.error.code]).toEqual([404, "LOCATION_NOT_FOUND"]);
    expect(await count("idempotency_keys")).toBe(await count("stock_items") + (await count("acquisition_lots")));

    await call("POST", "/api/locations", { body: { code: "BOX-77" } });
    expect((await call("POST", "/api/inventory/receive", { body, key: "retry-after-fix" })).status).toBe(201);
  });
});

describe("vrac (Parcours B)", () => {
  it("receives a bulk lot and extracts identified cards from it", async () => {
    await call("POST", "/api/locations", { body: { code: "BOX-VRAC" } });
    const bulk = await call("POST", "/api/inventory/bulk", {
      body: { descriptor: { setId: "swsh3", cardType: "communes", language: "fr" }, quantity: 1000, locationCode: "BOX-VRAC", totalCostCents: 2000 },
    });
    expect(bulk.status).toBe(201);
    expect(bulk.json).toMatchObject({ stockItem: { kind: "BULK", onHand: 1000, unitCostCents: 2 }, descriptor: { label: "Communes · swsh3 · FR" } });

    const variantId = await fouinarReverse();
    const path = `/api/inventory/${bulk.json.stockItem.id}/extract`;
    const extracted = await call("POST", path, { body: { variantId, condition: "NM", quantity: 5, locationCode: "BOX-VRAC" } });
    expect(extracted.json).toMatchObject({ stockItem: { kind: "FUNGIBLE", onHand: 5, unitCostCents: 2 } });

    const tooMany = await call("POST", path, { body: { variantId, condition: "NM", quantity: 996, locationCode: "BOX-VRAC" } });
    expect([tooMany.status, tooMany.json.error]).toMatchObject([409, { code: "INSUFFICIENT_STOCK", details: { available: 995 } }]);
    expect((await call("GET", "/api/inventory?kind=BULK")).json.items[0]).toMatchObject({ onHand: 995 });
  });
});

describe("validation and errors", () => {
  it("rejects malformed bodies with the offending fields", async () => {
    const variantId = await fouinarReverse();
    const valid = { variantId, condition: "NM", quantity: 1, locationCode: "BOX-01", unitCostCents: 100 };
    const cases: [unknown, string][] = [
      [{ ...valid, condition: "MINT" }, "condition"],
      [{ ...valid, quantity: 1.5 }, "quantity"],
      [{ ...valid, unitCostCents: -1 }, "unitCostCents"],
      [{ ...valid, locationId: "00000000-0000-4000-8000-000000000000" }, "locationCode"],
      [{ ...valid, surprise: true }, ""],
      [{ ...valid, variantId: "abc" }, "variantId"],
    ];
    for (const [body, path] of cases) {
      const res = await call("POST", "/api/inventory/receive", { body });
      expect(res.status).toBe(400);
      expect(res.json.error).toMatchObject({ code: "VALIDATION_ERROR", details: [{ path }] });
    }
    const notJson = await call("POST", "/api/inventory/receive", { body: "{oops", headers: { "Content-Type": "application/json" } });
    expect(notJson.json.error.code).toBe("INVALID_JSON");
    expect((await call("GET", "/api/inventory?limit=5000")).status).toBe(400);
    expect((await call("POST", "/api/locations", { body: { code: "BOX 01" } })).json.error.code).toBe("INVALID_LOCATION_CODE");
    expect(await count("stock_items")).toBe(0);
  });

  it("maps unknown resources to 404", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    await call("POST", "/api/locations", { body: { code: "BOX-01" } });
    const receive = await call("POST", "/api/inventory/receive", {
      body: { variantId: missing, condition: "NM", quantity: 1, locationCode: "BOX-01", unitCostCents: 0 },
    });
    expect([receive.status, receive.json.error.code]).toEqual([404, "VARIANT_NOT_FOUND"]);
    expect((await call("GET", `/api/inventory/${missing}`)).status).toBe(404);
    expect((await call("GET", "/api/inventory/SI-424242")).status).toBe(404);
    expect((await call("POST", `/api/inventory/${missing}/move`, { body: { locationCode: "BOX-01" } })).json.error.code).toBe("STOCK_ITEM_NOT_FOUND");
  });
});

describe("scan upload", () => {
  it("accepts a multipart upload and passes the image to the recognizer", async () => {
    let seen: { bytes: number; mediaType: string } | undefined;
    const base = recognize;
    recognize = async (image) => {
      seen = { bytes: image.data.byteLength, mediaType: image.mediaType };
      return base(image);
    };
    const form = new FormData();
    form.append("image", new File([new Uint8Array(1234)], "card.png", { type: "image/png" }));
    const res = await call("POST", "/api/scans?language=en", { body: form, key: null });
    expect(res.status).toBe(200);
    expect(seen).toEqual({ bytes: 1234, mediaType: "image/png" });
  });

  it("sends an uncertain reading to review with its reasons", async () => {
    recognize = async () => ({
      reading: { ...reading, name: null, name_legibility: "unreadable", language: null },
      model: "m", servedBy: "m", usage: { inputTokens: 1, outputTokens: 1, costUsd: null }, latencyMs: 1,
    });
    const res = await scan();
    expect(res.json).toMatchObject({ requiresReview: true, reviewReasons: ["name unreadable", "language not determined"] });
  });

  it("rejects unusable uploads before calling the model", async () => {
    let calls = 0;
    recognize = async () => {
      calls++;
      throw new Error("should not be called");
    };
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    expect((await scan({ headers: { "Content-Type": "application/pdf" } })).json.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect((await scan({ body: big })).status).toBe(413);
    expect((await scan({ body: new Uint8Array(6 * 1024 * 1024) })).status).toBe(413);
    expect((await scan({ body: new Uint8Array(0) })).json.error.code).toBe("IMAGE_REQUIRED");
    expect((await call("POST", "/api/scans", { body: new FormData(), key: null })).status).toBe(400);
    expect(calls).toBe(0);
  });

  it("reports a recognition outage as 502 without leaking its cause", async () => {
    recognize = async () => {
      throw new Error("401 invalid x-api-key sk-secret");
    };
    const res = await scan();
    expect([res.status, res.json.error.code]).toEqual([502, "SCAN_UNAVAILABLE"]);
    expect(JSON.stringify(res.json)).not.toContain("sk-secret");
    expect(errors).toHaveLength(1);
  });
});

describe("accounts", () => {
  const mails: Mail[] = [];
  const BASE = "https://dexlane.test";
  const accountsApp = createApp({
    sql, token: TOKEN, recognizer: () => ({ recognize: (image) => recognize(image) }), tcgdex: () => tcgdex, photos: createMemoryPhotoStore(),
    databaseUrl: testDatabaseUrl("api"), baseUrl: BASE,
    mailer: { send: async (mail) => void mails.push(mail) }, onError: (e) => errors.push(e),
  });
  let seq = 0;
  /** Requête du serveur web : pour un navigateur (`cookie`), ou en son nom propre. */
  async function req(method: string, path: string, opts: { body?: unknown; cookie?: string; account?: string } = {}) {
    const headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}`, Origin: BASE };
    if (opts.cookie !== undefined) Object.assign(headers, { Cookie: opts.cookie, "X-Dexlane-Browser": "1" });
    if (opts.account) headers["X-Dexlane-Account"] = opts.account;
    if (method === "POST" && !path.startsWith("/api/auth/")) headers["Idempotency-Key"] = `acc-key-${++seq}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await accountsApp.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), redirect: "manual" });
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, cookie, location: res.headers.get("location"), json: (await res.json().catch(() => null)) as any };
  }
  const linkIn = (mail: Mail) => {
    const url = new URL(mail.text.match(/https:\/\/\S+/)![0]);
    return url.pathname + url.search;
  };
  beforeEach(() => void (mails.length = 0));

  /** Inscription complète : le lien reçu vérifie l'adresse et ouvre la session. */
  async function register(email: string, password = "un-bon-mot-de-passe", extra: Record<string, string> = {}): Promise<{ cookie: string; accountId: string }> {
    const signup = await req("POST", "/api/auth/sign-up/email", { body: { name: email.split("@")[0], email, password, callbackURL: "/signup/verify", ...extra } });
    expect(signup.status).toBe(200);
    const verified = await req("GET", linkIn(mails.at(-1)!));
    expect(verified.status).toBe(302);
    const account = await req("GET", "/api/account", { cookie: verified.cookie });
    expect(account.status).toBe(200);
    return { cookie: verified.cookie, accountId: account.json.accountId };
  }

  it("sets up the installation owner with the setup flow, as an administrator on the installation account", async () => {
    expect((await req("GET", "/api/setup/status")).json).toEqual({ passwordSet: false });
    expect((await req("POST", "/api/setup/owner", { body: { email: "proprio@example.com", password: "court" } })).json.error.code).toBe("WEAK_PASSWORD");
    expect((await req("POST", "/api/setup/owner", { body: { email: "Proprio@Example.com", password: "premier-secret" } })).json).toEqual({ ok: true });
    expect((await req("GET", "/api/setup/status")).json).toEqual({ passwordSet: true });
    expect(mails).toHaveLength(0);

    const signedIn = await req("POST", "/api/auth/sign-in/email", { body: { email: "proprio@example.com", password: "premier-secret" } });
    expect(signedIn.status).toBe(200);
    expect((await req("GET", "/api/account", { cookie: signedIn.cookie })).json).toMatchObject({
      accountId: OWNER_ACCOUNT_ID, email: "proprio@example.com", role: "admin", requestedPlan: null, isOwner: true,
      // Le compte d'installation n'a pas de limite.
      plan: { id: "community", cardsPerMonth: null }, quota: { used: 0, limit: null, remaining: null },
    });
    expect((await req("POST", "/api/auth/sign-in/email", { body: { email: "proprio@example.com", password: "mauvais-secret" } })).status).toBe(401);

    // Clé de secours : le même flux remplace l'adresse et le mot de passe, et ferme les sessions ouvertes.
    expect((await req("POST", "/api/setup/owner", { body: { email: "nouveau@example.com", password: "deuxieme-secret" } })).status).toBe(200);
    expect((await req("GET", "/api/stock", { cookie: signedIn.cookie })).status).toBe(401);
    expect((await req("POST", "/api/auth/sign-in/email", { body: { email: "nouveau@example.com", password: "deuxieme-secret" } })).status).toBe(200);
    expect(await sql`select count(*)::int as n from auth_users`).toEqual([{ n: 1 }]);
    // Le navigateur ne peut pas appeler l'installation lui-même.
    expect((await req("POST", "/api/setup/owner", { body: { email: "x@example.com", password: "troisieme-secret" }, cookie: "" })).status).toBeGreaterThanOrEqual(401);
  });

  it("signs up with an email link, refuses to sign in before verification, and never reveals which emails exist", async () => {
    const signup = await req("POST", "/api/auth/sign-up/email", { body: { name: "Camille", email: "Camille@Example.com", password: "un-bon-mot-de-passe", callbackURL: "/signup/verify", plan: "solo", signupCode: "FLYER" } });
    expect(signup.status).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: "camille@example.com", subject: "Confirme ton adresse e-mail" });
    expect(mails[0]!.text).toContain(`${BASE}/api/auth/verify-email?token=`);

    // Avant la vérification : le bon mot de passe ne suffit pas, et un navigateur sans session n'a accès à rien.
    const early = await req("POST", "/api/auth/sign-in/email", { body: { email: "camille@example.com", password: "un-bon-mot-de-passe" } });
    expect([early.status, early.json.code]).toEqual([403, "EMAIL_NOT_VERIFIED"]);
    expect((await req("GET", "/api/stock", { cookie: "" })).json.error.code).toBe("SESSION_EXPIRED");

    // Le lien vérifie l'adresse, ouvre la session et renvoie vers le site.
    const verified = await req("GET", linkIn(mails[0]!));
    expect([verified.status, verified.location]).toEqual([302, "/signup/verify"]);
    const account = (await req("GET", "/api/account", { cookie: verified.cookie })).json;
    // Le forfait choisi sur le site est retenu ; le compte démarre en Découverte (20 cartes par mois).
    expect(account).toMatchObject({
      accountId: expect.stringMatching(/^[0-9a-f-]{36}$/), email: "camille@example.com", role: "user", requestedPlan: "solo",
      plan: { id: "decouverte", cardsPerMonth: 20 }, quota: { used: 0, limit: 20, remaining: 20 },
    });
    expect(account.accountId).not.toBe(OWNER_ACCOUNT_ID);

    const signedIn = await req("POST", "/api/auth/sign-in/email", { body: { email: "camille@example.com", password: "un-bon-mot-de-passe" } });
    expect(signedIn.status).toBe(200);
    expect((await req("GET", "/api/account", { cookie: signedIn.cookie })).json.accountId).toBe(account.accountId);
    expect((await req("POST", "/api/auth/sign-in/email", { body: { email: "camille@example.com", password: "mauvais-mot-de-passe" } })).status).toBe(401);
    expect((await req("POST", "/api/auth/sign-in/email", { body: { email: "inconnue@example.com", password: "un-bon-mot-de-passe" } })).status).toBe(401);

    // Adresse déjà inscrite : même réponse, un e-mail qui le dit à son propriétaire, et le mot de passe ne change pas.
    const again = await req("POST", "/api/auth/sign-up/email", { body: { name: "X", email: "camille@example.com", password: "un-autre-mot-de-passe", callbackURL: "/signup/verify" } });
    expect(again.status).toBe(200);
    expect(mails.at(-1)).toMatchObject({ subject: "Tu as déjà un compte Dexlane" });
    expect((await req("POST", "/api/auth/sign-in/email", { body: { email: "camille@example.com", password: "un-autre-mot-de-passe" } })).status).toBe(401);
    expect((await req("POST", "/api/auth/sign-up/email", { body: { name: "X", email: "court@example.com", password: "court" } })).status).toBe(400);
    // Déconnexion : la session ne vaut plus rien.
    expect((await req("POST", "/api/auth/sign-out", { body: {}, cookie: signedIn.cookie })).status).toBe(200);
    expect((await req("GET", "/api/stock", { cookie: signedIn.cookie })).status).toBe(401);
  });

  it("resets a forgotten password from an email link, which closes the older sessions", async () => {
    const lea = await register("lea@example.com");
    expect((await req("POST", "/api/auth/request-password-reset", { body: { email: "lea@example.com", redirectTo: "/reset-password" } })).status).toBe(200);
    expect(mails.at(-1)).toMatchObject({ subject: "Réinitialise ton mot de passe" });
    const count = mails.length;
    expect((await req("POST", "/api/auth/request-password-reset", { body: { email: "inconnue@example.com", redirectTo: "/reset-password" } })).status).toBe(200);
    expect(mails).toHaveLength(count);

    // Le lien renvoie vers la page du site avec son jeton.
    const followed = await req("GET", linkIn(mails.at(-1)!));
    expect(followed.status).toBe(302);
    const token = new URL(followed.location!, BASE).searchParams.get("token")!;
    expect(new URL(followed.location!, BASE).pathname).toBe("/reset-password");
    expect((await req("POST", "/api/auth/reset-password", { body: { token, newPassword: "nouveau-mot-de-passe" } })).status).toBe(200);
    expect((await req("POST", "/api/auth/sign-in/email", { body: { email: "lea@example.com", password: "un-bon-mot-de-passe" } })).status).toBe(401);
    expect((await req("POST", "/api/auth/sign-in/email", { body: { email: "lea@example.com", password: "nouveau-mot-de-passe" } })).status).toBe(200);
    expect((await req("GET", "/api/stock", { cookie: lea.cookie })).status).toBe(401);
    expect((await req("POST", "/api/auth/reset-password", { body: { token, newPassword: "encore-un-mot-de-passe" } })).status).toBe(400);
  });

  it("keeps each account's data apart: stock, locations, settings, sales and agents", async () => {
    const [alice, bob] = [await register("alice@example.com"), await register("bob@example.com")];
    expect((await req("GET", "/api/accounts/active")).json.accountIds).toEqual([alice.accountId, bob.accountId]);
    expect((await req("GET", "/api/accounts/active", { cookie: alice.cookie })).status).toBe(403);

    // Le même code d'emplacement et la même carte dans deux comptes : aucune collision.
    const variantId = await fouinarReverse();
    const stocked = new Map<string, string>();
    for (const [who, quantity] of [[alice, 3], [bob, 1]] as const) {
      expect((await req("POST", "/api/locations", { body: { code: "BOX-01" }, cookie: who.cookie })).status).toBe(201);
      const received = await req("POST", "/api/inventory/receive", { body: { variantId, condition: "NM", quantity, locationCode: "BOX-01", unitCostCents: 10 }, cookie: who.cookie });
      expect(received.status).toBe(201);
      stocked.set(who.accountId, received.json.offer.id);
    }
    const [aliceOffer, bobOffer] = [stocked.get(alice.accountId)!, stocked.get(bob.accountId)!];
    expect(aliceOffer).not.toBe(bobOffer);
    const stockOf = async (opts: { cookie?: string }) => (await req("GET", "/api/stock", opts)).json.items.map((i: { offerId: string; onHand: number }) => [i.offerId, i.onHand]);
    expect(await stockOf(alice)).toEqual([[aliceOffer, 3]]);
    expect(await stockOf(bob)).toEqual([[bobOffer, 1]]);
    // Le compte d'installation ne voit rien de tout cela.
    expect(await stockOf({})).toEqual([]);
    // Un navigateur ne choisit pas son compte : l'en-tête est ignoré au profit de la session.
    expect((await req("GET", "/api/stock", { cookie: bob.cookie, account: alice.accountId })).json.items.map((i: { offerId: string }) => i.offerId)).toEqual([bobOffer]);

    // Une ressource d'un autre compte n'existe pas pour moi.
    expect((await req("GET", `/api/stock/${aliceOffer}`, { cookie: bob.cookie })).status).toBe(404);
    expect((await req("POST", "/api/orders", { body: { lines: [{ offerId: aliceOffer, qty: 1, unitPriceCents: 500 }], shippingMode: "HAND_DELIVERY" }, cookie: bob.cookie })).status).toBeGreaterThanOrEqual(400);
    expect(await stockOf(alice)).toEqual([[aliceOffer, 3]]);

    // Réglages : une ligne par compte.
    expect((await req("PUT", "/api/app-settings", { body: { onboardingDone: true }, cookie: alice.cookie })).status).toBe(200);
    expect((await req("GET", "/api/app-settings", { cookie: alice.cookie })).json.onboardingDone).toBe(true);
    expect((await req("GET", "/api/app-settings", { cookie: bob.cookie })).json.onboardingDone).toBe(false);
    expect((await req("PUT", "/api/channels/ebay", { body: { mode: "SIMULATION" }, cookie: alice.cookie })).status).toBe(200);
    const mode = async (who: { cookie: string }) => (await req("GET", "/api/channels", { cookie: who.cookie })).json.channels.find((ch: { id: string }) => ch.id === "ebay").mode;
    expect([await mode(alice), await mode(bob)]).toEqual(["SIMULATION", "OFF"]);

    // Une vente d'Alice n'apparaît que chez elle.
    expect((await req("POST", "/api/orders", { body: { lines: [{ offerId: aliceOffer, qty: 1, unitPriceCents: 500 }], shippingMode: "HAND_DELIVERY" }, cookie: alice.cookie })).status).toBe(201);
    expect((await req("GET", "/api/orders", { cookie: alice.cookie })).json.items).toHaveLength(1);
    expect((await req("GET", "/api/orders", { cookie: bob.cookie })).json.items).toHaveLength(0);

    // Un jeton d'agent n'ouvre que le stock du compte qui l'a créé.
    const created = await req("POST", "/api/agent-tokens", { body: { name: "Airth" }, cookie: bob.cookie });
    expect(created.status).toBe(201);
    const mcp = await accountsApp.request("/api/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${created.json.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_stock", arguments: {} } }),
    });
    const text = JSON.stringify(await mcp.json());
    expect(text).toContain(bobOffer);
    expect(text).not.toContain(aliceOffer);

    // En base, chaque ligne porte son compte.
    const owners = await sql<{ accountId: string; n: number }[]>`select account_id, count(*)::int as n from offers group by 1`;
    expect(owners).toHaveLength(2);
    expect(owners).toEqual(expect.arrayContaining([{ accountId: alice.accountId, n: 1 }, { accountId: bob.accountId, n: 1 }]));
    expect(errors).toEqual([]);
  });

  it("lets a Boutique owner invite teammates by email, who then work in the same stock, and remove them", async () => {
    const owner = await register("gerant@example.com");
    const clerk = await register("vendeur@example.com");
    // Sans le forfait Boutique, pas d'équipe.
    const refused = await req("POST", "/api/team/invitations", { body: { email: "vendeur@example.com" }, cookie: owner.cookie });
    expect([refused.status, refused.json.error.details.requiredPlan]).toEqual([403, "boutique"]);
    expect((await req("PUT", "/api/account/plan", { body: { plan: "boutique" }, cookie: owner.cookie })).json.plan.id).toBe("boutique");
    // Le futur vendeur est encore seul sur son propre compte : il y gère son forfait.
    expect((await req("PUT", "/api/account/plan", { body: { plan: "pro" }, cookie: clerk.cookie })).status).toBe(200);

    const invited = await req("POST", "/api/team/invitations", { body: { email: "Vendeur@Example.com" }, cookie: owner.cookie });
    expect(invited.status).toBe(201);
    expect(mails.at(-1)).toMatchObject({ to: "vendeur@example.com", subject: "Tu es invité sur Dexlane" });
    const token = new URL(mails.at(-1)!.text.match(/https:\/\/\S+/)![0]).searchParams.get("token")!;
    expect((await req("GET", "/api/team", { cookie: owner.cookie })).json.invitations).toEqual([expect.objectContaining({ email: "vendeur@example.com" })]);

    // Une autre adresse ne peut pas utiliser le lien.
    const intruder = await register("intrus@example.com");
    expect((await req("POST", "/api/team/invitations/accept", { body: { token }, cookie: intruder.cookie })).json.error.code).toBe("INVITATION_OTHER_EMAIL");
    expect((await req("POST", "/api/team/invitations/preview", { body: { token }, cookie: clerk.cookie })).json).toEqual({ email: "vendeur@example.com", invitedBy: "gerant@example.com", matches: true });
    expect((await req("POST", "/api/team/invitations/accept", { body: { token }, cookie: clerk.cookie })).json).toEqual({ ok: true, accountId: owner.accountId });
    expect((await req("POST", "/api/team/invitations/accept", { body: { token }, cookie: clerk.cookie })).status).toBe(404);

    // Le vendeur voit maintenant le stock de la boutique, et pas l'inverse.
    expect((await req("POST", "/api/locations", { body: { code: "VITRINE" }, cookie: owner.cookie })).status).toBe(201);
    expect((await req("GET", "/api/locations", { cookie: clerk.cookie })).json.locations.map((l: { code: string }) => l.code)).toContain("VITRINE");
    const team = (await req("GET", "/api/team", { cookie: clerk.cookie })).json;
    expect(team.members.map((m: { email: string; isOwner: boolean }) => [m.email, m.isOwner])).toEqual([["gerant@example.com", true], ["vendeur@example.com", false]]);
    expect(team.canManage).toBe(false);
    expect((await req("PUT", "/api/account/plan", { body: { plan: "pro" }, cookie: clerk.cookie })).json.error.code).toBe("OWNER_ONLY");
    // Une boutique avec une équipe ne redescend pas sans elle.
    expect((await req("PUT", "/api/account/plan", { body: { plan: "pro" }, cookie: owner.cookie })).json.error.code).toBe("TEAM_HAS_MEMBERS");

    // Retiré : ses sessions sont fermées et il repart sur un compte vide.
    const clerkId = team.members[1].id;
    expect((await req("DELETE", `/api/team/members/${clerkId}`, { cookie: owner.cookie })).status).toBe(200);
    expect((await req("GET", "/api/stock", { cookie: clerk.cookie })).status).toBe(401);
    const back = await req("POST", "/api/auth/sign-in/email", { body: { email: "vendeur@example.com", password: "un-bon-mot-de-passe" } });
    const fresh = (await req("GET", "/api/account", { cookie: back.cookie })).json.accountId;
    expect([fresh === owner.accountId, fresh === clerk.accountId]).toEqual([false, false]);
    expect((await req("GET", "/api/locations", { cookie: back.cookie })).json.locations).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("exports a seller's data and erases the account with its journals, without touching another account", async () => {
    const seller = await register("efface@example.com");
    const other = await register("autre@example.com");
    expect((await req("POST", "/api/locations", { body: { code: "BOITE-1" }, cookie: seller.cookie })).status).toBe(201);
    expect((await req("POST", "/api/locations", { body: { code: "AUTRE" }, cookie: other.cookie })).status).toBe(201);
    // Un changement de forfait écrit dans le journal d'audit, en ajout seul.
    expect((await req("PUT", "/api/account/plan", { body: { plan: "solo" }, cookie: seller.cookie })).status).toBe(200);

    // Portabilité : ses données à lui, sans secret.
    const exported = await req("GET", "/api/account/export", { cookie: seller.cookie });
    expect(exported.status).toBe(200);
    expect(exported.json).toMatchObject({ format: "dexlane-export/1", account: { id: seller.accountId, plan: "solo" }, users: [{ email: "efface@example.com" }] });
    expect(exported.json.data.locations.map((l: { code: string }) => l.code)).toEqual(["BOITE-1"]);
    expect(exported.json.data.audit_events.length).toBeGreaterThan(0);
    expect(JSON.stringify(exported.json)).not.toMatch(/password|token_hash|"AUTRE"/);

    // Effacement : le mot de passe et le mot « SUPPRIMER » sont exigés.
    expect((await req("POST", "/api/account/delete", { body: { password: "faux", confirm: "SUPPRIMER" }, cookie: seller.cookie })).json.error.code).toBe("WRONG_PASSWORD");
    expect((await req("POST", "/api/account/delete", { body: { password: "un-bon-mot-de-passe", confirm: "oui" }, cookie: seller.cookie })).status).toBe(400);
    const erased = await req("POST", "/api/account/delete", { body: { password: "un-bon-mot-de-passe", confirm: "SUPPRIMER" }, cookie: seller.cookie });
    expect(erased.json).toEqual({ ok: true, deleted: "account" });
    expect((await req("GET", "/api/account", { cookie: seller.cookie })).status).toBe(401);
    expect((await req("POST", "/api/auth/sign-in/email", { body: { email: "efface@example.com", password: "un-bon-mot-de-passe" } })).status).toBe(401);
    for (const table of ["locations", "audit_events", "app_settings"]) {
      expect(await sql`select count(*)::int as n from ${sql(table)} where account_id = ${seller.accountId}`).toEqual([{ n: 0 }]);
    }
    expect(await sql`select count(*)::int as n from accounts where id = ${seller.accountId}`).toEqual([{ n: 0 }]);
    // Les journaux restent en ajout seul en dehors d'un effacement.
    await expect(sql`delete from audit_events where account_id = ${other.accountId}`).rejects.toThrow(/append-only/);
    // L'autre compte n'a rien perdu.
    expect((await req("GET", "/api/locations", { cookie: other.cookie })).json.locations.map((l: { code: string }) => l.code)).toEqual(["AUTRE"]);
    expect(errors).toEqual([]);
  });

  it("lets a teammate delete only their own user, and keeps the installation account from being deleted", async () => {
    const owner = await register("patron@example.com");
    const clerk = await register("equipier@example.com");
    await req("PUT", "/api/account/plan", { body: { plan: "boutique" }, cookie: owner.cookie });
    await req("POST", "/api/team/invitations", { body: { email: "equipier@example.com" }, cookie: owner.cookie });
    const token = new URL(mails.at(-1)!.text.match(/https:\/\/\S+/)![0]).searchParams.get("token")!;
    expect((await req("POST", "/api/team/invitations/accept", { body: { token }, cookie: clerk.cookie })).status).toBe(200);
    expect((await req("POST", "/api/locations", { body: { code: "COMPTOIR" }, cookie: owner.cookie })).status).toBe(201);

    const left = await req("POST", "/api/account/delete", { body: { password: "un-bon-mot-de-passe", confirm: "SUPPRIMER" }, cookie: clerk.cookie });
    expect(left.json).toEqual({ ok: true, deleted: "user" });
    expect((await req("GET", "/api/team", { cookie: owner.cookie })).json.members.map((m: { email: string }) => m.email)).toEqual(["patron@example.com"]);
    expect((await req("GET", "/api/locations", { cookie: owner.cookie })).json.locations.map((l: { code: string }) => l.code)).toEqual(["COMPTOIR"]);

    // Le compte d'installation (celui du serveur) ne se supprime pas.
    await req("POST", "/api/setup/owner", { body: { email: "serveur@example.com", password: "secret-du-serveur" } });
    const admin = await req("POST", "/api/auth/sign-in/email", { body: { email: "serveur@example.com", password: "secret-du-serveur" } });
    expect((await req("POST", "/api/account/delete", { body: { password: "secret-du-serveur", confirm: "SUPPRIMER" }, cookie: admin.cookie })).json.error.code).toBe("INSTALLATION_ACCOUNT");
    expect(errors).toEqual([]);
  });
});

describe("plans", () => {
  // Un canal réel factice : les publications simulées ne comptent pas dans le quota, les réelles si.
  const sent: { sku: string; title: string; priceCents: number }[] = [];
  const liveApp = createApp({
    sql, token: TOKEN, recognizer: () => ({ recognize: (image) => recognize(image) }), tcgdex: () => tcgdex, photos: createMemoryPhotoStore(),
    onError: (e) => errors.push(e),
    channels: {
      ebay: {
        publish: async (i) => {
          sent.push({ sku: i.offerSku, title: i.title, priceCents: i.priceCents });
          return { externalId: `EB-${i.offerSku}`, url: null };
        },
        setQuantity: async () => undefined, end: async () => undefined, fetchOrders: async () => [],
      },
    },
  });
  beforeEach(() => void (sent.length = 0));

  /** Requête du serveur pour un compte donné (comme la tâche planifiée). */
  async function as(accountId: string, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}`, "X-Dexlane-Account": accountId };
    if (method === "POST") headers["Idempotency-Key"] = crypto.randomUUID();
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await liveApp.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  /** Un compte au forfait donné, avec `n` cartes différentes prêtes à publier (prix et photo), et eBay en réel. */
  async function account(plan: string, n: number) {
    const [{ id }] = await sql<[{ id: string }]>`insert into accounts (plan) values (${plan}) returning id`;
    await as(id, "POST", "/api/locations", { code: "BOX-01" });
    const offers: string[] = [];
    const variants = (await as(id, "GET", "/api/catalog/cards?name=fouinar")).json.candidates[0].variants as { id: string }[];
    const dracaufeu = (await as(id, "GET", "/api/catalog/cards?name=dracaufeu")).json.candidates[0].variants as { id: string }[];
    const pool = [...variants, ...dracaufeu].map((v) => v.id);
    const conditions = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];
    for (let i = 0; i < n; i++) {
      // La photo du scan appartient au compte qui scanne.
      const res = await liveApp.request("/api/scans", {
        method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "X-Dexlane-Account": id, "Content-Type": "image/jpeg" }, body: new Uint8Array([0xff, 0xd8, 0xff, i]),
      });
      const scanned = { json: (await res.json()) as { photo: { id: string } } };
      const received = await as(id, "POST", "/api/inventory/receive", {
        variantId: pool[i % pool.length], condition: conditions[Math.floor(i / pool.length)], quantity: 1, locationCode: "BOX-01", unitCostCents: 50,
        unique: true, photoIds: [scanned.json.photo.id],
      });
      expect(received.status).toBe(201);
      await as(id, "POST", `/api/pricing/offers/${received.json.offer.id}/price`, { targetPriceCents: 300 + i });
      offers.push(received.json.offer.id);
    }
    expect((await as(id, "PUT", "/api/channels/ebay", { mode: "LIVE" })).status).toBe(200);
    return { id, offers };
  }

  it("counts each first publication against the monthly quota, refuses past it until a pack or an upgrade, and never counts a revision", async () => {
    const { id, offers } = await account("decouverte", 3);
    await sql`update accounts set plan = 'decouverte' where id = ${id}`;
    // Quota réduit à 2 pour le test : on simule 18 cartes déjà publiées ce mois-ci.
    const month = (await as(id, "GET", "/api/account")).json.quota.month;
    for (let i = 0; i < 18; i++) {
      const [{ id: fake }] = await sql<[{ id: string }]>`
        insert into offers (account_id, offer_sku, variant_id, condition, is_unique)
        select ${id}, ${`FAKE-${i}`}, variant_id, condition, true from offers where id = ${offers[0]!} returning id`;
      await sql`insert into publication_usage (account_id, offer_id, channel, month) values (${id}, ${fake}, 'ebay', ${month})`;
    }
    expect((await as(id, "GET", "/api/account")).json.quota).toMatchObject({ used: 18, included: 20, limit: 20, remaining: 2 });

    for (const offerId of offers.slice(0, 2)) expect((await as(id, "POST", `/api/listings/offers/${offerId}/publish`, { channel: "ebay" })).status).toBe(200);
    const refused = await as(id, "POST", `/api/listings/offers/${offers[2]}/publish`, { channel: "ebay" });
    expect([refused.status, refused.json.error.code]).toEqual([402, "QUOTA_EXCEEDED"]);
    expect(refused.json.error.details).toMatchObject({ used: 20, limit: 20, pack: { cards: 500, priceEur: 10 } });

    // Réviser une annonce déjà en ligne (son prix) ne compte pas, même quota atteint.
    expect((await as(id, "POST", `/api/listings/offers/${offers[0]}/publish`, { channel: "ebay" })).status).toBe(200);
    // Un pack rouvre le quota pour le mois.
    const withPack = await as(id, "POST", "/api/account/packs", {});
    expect(withPack.json.quota).toMatchObject({ used: 20, packCards: 500, limit: 520, remaining: 500 });
    expect((await as(id, "POST", `/api/listings/offers/${offers[2]}/publish`, { channel: "ebay" })).status).toBe(200);
    expect((await as(id, "GET", "/api/account")).json.quota.used).toBe(21);
    expect(await sql`select action, after->>'priceEur' as price from audit_events where account_id = ${id} and action = 'quota_pack_added'`).toEqual([{ action: "quota_pack_added", price: "10" }]);
  });

  it("keeps bulk publication, price sync and suggestions to the plans that include them, and changes plan on request", async () => {
    const { id, offers } = await account("decouverte", 2);
    await sql`update accounts set plan = 'decouverte' where id = ${id}`;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

    const bulk = await as(id, "POST", "/api/publications/plan", { channel: "ebay", startOn: today, perDay: 5, offerIds: offers });
    expect([bulk.status, bulk.json.error.code, bulk.json.error.details.requiredPlan]).toEqual([403, "FEATURE_NOT_IN_PLAN", "solo"]);
    // Une carte à la fois reste possible.
    expect((await as(id, "POST", "/api/publications/plan", { channel: "ebay", startOn: today, perDay: 5, offerIds: [offers[0]] })).status).toBe(200);
    const suggestions = await as(id, "GET", `/api/stock/${offers[0]}/suggestions`);
    expect([suggestions.status, suggestions.json.error.details.requiredPlan]).toEqual([403, "pro"]);

    // Sans synchronisation : un nouveau prix ne part pas sur l'annonce en ligne.
    expect((await as(id, "POST", `/api/listings/offers/${offers[1]}/publish`, { channel: "ebay" })).status).toBe(200);
    sent.length = 0;
    await as(id, "POST", `/api/pricing/offers/${offers[1]}/price`, { targetPriceCents: 999 });
    expect(sent).toEqual([]);

    // Passage en Pro : la synchronisation et les suggestions s'ouvrent ; le prix suivant part tout seul.
    const upgraded = await as(id, "PUT", "/api/account/plan", { plan: "pro" });
    expect(upgraded.json.plan).toMatchObject({ id: "pro", cardsPerMonth: 750, features: ["ebay", "bulk", "sync", "suggestions"] });
    await as(id, "POST", `/api/pricing/offers/${offers[1]}/price`, { targetPriceCents: 1099 });
    expect(sent).toEqual([expect.objectContaining({ priceCents: 1099 })]);
    const ok = await as(id, "GET", `/api/stock/${offers[0]}/suggestions`);
    expect(ok.json.title.suggested).toMatch(/^Fouinar 136\/189 Ténèbres Embrasées/);
    expect(ok.json.title.suggested.length).toBeLessThanOrEqual(80);
    // Le titre suggéré, une fois appliqué, part aussi sur l'annonce.
    sent.length = 0;
    const titled = await as(id, "PUT", `/api/stock/${offers[1]}/title`, { title: "Dracaufeu holo set de base" });
    expect(titled.json.text.title).toBe("Dracaufeu holo set de base");
    expect(sent.map((x) => x.title)).toEqual(["Dracaufeu holo set de base"]);

    // La boutique ne peut pas redescendre tant qu'elle a une équipe ; le compte d'installation n'a pas de forfait.
    expect((await call("PUT", "/api/account/plan", { body: { plan: "solo" } })).json.error.code).toBe("INSTALLATION_PLAN");
    expect((await as(id, "PUT", "/api/account/plan", { plan: "community" })).status).toBe(400);
    expect(errors).toEqual([]);
  });

  it("finishes a scheduled run started under the quota: packs cover the overrun on a paid plan, the free plan postpones it", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
    for (const plan of ["solo", "decouverte"]) {
      const { id, offers } = await account("solo", 3);
      const month = (await as(id, "GET", "/api/account")).json.quota.month;
      // Plus qu'une carte de quota.
      const limit = plan === "solo" ? 150 : 20;
      for (let i = 0; i < limit - 1; i++) {
        const [{ id: fake }] = await sql<[{ id: string }]>`
          insert into offers (account_id, offer_sku, variant_id, condition, is_unique)
          select ${id}, ${`FAKE-${i}`}, variant_id, condition, true from offers where id = ${offers[0]!} returning id`;
        await sql`insert into publication_usage (account_id, offer_id, channel, month) values (${id}, ${fake}, 'ebay', ${month})`;
      }
      expect((await as(id, "POST", "/api/publications/plan", { channel: "ebay", startOn: today, perDay: 10, offerIds: offers })).json.planned).toBe(3);
      await sql`update accounts set plan = ${plan} where id = ${id}`;
      const run = (await as(id, "POST", "/api/publications/run")).json;
      if (plan === "solo") {
        expect(run).toEqual({ published: 3, failed: 0, postponed: 0, packsAdded: 1 });
        expect((await as(id, "GET", "/api/account")).json.quota).toMatchObject({ used: 152, limit: 650, packs: [expect.objectContaining({ automatic: true, cards: 500 })] });
      } else {
        expect(run).toEqual({ published: 1, failed: 0, postponed: 2, packsAdded: 0 });
        const pending = await sql<{ plannedOn: string }[]>`select to_char(planned_on, 'YYYY-MM-DD') as planned_on from scheduled_publications where account_id = ${id} and status = 'PENDING'`;
        expect(pending.map((p) => p.plannedOn)).toEqual([expect.stringMatching(/-01$/), expect.stringMatching(/-01$/)]);
        expect(pending[0]!.plannedOn > today).toBe(true);
      }
    }
  });

  it("bundles cards into a lot sold as one listing, which counts as one card, and dissolves it back", async () => {
    const { id, offers } = await account("decouverte", 3);
    const lot = await as(id, "POST", "/api/lots", { title: "Lot de 3 cartes Pokémon", priceCents: 1500, items: offers.map((offerId) => ({ offerId, qty: 1 })) });
    expect(lot.status).toBe(201);
    expect(lot.json).toMatchObject({ title: "Lot de 3 cartes Pokémon", cards: 3, costCents: 150, status: "IN_STOCK", priceCents: 1500 });
    expect(lot.json.offerSku).toMatch(/^LOT-\d{6}$/);
    // Les cartes ont quitté le stock à l'unité ; le lot n'y apparaît pas comme une carte.
    expect((await as(id, "GET", "/api/stock")).json.items).toEqual([]);
    expect((await as(id, "POST", "/api/lots", { title: "Une seule", priceCents: 100, items: [{ offerId: offers[0], qty: 1 }] })).status).toBe(422);

    // Une annonce, une carte du quota ; la description liste les cartes.
    const published = await as(id, "POST", `/api/listings/offers/${lot.json.offerId}/publish`, { channel: "ebay" });
    expect(published.status).toBe(200);
    expect(sent.at(-1)).toMatchObject({ title: "Lot de 3 cartes Pokémon", priceCents: 1500 });
    expect((await as(id, "GET", "/api/account")).json.quota.used).toBe(1);
    const offer = (await as(id, "GET", "/api/listings/offers")).json.items.find((o: { kind: string }) => o.kind === "LOT");
    expect(offer.text.description).toContain("Lot de 3 cartes Pokémon :");
    expect(offer.text.description).toContain("- Fouinar");
    expect(offer.photos).toHaveLength(3);

    // Défait : l'annonce est retirée et les cartes reviennent.
    expect((await as(id, "DELETE", `/api/lots/${lot.json.offerId}`)).status).toBe(200);
    expect((await as(id, "GET", "/api/stock")).json.items).toHaveLength(3);
    expect((await as(id, "GET", "/api/lots")).json.lots[0].status).toBe("DISSOLVED");
    expect((await as(id, "DELETE", `/api/lots/${lot.json.offerId}`)).status).toBe(409);

    // Un lot vendu suit le circuit habituel des ventes, sous son titre.
    const again = await as(id, "POST", "/api/lots", { title: "Lot commun", priceCents: 800, items: offers.slice(0, 2).map((offerId) => ({ offerId, qty: 1 })) });
    const sale = await as(id, "POST", "/api/orders", { lines: [{ offerId: again.json.offerId, qty: 1, unitPriceCents: 800 }], shippingMode: "HAND_DELIVERY" });
    expect(sale.status).toBe(201);
    expect(sale.json).toMatchObject({ cardNames: ["Lot commun"], lines: [{ card: { name: "Lot commun", lot: true }, allocations: [{ qty: 1 }] }] });
    expect((await as(id, "GET", "/api/lots")).json.lots.find((l: { offerId: string }) => l.offerId === again.json.offerId).status).toBe("RESERVED");
  });

  it("records a graded card's grader, grade and certificate, and puts the grade in its title", async () => {
    const { id, offers } = await account("decouverte", 1);
    const graded = await as(id, "PUT", `/api/stock/${offers[0]}/grading`, { grading: { grader: "PSA", grade: "9.5", certNumber: "12345678" } });
    expect(graded.json).toMatchObject({ grader: "PSA", grade: "9.5", certNumber: "12345678" });
    expect(graded.json.text.title).toContain("PSA 9.5");
    expect(graded.json.text.description).toContain("Gradée PSA 9.5, certificat n° 12345678");
    expect((await as(id, "PUT", `/api/stock/${offers[0]}/grading`, { grading: { grader: "PSA", grade: "11" } })).status).toBe(400);
    expect((await as(id, "PUT", `/api/stock/${offers[0]}/grading`, { grading: null })).json.grader).toBeNull();
  });

  it("files support requests, marked priority on the Boutique plan", async () => {
    const { id } = await account("solo", 0);
    expect((await as(id, "POST", "/api/support", { subject: "Question", message: "Comment exporter mon stock ?" })).json.priority).toBe(false);
    await as(id, "PUT", "/api/account/plan", { plan: "boutique" });
    expect((await as(id, "POST", "/api/support", { subject: "Urgent", message: "Une annonce est partie au mauvais prix." })).json.priority).toBe(true);
    expect((await as(id, "GET", "/api/support")).json).toMatchObject({ priority: true, requests: [{ subject: "Urgent", priority: true }, { subject: "Question", priority: false }] });
  });
});
