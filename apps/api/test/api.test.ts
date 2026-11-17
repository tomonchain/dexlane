import { beforeEach, describe, expect, it } from "vitest";
import { syncSet, type TcgdexClient } from "@dexlane/catalog";
import { useTestDb } from "@dexlane/db/testing";
import type { CardReadingRaw, CardRecognizer } from "@dexlane/scan";
import { card, fakeClient } from "../../../packages/catalog/test/fixtures";
import { createApp } from "../src/app";

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
  sql, token: TOKEN, recognizer: () => ({ recognize: (image) => recognize(image) }), tcgdex: () => tcgdex,
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
