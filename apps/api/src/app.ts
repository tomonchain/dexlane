import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { findCandidates } from "@dexlane/catalog";
import type { Db } from "@dexlane/db";
import {
  activateStock, adjustStock, createAcquisitionLot, createLocation, extractCardFromBulk, getStockItemDetail,
  listAcquisitionLots, listLocations, moveStock, receiveBulk, receiveCard, resolveLocation, searchInventory,
} from "@dexlane/inventory";
import {
  MAX_IMAGE_BYTES, RecognitionError, assertSupportedImage, identifyCard,
  type CardImage, type CardRecognizer, type ImageMediaType,
} from "@dexlane/scan";
import { DomainError } from "@dexlane/shared";
import { HttpError, errorBody, idempotent, parse, parseJsonBody, secretEquals, statusOfDomainError } from "./http";
import * as s from "./schemas";

export interface AppDeps {
  sql: Db;
  /** Jeton du propriétaire (owner unique au MVP) : `Authorization: Bearer <token>`. */
  token: string;
  /** Appelé au premier scan seulement : l'API démarre sans identifiants Claude. */
  recognizer: () => CardRecognizer;
  onError?: (err: unknown) => void;
}

type Env = { Variables: { actor: string } };

const RECOGNITION_STATUS = {
  IMAGE_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, REFUSED: 502, TRUNCATED: 502, UNPARSEABLE: 502,
} as const;

