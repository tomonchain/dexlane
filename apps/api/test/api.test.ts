import { beforeEach, describe, expect, it } from "vitest";
import { syncSet, type TcgdexClient } from "@dexlane/catalog";
import { useTestDb } from "@dexlane/db/testing";
import type { CardReadingRaw, CardRecognizer } from "@dexlane/scan";
import { card, fakeClient } from "../../../packages/catalog/test/fixtures";
import { createApp } from "../src/app";
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
    const blank = { slipPaper: "ROLL_80", seller: { name: "", address: "", legal: "" } };
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

    expect((await call("POST", "/api/publications/run")).json).toEqual({ published: 1, failed: 0 });
    const stock = (await call("GET", "/api/stock")).json.items[0];
    expect([stock.status, stock.planned, stock.offerId]).toEqual(["LISTED", null, received.json.offer.id]);
    expect((await call("POST", "/api/publications/cancel", { body: {} })).json).toEqual({ cancelled: 0 });
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
    expect(json.months.at(-1)).toMatchObject({ cards: 3, revenueCents: 12160 });
    expect(json.previous).toEqual({ orders: 0, cards: 0, revenueCents: 0 });
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

describe("owner password", () => {
  const post = (path: string, body: unknown, headers?: Record<string, string>) => call("POST", `/api/auth/password/${path}`, { body, key: null, headers });

  it("is set with the token, then verified, changed, and invalidates older sessions", async () => {
    expect((await call("GET", "/api/auth/status")).json).toEqual({ passwordSet: false });
    expect((await post("verify", { password: "peu importe" })).json.error.code).toBe("PASSWORD_NOT_SET");
    expect((await post("reset", { newPassword: "court" })).json.error.code).toBe("WEAK_PASSWORD");

    const set = await post("reset", { newPassword: "premier-secret" });
    expect([set.status, set.json]).toEqual([200, { sessionVersion: 1 }]);
    expect((await call("GET", "/api/auth/status")).json).toEqual({ passwordSet: true });
    expect((await post("verify", { password: "premier-secret" })).json).toEqual({ sessionVersion: 1 });

    const wrong = await post("change", { currentPassword: "mauvais", newPassword: "deuxieme-secret" });
    expect([wrong.status, wrong.json.error.code]).toEqual([401, "INVALID_PASSWORD"]);
    expect((await post("change", { currentPassword: "premier-secret", newPassword: "deuxieme-secret" })).json).toEqual({ sessionVersion: 2 });
    expect((await post("verify", { password: "premier-secret" })).status).toBe(401);
    expect((await post("verify", { password: "deuxieme-secret" })).json).toEqual({ sessionVersion: 2 });

    // Une session ouverte avant le changement n'est plus acceptée ; un appel direct par jeton l'est toujours.
    const stale = await call("GET", "/api/inventory", { headers: { "X-Dexlane-Session-Version": "1" } });
    expect([stale.status, stale.json.error.code]).toEqual([401, "SESSION_EXPIRED"]);
    expect((await call("GET", "/api/inventory", { headers: { "X-Dexlane-Session-Version": "2" } })).status).toBe(200);
    expect((await call("GET", "/api/inventory")).status).toBe(200);
    expect(await count("audit_events")).toBe(2);
    const [stored] = await sql<{ passwordHash: string }[]>`select password_hash from owner_credentials`;
    expect(stored!.passwordHash).toMatch(/^scrypt\$/);
    expect(stored!.passwordHash).not.toContain("deuxieme-secret");
  });

  it("locks out after repeated failures, even for the right password, until the delay has passed", async () => {
    await post("reset", { newPassword: "bon-mot-de-passe" });
    for (let i = 0; i < 4; i++) expect((await post("verify", { password: `essai-${i}` })).status).toBe(401);
    const fifth = await post("verify", { password: "essai-5" });
    expect(fifth.json.error).toMatchObject({ code: "INVALID_PASSWORD", details: { retryAfterS: 30 } });

    const locked = await post("verify", { password: "bon-mot-de-passe" });
    expect([locked.status, locked.json.error.code]).toEqual([429, "TOO_MANY_ATTEMPTS"]);
    expect(locked.json.error.details.retryAfterS).toBeGreaterThan(0);

    await sql`update owner_credentials set locked_until = now() - interval '1 second'`;
    expect((await post("verify", { password: "bon-mot-de-passe" })).status).toBe(200);
    expect((await sql`select failed_attempts, locked_until from owner_credentials`)[0]).toEqual({ failedAttempts: 0, lockedUntil: null });

    // Le jeton reste la clé de secours : il réinitialise le mot de passe et lève le verrou.
    for (let i = 0; i < 5; i++) await post("verify", { password: "non" });
    expect((await post("reset", { newPassword: "nouveau-depart" })).status).toBe(200);
    expect((await post("verify", { password: "nouveau-depart" })).status).toBe(200);
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
