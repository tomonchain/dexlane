import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import {
  createTcgdexClient, findCandidates, getSetDetail, listSets, syncSet, syncSetList, type TcgdexClient, refreshOwnedPrices,
} from "@dexlane/catalog";
import type { Db } from "@dexlane/db";
import {
  activateStock, addOfferPhoto, adjustStock, attachPhotos, cancelOrder, deletePhoto, getPhoto, saveListingPhoto, createAcquisitionLot, createDirectSale, createLocation, createLocations,
  deleteLocation, extractCardFromBulk, getInventorySummary, getOrderDetail, getStockItemDetail, listAcquisitionLots,
  listLocations, listOrders, moveStock, packOrder, pickAllocation, receiveBulk, receiveCard, recordPhoto, resolveLocation,
  searchInventory, searchSellableOffers, shipOrder, updateLocationDescription,
} from "@dexlane/inventory";
import {
  estimateVariants, getPricingSettings, listOfferPricing, quoteVariant, refreshOfferPricing, refreshPricing, savePricingSettings, setOfferPrice, getAlertSettings, getDashboard, listPriceMoves, saveAlertSettings,
} from "@dexlane/pricing";
import {
  MAX_IMAGE_BYTES, RecognitionError, assertSupportedImage, identifyCard, type CardImage, type CardRecognizer, type ImageMediaType, addItem, createBatch, findItem, getBatch, listBatches, listItems, receiveBatch, setItemBack, updateBatch, updateItem,
} from "@dexlane/scan";
import { DomainError } from "@dexlane/shared";
import { changePassword, passwordStatus, setPassword, verifyPassword } from "./auth";
import { HttpError, errorBody, idempotent, parse, parseJsonBody, secretEquals, statusOfDomainError } from "./http";
import {
  cancelPublications, endListing, getListingSettings, getSchedule, getStockDetail, listChannels, listStock, planPublications, runDuePublications, listListingOffers, publishListing, saveListingSettings, setChannelMode, simulateOrder,
  syncChannels, syncQuantities, type ChannelAdapters,
} from "@dexlane/listings";
import { readPhoto, type PhotoStore } from "./photos";
import { getAppSettings, saveAppSettings } from "./settings";
import * as s from "./schemas";