export function createApp(deps: AppDeps) {
  const { sql } = deps;
  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json(errorBody(err.code, err.message, err.details), err.status);
    if (err instanceof DomainError) return c.json(errorBody(err.code, err.message, err.details), statusOfDomainError(err));
    if (err instanceof RecognitionError) return c.json(errorBody(err.code, err.message), RECOGNITION_STATUS[err.code]);
    if (err instanceof HTTPException) return c.json(errorBody("HTTP_ERROR", err.message), err.status);
    (deps.onError ?? console.error)(err);
    return c.json(errorBody("INTERNAL_ERROR", "internal error"), 500);
  });
  app.notFound((c) => c.json(errorBody("NOT_FOUND", "no such route"), 404));

  app.get("/api/health", async (c) => {
    await sql`select 1`;
    return c.json({ status: "ok" });
  });

  app.use("/api/*", async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!presented || !secretEquals(presented, deps.token)) {
      throw new HttpError(401, "UNAUTHORIZED", "missing or invalid bearer token");
    }
    c.set("actor", "owner");
    await next();
  });

  // ───────────────────────── Scan et catalogue ─────────────────────────

  /** Photo → lecture → 3 meilleurs candidats du catalogue + score (Parcours A, étapes 1–2). */
  app.post(
    "/api/scans",
    bodyLimit({
      maxSize: MAX_IMAGE_BYTES + 64 * 1024, // marge pour l'enveloppe multipart
      onError: () => {
        throw new RecognitionError("IMAGE_TOO_LARGE", "image is too large; resize to under 5 MB before scanning");
      },
    }),
    async (c) => {
      const { language } = parse(s.scanQuery, c.req.query());
      const image = await readImage(c);
      const recognizer = guardUpstream(deps.recognizer, deps.onError ?? console.error);
      const r = await identifyCard(sql, recognizer, image, { defaultLanguage: language });
      return c.json({
        requiresReview: r.requiresReview,
        reviewReasons: r.reviewReasons,
        ambiguous: r.match.ambiguous,
        language: r.language,
        reading: r.recognition.reading,
        candidates: r.match.candidates,
        suggestedVariantId: r.suggestedVariantId,
        model: { requested: r.recognition.model, servedBy: r.recognition.servedBy },
        usage: r.recognition.usage,
        latencyMs: r.recognition.latencyMs,
      });
    },
  );

  /** Recherche manuelle dans le catalogue quand le scan se trompe ou échoue. */
  app.get("/api/catalog/cards", async (c) => {
    const q = parse(s.catalogQuery, c.req.query());
    const match = await findCandidates(
      sql,
      { language: q.language, name: q.name, collectorNumber: q.number, setId: q.set?.toLowerCase() },
      { limit: q.limit },
    );
    return c.json({ candidates: match.candidates });
  });

  // ───────────────────────── Emplacements et lots d'acquisition ─────────────────────────

  app.get("/api/locations", async (c) => c.json({ locations: await listLocations(sql, { prefix: c.req.query("prefix") }) }));

  app.post("/api/locations", async (c) => {
    const body = await parseJsonBody(c, s.createLocationBody);
    const location = await createLocation(sql, body);
    return c.json(location, location.created ? 201 : 200);
  });

  app.get("/api/acquisition-lots", async (c) => c.json({ lots: await listAcquisitionLots(sql) }));

  app.post("/api/acquisition-lots", async (c) => {
    const body = await parseJsonBody(c, s.createAcquisitionLotBody);
    return idempotent(c, sql, async (tx) => ({ status: 201, body: await createAcquisitionLot(tx, body) }));
  });

  // ───────────────────────── Inventaire ─────────────────────────

  app.get("/api/inventory", async (c) => {
    const { set, ...q } = parse(s.inventoryQuery, c.req.query());
    return c.json(await searchInventory(sql, { ...q, setId: set }));
  });

  /** Fiche d'une position, par identifiant ou par `unit_sku` (scan du QR). */
  app.get("/api/inventory/:ref", async (c) => {
    const ref = c.req.param("ref");
    const byId = s.stockItemId.safeParse(ref);
    return c.json(await getStockItemDetail(sql, byId.success ? { id: byId.data } : { unitSku: ref }));
  });

  app.post("/api/inventory/receive", async (c) => {
    const body = await parseJsonBody(c, s.receiveCardBody);
    return idempotent(c, sql, async (tx) => ({
      status: 201,
      body: await receiveCard(tx, { ...body, location: s.toLocationRef(body), actor: c.var.actor }),
    }));
  });

  app.post("/api/inventory/bulk", async (c) => {
    const body = await parseJsonBody(c, s.receiveBulkBody);
    return idempotent(c, sql, async (tx) => ({
      status: 201,
      body: await receiveBulk(tx, { ...body, location: s.toLocationRef(body), actor: c.var.actor }),
    }));
  });

  app.post("/api/inventory/:id/extract", async (c) => {
    const bulkStockItemId = parse(s.stockItemId, c.req.param("id"));
    const body = await parseJsonBody(c, s.extractBody);
    return idempotent(c, sql, async (tx) => ({
      status: 201,
      body: await extractCardFromBulk(tx, { ...body, bulkStockItemId, location: s.toLocationRef(body), actor: c.var.actor }),
    }));
  });

  app.post("/api/inventory/:id/adjust", async (c) => {
    const stockItemId = parse(s.stockItemId, c.req.param("id"));
    const body = await parseJsonBody(c, s.adjustBody);
    return idempotent(c, sql, async (tx) => {
      await adjustStock(tx, { ...body, stockItemId, actor: c.var.actor });
      return { status: 200, body: await getStockItemDetail(tx, { id: stockItemId }, { movements: 5 }) };
    });
  });

  // Déplacement et validation sont idempotents par nature : pas de clé exigée.
  app.post("/api/inventory/:id/move", async (c) => {
    const stockItemId = parse(s.stockItemId, c.req.param("id"));
    const body = await parseJsonBody(c, s.moveBody);
    const location = await resolveLocation(sql, s.toLocationRef(body));
    await moveStock(sql, stockItemId, location.id, c.var.actor);
    return c.json(await getStockItemDetail(sql, { id: stockItemId }, { movements: 5 }));
  });

  app.post("/api/inventory/:id/activate", async (c) => {
    const stockItemId = parse(s.stockItemId, c.req.param("id"));
    const before = await getStockItemDetail(sql, { id: stockItemId }, { movements: 0 });
    if (before.lifecycle === "DRAFT") await activateStock(sql, stockItemId, c.var.actor);
    else if (before.lifecycle === "ARCHIVED") throw new DomainError("NOT_DRAFT", "an archived position cannot be activated");
    return c.json(await getStockItemDetail(sql, { id: stockItemId }, { movements: 5 }));
  });

  return app;
}

async function readImage(c: Context): Promise<CardImage> {
  const contentType = (c.req.header("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
  let image: CardImage;
  if (contentType === "multipart/form-data") {
    const file = (await c.req.parseBody())["image"];
    if (!(file instanceof File)) throw new HttpError(400, "IMAGE_REQUIRED", 'multipart upload needs a file field named "image"');
    image = { data: Buffer.from(await file.arrayBuffer()), mediaType: file.type as ImageMediaType };
  } else {
    image = { data: Buffer.from(await c.req.arrayBuffer()), mediaType: contentType as ImageMediaType };
  }
  if (image.data.byteLength === 0) throw new HttpError(400, "IMAGE_REQUIRED", "request body is empty");
  assertSupportedImage(image);
  return image;
}

/** Une panne du fournisseur de vision (identifiants, quota, réseau) devient un 502 explicite, pas un 500 opaque. */
function guardUpstream(factory: () => CardRecognizer, report: (err: unknown) => void): CardRecognizer {
  return {
    async recognize(image) {
      try {
        return await factory().recognize(image);
      } catch (e) {
        if (e instanceof RecognitionError) throw e;
        report(e);
        throw new HttpError(502, "SCAN_UNAVAILABLE", "the card recognition service is unavailable; enter the card manually");
      }
    },
  };
}