export interface AppDeps {
  sql: Db;
  /** Jeton du propriétaire (owner unique au MVP) : `Authorization: Bearer <token>`. */
  token: string;
  /** Appelé au premier scan seulement : l'API démarre sans identifiants Claude. */
  recognizer: () => CardRecognizer;
  /** Stockage des photos ; sans lui, les scans fonctionnent mais aucune image n'est conservée. */
  photos?: PhotoStore | null;
  /** Connecteurs réels des marketplaces (identifiants configurés) ; sans eux, seule la simulation est possible. */
  channels?: ChannelAdapters;
  /** Source du catalogue (TCGdex par défaut) ; remplaçable dans les tests. */
  tcgdex?: () => TcgdexClient;
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
    // Appel relayé par l'application web pour une session navigateur : la session doit dater du mot de passe courant.
    const session = c.req.header("X-Dexlane-Session-Version");
    if (session !== undefined && session !== String(await currentSessionVersion())) {
      throw new HttpError(401, "SESSION_EXPIRED", "this session is no longer valid; sign in again");
    }
    c.set("actor", "owner");
    await next();
    // Après tout changement de stock ou de vente, les quantités annoncées sur les canaux sont réalignées :
    // c'est le garde-fou contre la double vente d'une carte entre deux canaux.
    if (c.req.method !== "GET" && c.res.ok && /^\/api\/(orders|inventory)(\/|$)/.test(c.req.path)) {
      await syncQuantities(sql, deps.channels ?? {}).catch(deps.onError ?? console.error);
    }
  });

  // ───────────────────────── Mot de passe du propriétaire ─────────────────────────
  // Réservé au serveur de l'application web (porteur du jeton) : il vérifie le mot de passe saisi et émet la session.

  let sessionVersionCache: { value: number | null; at: number } | null = null;
  async function currentSessionVersion(): Promise<number | null> {
    if (!sessionVersionCache || Date.now() - sessionVersionCache.at > 10_000) {
      sessionVersionCache = { value: (await passwordStatus(sql)).sessionVersion, at: Date.now() };
    }
    return sessionVersionCache.value;
  }

  app.get("/api/auth/status", async (c) => c.json({ passwordSet: (await passwordStatus(sql)).passwordSet }));

  app.post("/api/auth/password/verify", async (c) => {
    const { password } = await parseJsonBody(c, s.verifyPasswordBody);
    return c.json({ sessionVersion: await verifyPassword(sql, password) });
  });

  /** Définition initiale ou réinitialisation : le jeton d'API fait office de clé de secours. */
  app.post("/api/auth/password/reset", async (c) => {
    const { newPassword } = await parseJsonBody(c, s.resetPasswordBody);
    const sessionVersion = await setPassword(sql, newPassword, "password_reset");
    sessionVersionCache = null;
    return c.json({ sessionVersion });
  });

  app.post("/api/auth/password/change", async (c) => {
    const body = await parseJsonBody(c, s.changePasswordBody);
    const sessionVersion = await changePassword(sql, body.currentPassword, body.newPassword);
    sessionVersionCache = null;
    return c.json({ sessionVersion });
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
      // La photo est conservée en parallèle de la lecture ; un échec de stockage ne fait pas échouer le scan.
      const [r, photo] = await Promise.all([
        identifyCard(sql, recognizer, image, { defaultLanguage: language }),
        storePhoto(image, "SCAN_FRONT"),
      ]);
      return c.json({
        photo,
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

  const FOLDERS = { SCAN_FRONT: "scans", SCAN_BACK: "scans", LISTING: "annonces", BACKGROUND: "fonds", PROMO: "fonds" } as const;

  async function putFile(image: CardImage, kind: keyof typeof FOLDERS) {
    const stored = await deps.photos!.put({ folder: FOLDERS[kind], data: image.data, contentType: image.mediaType });
    return { storageKey: stored.key, url: stored.url, contentType: image.mediaType, byteSize: image.data.byteLength };
  }

  /** Dépose une image dans le stockage et en garde la référence ; null si aucun stockage n'est configuré ou s'il échoue. */
  async function storePhoto(image: CardImage, kind: "SCAN_FRONT" | "SCAN_BACK" | "BACKGROUND" | "PROMO") {
    if (!deps.photos) return null;
    try {
      const row = await recordPhoto(sql, { ...(await putFile(image, kind)), kind });
      return { id: row.id, url: row.url, kind: row.kind };
    } catch (e) {
      (deps.onError ?? console.error)(e);
      return null;
    }
  }

  /**
   * Photo seule, sans lecture : verso d'une carte, fond des visuels d'annonce,
   * ou visuel d'annonce composé à partir d'un scan (`kind=LISTING&source=<scan>`), qui remplace le précédent.
   */
  app.post(
    "/api/photos",
    bodyLimit({
      maxSize: MAX_IMAGE_BYTES + 64 * 1024,
      onError: () => {
        throw new RecognitionError("IMAGE_TOO_LARGE", "image is too large; resize to under 5 MB");
      },
    }),
    async (c) => {
      const { kind, source } = parse(s.photoQuery, c.req.query());
      if (!deps.photos) throw new HttpError(503, "PHOTO_STORAGE_UNAVAILABLE", "no photo storage is configured");
      const image = await readImage(c);
      if (kind === "LISTING") {
        await getPhoto(sql, source!); // 404 avant de déposer un fichier pour rien
        const { photo, replacedUrl } = await saveListingPhoto(sql, source!, await putFile(image, kind));
        if (replacedUrl) await deps.photos.remove(replacedUrl).catch(deps.onError ?? console.error);
        return c.json(photo, 201);
      }
      const photo = await storePhoto(image, kind);
      if (!photo) throw new HttpError(502, "PHOTO_STORAGE_FAILED", "the photo could not be stored");
      return c.json(photo, 201);
    },
  );

  /** Contenu d'une photo, servi depuis la même origine que l'application : le navigateur peut ainsi la retravailler. */
  app.get("/api/photos/:id/content", async (c) => {
    const photo = await getPhoto(sql, parse(s.photoId, c.req.param("id")));
    let file: Awaited<ReturnType<typeof readPhoto>>;
    try {
      file = await readPhoto(photo.url);
    } catch (e) {
      (deps.onError ?? console.error)(e);
      throw new HttpError(502, "PHOTO_STORAGE_FAILED", "the photo could not be read from storage");
    }
    return c.body(new Uint8Array(file.data), 200, { "Content-Type": photo.contentType });
  });

  // ───────────────────────── Annonces ─────────────────────────

  app.get("/api/listings/settings", async (c) => c.json(await getListingSettings(sql)));

  app.put("/api/listings/settings", async (c) => {
    const body = await parseJsonBody(c, s.listingSettingsBody);
    return c.json(await saveListingSettings(sql, body, c.var.actor));
  });

  /** Offres vendables avec le texte de leur annonce et leurs photos. */
  app.get("/api/listings/offers", async (c) => c.json(await listListingOffers(sql, parse(s.listingOffersQuery, c.req.query()))));

  // ───────────────────────── Réglages de l'application ─────────────────────────

  app.get("/api/app-settings", async (c) => c.json(await getAppSettings(sql)));
  app.put("/api/app-settings", async (c) => c.json(await saveAppSettings(sql, await parseJsonBody(c, s.appSettingsBody))));

  // ───────────────────────── Mise en ligne planifiée ─────────────────────────

  app.get("/api/publications", async (c) => c.json(await getSchedule(sql)));

  /** Répartit des offres prêtes sur des jours consécutifs ; sans `offerIds`, toutes les offres prêtes. */
  app.post("/api/publications/plan", async (c) => {
    const body = await parseJsonBody(c, s.planBody);
    return c.json(await planPublications(sql, { ...body, actor: c.var.actor }));
  });

  app.post("/api/publications/cancel", async (c) => c.json({ cancelled: await cancelPublications(sql, await parseJsonBody(c, s.cancelPlanBody)) }));

  /** Publie ce qui est dû aujourd'hui. Lancé chaque jour par la tâche planifiée, et à la demande. */
  app.post("/api/publications/run", async (c) => c.json(await runDuePublications(sql, deps.channels ?? {}, c.var.actor)));

  // ───────────────────────── Sessions de scan ─────────────────────────

  const scanBody = () =>
    bodyLimit({
      maxSize: MAX_IMAGE_BYTES + 64 * 1024,
      onError: () => {
        throw new RecognitionError("IMAGE_TOO_LARGE", "image is too large; resize to under 5 MB");
      },
    });

  app.get("/api/scan-batches", async (c) => c.json({ batches: await listBatches(sql) }));

  app.post("/api/scan-batches", async (c) => {
    const { locationCode, ...body } = await parseJsonBody(c, s.createBatchBody);
    return c.json(await createBatch(sql, { ...body, location: { code: locationCode } }), 201);
  });

  app.get("/api/scan-batches/:id", async (c) => {
    const id = parse(s.batchId, c.req.param("id"));
    return c.json({ batch: await getBatch(sql, id), items: await listItems(sql, id) });
  });

  app.patch("/api/scan-batches/:id", async (c) => {
    const { locationCode, ...body } = await parseJsonBody(c, s.updateBatchBody);
    return c.json(await updateBatch(sql, parse(s.batchId, c.req.param("id")), { ...body, location: locationCode ? { code: locationCode } : undefined }));
  });

  /**
   * Une carte scannée, à son rang dans la pile. L'image est conservée et lue ; si la lecture échoue, la carte est tout de même
   * enregistrée, à identifier à la main. Un rang déjà enregistré est renvoyé tel quel, sans nouvelle lecture.
   */
  app.post("/api/scan-batches/:id/items", scanBody(), async (c) => {
    const batchId = parse(s.batchId, c.req.param("id"));
    const { position, fileName } = parse(s.scanItemQuery, c.req.query());
    const existing = await findItem(sql, batchId, position);
    if (existing) return c.json(existing);
    const batch = await getBatch(sql, batchId);
    const image = await readImage(c);
    const recognizer = guardUpstream(deps.recognizer, deps.onError ?? console.error);
    const [identification, photo] = await Promise.all([
      identifyCard(sql, recognizer, image, { defaultLanguage: batch.language }).catch((e: unknown) => {
        if (!(e instanceof HttpError) && !(e instanceof RecognitionError)) throw e;
        return { error: e.code };
      }),
      storePhoto(image, "SCAN_FRONT"),
    ]);
    return c.json(await addItem(sql, { batchId, position, fileName, frontPhotoId: photo?.id ?? null, identification }), 201);
  });

  /** Verso d'une carte déjà enregistrée. */
  app.post("/api/scan-items/:id/back", scanBody(), async (c) => {
    const itemId = parse(s.scanItemId, c.req.param("id"));
    const photo = await storePhoto(await readImage(c), "SCAN_BACK");
    if (!photo) throw new HttpError(deps.photos ? 502 : 503, deps.photos ? "PHOTO_STORAGE_FAILED" : "PHOTO_STORAGE_UNAVAILABLE", "the photo could not be stored");
    return c.json(await setItemBack(sql, itemId, photo.id));
  });

  app.patch("/api/scan-items/:id", async (c) =>
    c.json(await updateItem(sql, parse(s.scanItemId, c.req.param("id")), await parseJsonBody(c, s.updateScanItemBody))));

  /** Entre tout le lot en stock dans l'ordre du scan, et tarife chaque offre touchée. */
  app.post("/api/scan-batches/:id/receive", async (c) => {
    const id = parse(s.batchId, c.req.param("id"));
    const result = await receiveBatch(sql, id, c.var.actor, (tx, received) => refreshOfferPricing(tx, received.offer.id));
    await syncQuantities(sql, live).catch(deps.onError ?? console.error);
    return c.json({ ...result, batch: await getBatch(sql, id) });
  });

  // ───────────────────────── Stock à vendre ─────────────────────────

  /** Le stock, une ligne par carte à vendre, avec son statut sur le chemin de la vente. */
  app.get("/api/stock", async (c) => c.json(await listStock(sql, parse(s.stockQuery, c.req.query()))));

  /** Photo ajoutée après coup à une carte déjà en stock (entrée sans scan, ou scan à refaire). */
  app.post("/api/stock/:offerId/photos", scanBody(), async (c) => {
    const offerId = parse(s.offerId, c.req.param("offerId"));
    const { kind } = parse(s.offerPhotoQuery, c.req.query());
    if (!deps.photos) throw new HttpError(503, "PHOTO_STORAGE_UNAVAILABLE", "no photo storage is configured");
    await getStockDetail(sql, offerId); // 404 avant de déposer un fichier pour rien
    const image = await readImage(c);
    let file: Awaited<ReturnType<typeof putFile>>;
    try {
      file = await putFile(image, kind);
    } catch (e) {
      (deps.onError ?? console.error)(e);
      throw new HttpError(502, "PHOTO_STORAGE_FAILED", "the photo could not be stored");
    }
    return c.json(await addOfferPhoto(sql, offerId, { ...file, kind }), 201);
  });

  /** Retire une photo d'exemplaire et le visuel d'annonce qui en était tiré. */
  app.delete("/api/photos/:id", async (c) => {
    const urls = await deletePhoto(sql, parse(s.photoId, c.req.param("id")));
    if (deps.photos) await Promise.all(urls.map((url) => deps.photos!.remove(url).catch(deps.onError ?? console.error)));
    return c.json({ ok: true });
  });

  /** Tout ce qui concerne une carte : annonce, photos, positions, historique de cote. */
  app.get("/api/stock/:offerId", async (c) => c.json(await getStockDetail(sql, parse(s.offerId, c.req.param("offerId")))));

  // ───────────────────────── Statistiques et alertes de prix ─────────────────────────

  app.get("/api/stats/dashboard", async (c) => c.json(await getDashboard(sql)));

  /** Variations de cote des cartes en stock ; `alerts=true` : seulement celles qui dépassent les seuils. */
  app.get("/api/stats/price-moves", async (c) => {
    const q = parse(s.priceMovesQuery, c.req.query());
    return c.json(await listPriceMoves(sql, { alertsOnly: q.alerts === "true", limit: q.limit }));
  });

  app.put("/api/stats/alert-settings", async (c) => c.json(await saveAlertSettings(sql, await parseJsonBody(c, s.alertSettingsBody))));
  app.get("/api/stats/alert-settings", async (c) => c.json(await getAlertSettings(sql)));

  /**
   * Relève les cotations du jour pour les cartes en stock, puis réévalue les offres
   * (les prix décidés ne bougent pas, les écarts deviennent des motifs de revue). Lancé chaque jour et à la demande.
   */
  app.post("/api/prices/refresh", async (c) => {
    const refreshed = await refreshOwnedPrices(sql, catalogSource());
    return c.json({ ...refreshed, repriced: refreshed.pricesInserted > 0 ? await refreshPricing(sql) : 0 });
  });

  // ───────────────────────── Canaux de vente ─────────────────────────

  const live = deps.channels ?? {};

  app.get("/api/channels", async (c) => c.json({ channels: await listChannels(sql, live) }));

  app.put("/api/channels/:channel", async (c) => {
    const channel = parse(s.channelId, c.req.param("channel"));
    const { mode } = await parseJsonBody(c, s.channelModeBody);
    await setChannelMode(sql, live, channel, mode, c.var.actor);
    return c.json({ channels: await listChannels(sql, live) });
  });

  /** Commandes des canaux réels, puis quantités annoncées. */
  app.post("/api/channels/sync", async (c) => c.json(await syncChannels(sql, live, c.var.actor)));

  /** Publie l'offre sur le canal, ou met à jour son annonce si elle y est déjà. */
  app.post("/api/listings/offers/:offerId/publish", async (c) => {
    const offerId = parse(s.offerId, c.req.param("offerId"));
    const { channel } = await parseJsonBody(c, s.publishBody);
    return c.json(await publishListing(sql, live, { offerId, channel, actor: c.var.actor }));
  });

  app.post("/api/listings/:id/end", async (c) => {
    await endListing(sql, live, { listingId: parse(s.listingId, c.req.param("id")), actor: c.var.actor });
    return c.json({ ok: true });
  });

  /** Simulation : un acheteur fictif commande sur l'annonce ; la commande suit le circuit normal. */
  app.post("/api/listings/:id/simulate-order", async (c) => {
    const { qty } = await parseJsonBody(c, s.simulateOrderBody);
    const { orderId, oversold } = await simulateOrder(sql, live, { listingId: parse(s.listingId, c.req.param("id")), qty, actor: c.var.actor });
    return c.json({ ...(await getOrderDetail(sql, orderId)), oversold }, 201);
  });

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

  // ───────────────────────── Synchronisation du catalogue ─────────────────────────

  const catalogSource = () => guardCatalogSource((deps.tcgdex ?? createTcgdexClient)(), deps.onError ?? console.error);

  /** Séries connues et leur état : sans série synchronisée, ni le scan ni la recherche ne trouvent de carte. */
  app.get("/api/catalog/sets", async (c) => {
    const { language } = parse(s.languageQuery, c.req.query());
    return c.json({ sets: await listSets(sql, language) });
  });

  /** Contenu importé d'une série : cartes, variantes, prix estimé d'après les ventes, exemplaires en stock. */
  app.get("/api/catalog/sets/:id", async (c) => {
    const setId = parse(s.setId, c.req.param("id"));
    const { language } = parse(s.languageQuery, c.req.query());
    const detail = await getSetDetail(sql, language, setId);
    if (!detail) throw new HttpError(404, "CATALOG_SET_NOT_FOUND", "this set is not known for this language");
    const estimates = await estimateVariants(sql, detail.cards.flatMap((card) => card.variants.map((v) => v.id)));
    return c.json({
      ...detail,
      cards: detail.cards.map((card) => ({ ...card, variants: card.variants.map((v) => ({ ...v, estimate: estimates.get(v.id) ?? null })) })),
    });
  });

  /** Recharge la liste des séries depuis la source (métadonnées seulement). */
  app.post("/api/catalog/sets/refresh", async (c) => {
    const { language } = await parseJsonBody(c, s.languageBody);
    return c.json({ count: await syncSetList(sql, catalogSource(), language) });
  });

  /** Importe les cartes, variantes et cotations d'une série. Rejouable sans doublon ; peut durer plus d'une minute. */
  app.post("/api/catalog/sets/:id/sync", async (c) => {
    const setId = parse(s.setId, c.req.param("id"));
    const { language } = await parseJsonBody(c, s.languageBody);
    const stats = await syncSet(sql, catalogSource(), language, setId);
    // Nouvelles cotations : les offres de cette série sont réévaluées (les prix décidés ne bougent pas, les écarts sont signalés).
    const repriced = await refreshPricing(sql, { setId, language });
    return c.json({ ...stats, errorCount: stats.errors.length, errors: stats.errors.slice(0, 20), repriced });
  });

  // ───────────────────────── Prix et catégories ─────────────────────────

  /** Tarifie l'offre touchée par une entrée en stock, dans la même transaction, et joint le résultat à la réponse. */
  async function withPricing<T extends { offer: { id: string }; stockItem: { id: string } }>(tx: Db, received: T, photoIds: string[] = []) {
    await attachPhotos(tx, photoIds, { stockItemId: received.stockItem.id, offerId: received.offer.id });
    await refreshOfferPricing(tx, received.offer.id);
    const { items } = await listOfferPricing(tx, { offerId: received.offer.id, includeEmpty: true });
    return { ...received, pricing: items[0] ?? null };
  }

  app.get("/api/pricing/settings", async (c) => c.json(await getPricingSettings(sql)));

  /** Nouvelles règles : appliquées immédiatement à toutes les offres. */
  app.put("/api/pricing/settings", async (c) => {
    const body = await parseJsonBody(c, s.pricingSettingsBody);
    return c.json(await savePricingSettings(sql, body, c.var.actor));
  });

  /** Estimation pour une variante et un état, avant l'entrée en stock (Parcours A, étape 4). */
  app.get("/api/pricing/variants/:id", async (c) => {
    const variantId = parse(s.variantId, c.req.param("id"));
    const q = parse(s.variantQuoteQuery, c.req.query());
    return c.json(await quoteVariant(sql, variantId, q.condition, q.unique === "true"));
  });

  /** Offres et leurs prix, triées par enjeu ; `status=REVIEW` : la file de revue. */
  app.get("/api/pricing/offers", async (c) => c.json(await listOfferPricing(sql, parse(s.pricingOffersQuery, c.req.query()))));

  /** Décision de prix et de catégorie ; les règles n'y toucheront plus, elles signaleront seulement un écart. */
  app.post("/api/pricing/offers/:id/price", async (c) => {
    const offerId = parse(s.offerId, c.req.param("id"));
    const body = await parseJsonBody(c, s.setOfferPriceBody);
    return c.json(await setOfferPrice(sql, { ...body, offerId, actor: c.var.actor }));
  });

  app.post("/api/pricing/recompute", async (c) => c.json({ repriced: await refreshPricing(sql) }));

  // ───────────────────────── Ventes ─────────────────────────

  /** Offres disponibles à la vente, pour composer une vente directe. */
  app.get("/api/offers/sellable", async (c) => c.json({ offers: await searchSellableOffers(sql, parse(s.sellableQuery, c.req.query())) }));

  app.get("/api/orders", async (c) => c.json(await listOrders(sql, parse(s.ordersQuery, c.req.query()))));

  /** Vente directe : les cartes sont réservées dans la même transaction, ou la vente est refusée. */
  app.post("/api/orders", async (c) => {
    const body = await parseJsonBody(c, s.createSaleBody);
    return idempotent(c, sql, async (tx) => {
      const { orderId } = await createDirectSale(tx, { ...body, actor: c.var.actor });
      return { status: 201, body: await getOrderDetail(tx, orderId) };
    });
  });

  app.get("/api/orders/:id", async (c) => c.json(await getOrderDetail(sql, parse(s.orderId, c.req.param("id")))));

  /** Prélèvement confirmé par le code de la position : le mauvais article est refusé. */
  app.post("/api/orders/:id/pick", async (c) => {
    const orderId = parse(s.orderId, c.req.param("id"));
    const body = await parseJsonBody(c, s.pickBody);
    const order = await getOrderDetail(sql, orderId);
    if (!order.lines.some((l) => l.allocations.some((a) => a.id === body.allocationId))) {
      throw new HttpError(404, "ALLOCATION_NOT_FOUND", "this allocation does not belong to the order");
    }
    await pickAllocation(sql, { allocationId: body.allocationId, scannedUnitSku: normalizeUnitSku(body.unitSku), actor: c.var.actor });
    return c.json(await getOrderDetail(sql, orderId));
  });

  app.post("/api/orders/:id/pack", async (c) => {
    const orderId = parse(s.orderId, c.req.param("id"));
    await packOrder(sql, orderId, c.var.actor);
    return c.json(await getOrderDetail(sql, orderId));
  });

  /** Dépôt (poste, point relais) ou remise en main propre : les cartes quittent le stock. Rejouable sans effet. */
  app.post("/api/orders/:id/handover", async (c) => {
    const orderId = parse(s.orderId, c.req.param("id"));
    const body = await parseJsonBody(c, s.handoverBody);
    await shipOrder(sql, { ...body, orderId, actor: c.var.actor });
    return c.json(await getOrderDetail(sql, orderId));
  });

  app.post("/api/orders/:id/cancel", async (c) => {
    const orderId = parse(s.orderId, c.req.param("id"));
    const { reason } = await parseJsonBody(c, s.cancelOrderBody);
    await cancelOrder(sql, orderId, c.var.actor, reason);
    return c.json(await getOrderDetail(sql, orderId));
  });

  // ───────────────────────── Emplacements et lots d'acquisition ─────────────────────────

  app.get("/api/locations", async (c) => c.json({ locations: await listLocations(sql, { prefix: c.req.query("prefix") }) }));

  app.post("/api/locations", async (c) => {
    const body = await parseJsonBody(c, s.createLocationBody);
    const location = await createLocation(sql, body);
    return c.json(location, location.created ? 201 : 200);
  });

  /** Plusieurs emplacements d'un coup (les rangées d'une boîte, par exemple). */
  app.post("/api/locations/batch", async (c) => {
    const { codes } = await parseJsonBody(c, s.createLocationsBody);
    const result = await createLocations(sql, codes);
    return c.json(result, result.created.length ? 201 : 200);
  });

  app.patch("/api/locations/:id", async (c) => {
    const id = parse(s.locationId, c.req.param("id"));
    const { description } = await parseJsonBody(c, s.updateLocationBody);
    return c.json(await updateLocationDescription(sql, id, description));
  });

  /** Seulement pour un emplacement créé par erreur : vide, sans sous-emplacement, jamais utilisé. */
  app.delete("/api/locations/:id", async (c) => c.json(await deleteLocation(sql, parse(s.locationId, c.req.param("id")))));

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

  // Déclarée avant la route paramétrée, qui prendrait « summary » pour un identifiant.
  app.get("/api/inventory/summary", async (c) => c.json(await getInventorySummary(sql)));

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
      body: await withPricing(tx, await receiveCard(tx, { ...body, location: s.toLocationRef(body), actor: c.var.actor }), body.photoIds),
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
      body: await withPricing(tx, await extractCardFromBulk(tx, { ...body, bulkStockItemId, location: s.toLocationRef(body), actor: c.var.actor }), body.photoIds),
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

/** Série inconnue ou source injoignable : erreur explicite au lieu d'un 500. Les échecs carte par carte restent dans le rapport. */
function guardCatalogSource(client: TcgdexClient, report: (err: unknown) => void): TcgdexClient {
  const guard = async <T>(call: Promise<T>): Promise<T> => {
    try {
      return await call;
    } catch (e) {
      if (e instanceof Error && /HTTP 404/.test(e.message)) {
        throw new HttpError(404, "CATALOG_SET_NOT_FOUND", "this set does not exist in the catalog source for this language");
      }
      report(e);
      throw new HttpError(502, "CATALOG_SOURCE_UNAVAILABLE", "the catalog source (TCGdex) is unavailable; try again later");
    }
  };
  return {
    listSets: (language) => guard(client.listSets(language)),
    getSet: (language, id) => guard(client.getSet(language, id)),
    getCard: client.getCard,
    listSeries: client.listSeries,
    getSerie: client.getSerie,
  };
}

/** « 123 », « si-123 » ou « SI-000123 » → « SI-000123 » : au picking on tape le numéro, pas le préfixe. */
function normalizeUnitSku(input: string): string {
  const text = input.trim().toUpperCase();
  const digits = /^(?:SI-?)?(\d{1,9})$/.exec(text);
  return digits ? `SI-${digits[1]!.padStart(6, "0")}` : text;
}
