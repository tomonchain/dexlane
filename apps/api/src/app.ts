import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import {
  createTcgdexClient, findCandidates, getSetDetail, getPublicCard, getPublicSet, listPublicCardsForSitemap, listPublicSets, setSetCode, catalogImportStatus, importNextSets, listSets, syncSet, syncSetList, type TcgdexClient, refreshTrackedPrices, searchCatalog,
} from "@dexlane/catalog";
import { OWNER_ACCOUNT_ID, withAccount, withTx, type Db } from "@dexlane/db";
import {
  activateStock, addOfferPhoto, adjustStock, attachPhotos, cancelOrder, deletePhoto, getPhoto, saveListingPhoto, createAcquisitionLot, createDirectSale, createLocation, createLocations,
  deleteLocation, extractCardFromBulk, getInventorySummary, getOrderDetail, getShippingCosts, saveShippingCosts, listPreparation, markSlipsPrinted, getStockItemDetail, listAcquisitionLots,
  listLocations, listOrders, moveStock, packOrder, pickAllocation, receiveBulk, receiveCard, recordPhoto, resolveLocation,
  searchInventory, searchSellableOffers, shipOrder, updateLocationDescription,
  createLot, dissolveLot, listLots,
  stockSupplyCosts, stockSuppliesSummary, shipmentsToTrack, recordTracking, markDelivered, updateTracking, markReviewRequested, takeReviewReminders, type Carrier, archiveSupply, countSupply, createSupply, getSupply, listSupplies, markSupplyOrdered, receiveSupply, takeSupplyAlerts, updateSupply, listStockMovements,
} from "@dexlane/inventory";
import {
  estimateVariants, findDeals, listWatched, platformPrices, trendingCards, unwatchCard, updateWatched, watchCard, getPricingSettings, priceHistory, listOfferPricing, quoteVariant, refreshOfferPricing, refreshPricing, savePricingSettings, setOfferPrice, getAlertSettings, getDashboard, listPriceMoves, saveAlertSettings, salesInsights,
} from "@dexlane/pricing";
import {
  MAX_IMAGE_BYTES, RecognitionError, assertSupportedImage, identifyCard, type CardImage, type CardRecognizer, type ImageMediaType, addItem, createBatch, findItem, getBatch, listBatches, listItems, receiveBatch, receiveReady, setItemBack, updateBatch, updateItem,
} from "@dexlane/scan";
import { DomainError } from "@dexlane/shared";
import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { AGENT_TOKEN_PREFIX, createAgentToken, listAgentTokens, revokeAgentToken, verifyAgentToken } from "./agents";
import { activeAccountIds, createAuth, ownerExists, publicBaseUrl, setupOwner, type Auth } from "./better-auth";
import { mailerFromEnv, type Mailer } from "./mailer";
import { registerAccountRoutes } from "./account";
import { evaluateAfterChange, hostedPerkHooks, registerInsightsRoutes } from "./insights";
import { runForAccount, scopedDb } from "./scope";
import { createMcpServer, type InternalCall } from "./mcp";
import { trackingFromEnv, type TrackingAdapters } from "./tracking";
import { HttpError, errorBody, idempotent, parse, parseJsonBody, secretEquals, statusOfDomainError } from "./http";
import {
  cancelPublications, getPublicationCalendar, getPublicationDay, reschedulePublication, endListing, getActivity, getCardDetail, getListingSettings, getSchedule, getStockDetail, listChannels, listStock, stockFacets, planPublications, queuePublications, runDuePublications, listListingOffers, publishListing, saveListingSettings, setChannelMode, simulateOrder,
  syncChannels, syncPrices, syncQuantities, stockSuggestions, hasFeature, requireFeature, takeQuotaAlert, reserveScan, recordScanCost, type ChannelAdapters,
  EBAY_MARKETPLACES, createEbayDefaults, ebayAccountOptions, ebayAdapter, ebayClientFromEnv, ebayShippingServices, getEbaySettings, missingEbaySettings,
  saveEbaySettings, type EbayClient,
} from "@dexlane/listings";
import type { Env } from "./env";
import { readPhoto, type PhotoStore } from "./photos";
import { getAppSettings, saveAppSettings } from "./settings";
import {
  broadcast, countSubscriptions, quotaMessage, removeSubscription, reviewsMessage, saveSubscription, sendDigest, suppliesMessage, testMessage, vapidKeys, webPushSender, type PushSender,
} from "./notifications";
import * as s from "./schemas";
import type { PerkHooks } from "@dexlane/insights";

export interface AppDeps {
  sql: Db;
  /** Jeton du propriétaire (owner unique au MVP) : `Authorization: Bearer <token>`. */
  token: string;
  /** Appelé au premier scan seulement : l'API démarre sans identifiants Claude. */
  recognizer: () => CardRecognizer;
  /** Stockage des photos ; sans lui, les scans fonctionnent mais aucune image n'est conservée. */
  photos?: PhotoStore | null;
  /**
   * Connecteurs réels des marketplaces ; par défaut, ceux dont les identifiants sont dans l'environnement (eBay).
   * Sans eux, seule la simulation est possible.
   */
  channels?: ChannelAdapters;
  /** Client eBay (connexion du compte, règles de vente) ; par défaut d'après l'environnement, null pour s'en passer. */
  ebay?: EbayClient | null;
  /** Source du catalogue (TCGdex par défaut) ; remplaçable dans les tests. */
  tcgdex?: () => TcgdexClient;
  /** Envoi des notifications sur le téléphone (Web Push par défaut) ; remplaçable dans les tests. */
  push?: PushSender;
  /** Suivi des colis chez les transporteurs (d'après l'environnement par défaut) ; remplaçable dans les tests. */
  tracking?: TrackingAdapters;
  /** Connexion à la base pour BetterAuth (`DATABASE_URL` par défaut) et adresse publique du site (liens des e-mails). */
  databaseUrl?: string;
  baseUrl?: string;
  /** Envoi des e-mails (Resend d'après l'environnement par défaut) ; `null` : aucun envoi possible. Remplaçable dans les tests. */
  mailer?: Mailer | null;
  /** Avantages de niveau propres à la version hébergée (bonus de cartes par le quota) ; par défaut, ceux du quota. */
  perkHooks?: PerkHooks;
  onError?: (err: unknown) => void;
}


const RECOGNITION_STATUS = {
  IMAGE_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, REFUSED: 502, TRUNCATED: 502, UNPARSEABLE: 502,
} as const;

export function createApp(deps: AppDeps) {
  // `root` s'adresse à la base sans cloisonnement (authentification, catalogue commun) ; `sql` suit le compte de la
  // requête en cours : c'est lui que les routes et le cœur métier utilisent.
  const root = deps.sql;
  const sql = scopedDb(root);
  const app = new Hono<Env>();
  const ebay = deps.ebay !== undefined ? deps.ebay : ebayClientFromEnv(sql, process.env);
  const live: ChannelAdapters = deps.channels ?? (ebay ? { ebay: ebayAdapter(sql, ebay) } : {});
  const perkHooks = deps.perkHooks ?? hostedPerkHooks;

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json(errorBody(err.code, err.message, err.details), err.status);
    if (err instanceof DomainError) return c.json(errorBody(err.code, err.message, err.details), statusOfDomainError(err));
    if (err instanceof RecognitionError) return c.json(errorBody(err.code, err.message), RECOGNITION_STATUS[err.code]);
    if (err instanceof HTTPException) return c.json(errorBody("HTTP_ERROR", err.message), err.status);
    (deps.onError ?? console.error)(err);
    if (isConnectionError(err)) return c.json(errorBody("DATABASE_UNAVAILABLE", "the database did not answer; try again"), 503);
    return c.json(errorBody("INTERNAL_ERROR", "internal error"), 500);
  });
  app.notFound((c) => c.json(errorBody("NOT_FOUND", "no such route"), 404));

  app.get("/api/health", async (c) => {
    await sql`select 1`;
    return c.json({ status: "ok" });
  });

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  /** Routes qui travaillent hors de tout compte : installation, liste des comptes, import du catalogue commun (long). */
  const unscoped = (path: string) =>
    path.startsWith("/api/setup/") || path === "/api/accounts/active" || path.startsWith("/api/catalog/import") || path.startsWith("/api/public/") ||
    // L'effacement d'un compte se fait hors de sa transaction cloisonnée : il supprime le compte lui-même.
    path === "/api/account/delete";

  const mailer = (): Mailer => {
    const configured = deps.mailer === undefined ? mailerFromEnv() : deps.mailer;
    if (!configured) throw new HttpError(503, "EMAIL_NOT_CONFIGURED", "email sending is not configured (RESEND_API_KEY, EMAIL_FROM)");
    return configured;
  };
  // Comptes et sessions : BetterAuth, créé à la première requête qui en a besoin.
  let authInstance: Auth | undefined;
  const auth = (): Auth => {
    const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL;
    if (!databaseUrl) throw new HttpError(500, "SERVER_MISCONFIGURED", "DATABASE_URL is not set");
    return (authInstance ??= createAuth({ sql: root, databaseUrl, baseUrl: deps.baseUrl ?? publicBaseUrl(), token: deps.token, mailer }));
  };

  app.use("/api/*", async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    // Un jeton d'agent n'ouvre que le serveur MCP, pour le compte qui l'a créé ; tout le reste de l'API demande le
    // jeton du serveur.
    const agent = c.req.path === "/api/mcp" && presented.startsWith(AGENT_TOKEN_PREFIX) ? await verifyAgentToken(root, presented) : null;
    if (agent) {
      c.set("actor", `agent:${agent.name}`);
      c.set("accountId", agent.accountId);
      return next();
    }
    if (!presented || !secretEquals(presented, deps.token)) {
      throw new HttpError(401, "UNAUTHORIZED", "missing or invalid bearer token");
    }
    // Connexion, inscription, vérification de l'adresse, mot de passe, administration : les routes de BetterAuth.
    if (c.req.path.startsWith("/api/auth/")) return auth().handler(c.req.raw);

    let accountId: string;
    if (c.req.header("X-Dexlane-Browser") === "1") {
      // Requête relayée pour un navigateur : c'est sa session qui dit pour quel compte il travaille.
      const session = await auth().api.getSession({ headers: c.req.raw.headers });
      const user = session?.user as { id: string; name: string; accountId?: string | null; email: string; role?: string | null; plan?: string | null } | undefined;
      if (!user?.accountId) {
        if (unscoped(c.req.path) && c.req.path === "/api/setup/status") return next();
        throw new HttpError(401, "SESSION_EXPIRED", "this session is no longer valid; sign in again");
      }
      accountId = user.accountId;
      c.set("user", { id: user.id, name: user.name, email: user.email, role: user.role ?? "user", plan: user.plan ?? null });
    } else {
      // Scripts, tâches planifiées et outils internes désignent le compte ; sans lui, c'est le compte d'installation.
      accountId = c.req.header("X-Dexlane-Account") ?? OWNER_ACCOUNT_ID;
    }
    if (!UUID.test(accountId)) throw new HttpError(400, "INVALID_ACCOUNT", "invalid account id");
    // Les outils MCP rappellent l'API avec le jeton du serveur, au nom de l'agent (journal des actions).
    const onBehalf = c.req.header("X-Dexlane-Agent");
    c.set("actor", onBehalf && /^agent:[^\n]{1,60}$/.test(onBehalf) ? onBehalf : "owner");
    c.set("accountId", accountId);
    // Le serveur MCP ne touche pas aux données lui-même : ses outils rappellent l'API, chacun dans sa propre portée.
    if (unscoped(c.req.path) || c.req.path === "/api/mcp") return next();

    // Tout le reste s'exécute pour ce compte, dans une transaction où Postgres cloisonne ses données.
    await runForAccount(root, accountId, async () => {
      await next();
      // Après tout changement de stock ou de vente, les quantités annoncées sur les canaux sont réalignées :
      // c'est le garde-fou contre la double vente d'une carte entre deux canaux.
      if (c.req.method !== "GET" && c.res.ok && /^\/api\/(orders|inventory)(\/|$)/.test(c.req.path)) {
        await withTx(sql, () => syncQuantities(sql, live)).catch(deps.onError ?? console.error);
      }
      // Un prix décidé (à l'unité, en masse, celui d'un lot) part sur les annonces en ligne : synchronisation des prix.
      if (c.req.method !== "GET" && c.res.ok && /^\/api\/(pricing\/offers|stock|lots)(\/|$)/.test(c.req.path)) {
        await withTx(sql, () => syncPrices(sql, live, c.var.actor)).catch(deps.onError ?? console.error);
      }
      // Une publication peut franchir 80 % puis 100 % du quota du mois : l'alerte part une fois par seuil.
      if (c.req.method === "POST" && c.res.ok && /^\/api\/(listings\/offers\/[^/]+\/publish|publications\/run|scan-batches\/[^/]+\/autopilot)$/.test(c.req.path)) {
        await withTx(sql, async () => {
          const alert = await takeQuotaAlert(sql);
          if (alert && alert.state.limit !== null) await broadcast(sql, push, (locale) => quotaMessage(alert.level, alert.state.used, alert.state.limit!, locale));
        }).catch(deps.onError ?? console.error);
      }
      // Une publication, une vente ou un rangement peut débloquer un succès : la progression est réévaluée aussitôt
      // (la nuit, la tâche quotidienne rattrape le reste, dont les ventes qui arrivent au bout du délai de confirmation).
      if (c.req.method !== "GET" && c.res.ok && /^\/api\/(orders|inventory|listings|publications|channels|scan-batches|lots)(\/|$)/.test(c.req.path)) {
        await evaluateAfterChange(sql, perkHooks).catch(deps.onError ?? console.error);
      }
      // Un envoi remis ou un stock corrigé peut faire passer une fourniture sous son seuil : l'alerte part aussitôt.
      if (c.req.method !== "GET" && c.res.ok && /^\/api\/(orders|supplies|channels)(\/|$)/.test(c.req.path)) {
        await withTx(sql, () => alertLowSupplies()).catch(deps.onError ?? console.error);
      }
      // Une requête SQL en échec hors d'une sous-transaction annule toute la transaction : la réponse ne doit alors
      // pas annoncer un succès.
      if (c.res.ok) {
        await sql`select 1`.catch((err: unknown) => {
          (deps.onError ?? console.error)(err);
          c.res = c.json(errorBody("INTERNAL_ERROR", "internal error"), 500);
        });
      }
    });
  });

  // ───────────────────────── Installation et comptes ─────────────────────────

  /** L'installation a-t-elle son propriétaire ? Sinon, l'assistant de démarrage le crée avec le jeton d'installation. */
  app.get("/api/setup/status", async (c) => c.json({ passwordSet: await ownerExists(root) }));

  /**
   * Première connexion, ou clé de secours : le porteur du jeton d'installation (vérifié par le serveur web) choisit
   * l'adresse e-mail et le mot de passe du propriétaire.
   */
  app.post("/api/setup/owner", async (c) => {
    if (c.req.header("X-Dexlane-Browser") === "1") throw new HttpError(403, "FORBIDDEN", "setup is reserved to the server");
    const body = await parseJsonBody(c, s.setupOwnerBody);
    await setupOwner(auth(), root, body);
    return c.json({ ok: true });
  });

  /** Les comptes pour lesquels les tâches planifiées tournent. */
  app.get("/api/accounts/active", async (c) => {
    if (c.req.header("X-Dexlane-Browser") === "1") throw new HttpError(403, "FORBIDDEN", "reserved to the server");
    return c.json({ accountIds: await activeAccountIds(root) });
  });

  // Forfait, quota, équipe et support (account.ts).
  registerAccountRoutes(app, {
    root, sql, mailer, baseUrl: () => deps.baseUrl ?? publicBaseUrl(), supportEmail: process.env.SUPPORT_EMAIL ?? null,
    onError: deps.onError ?? console.error,
    verifyPassword: async (userId, password) => {
      const [credential] = await root<{ password: string | null }[]>`
        select password from auth_credentials where "userId" = ${userId} and "providerId" = 'credential'`;
      if (!credential?.password) return false;
      const ctx = await auth().$context;
      return ctx.password.verify({ hash: credential.password, password });
    },
    removePhoto: deps.photos ? (url) => deps.photos!.remove(url) : null,
  });

  // Statistiques, démarrage, récaps, niveau et succès (insights.ts).
  registerInsightsRoutes(app, {
    root, sql, live, token: deps.token, perkHooks, baseUrl: () => deps.baseUrl ?? publicBaseUrl(),
    mailer: () => (deps.mailer === undefined ? mailerFromEnv() : deps.mailer),
    onError: deps.onError ?? console.error,
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
      // Le scan est réservé d'abord : refusé (quota, débit), rien n'est lu ni stocké.
      const recognizer = await meteredRecognizer(root, c.var.accountId, guardUpstream(deps.recognizer, deps.onError ?? console.error), "single");
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

  const FOLDERS = { SCAN_FRONT: "scans", SCAN_BACK: "scans", LISTING: "annonces", BACKGROUND: "fonds", PROMO: "fonds", LOGO: "fonds" } as const;

  async function putFile(image: CardImage, kind: keyof typeof FOLDERS) {
    const stored = await deps.photos!.put({ folder: FOLDERS[kind], data: image.data, contentType: image.mediaType });
    return { storageKey: stored.key, url: stored.url, contentType: image.mediaType, byteSize: image.data.byteLength };
  }

  /** Dépose une image dans le stockage et en garde la référence ; null si aucun stockage n'est configuré ou s'il échoue. */
  async function storePhoto(image: CardImage, kind: "SCAN_FRONT" | "SCAN_BACK" | "BACKGROUND" | "PROMO" | "LOGO") {
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

  // ───────────────────────── Notifications sur le téléphone ─────────────────────────

  const push = deps.push ?? webPushSender;
  /** Clé publique pour abonner un appareil, nombre d'appareils abonnés, et ce qui est notifié. */
  app.get("/api/notifications", async (c) => c.json({
    publicKey: (await vapidKeys(sql)).publicKey,
    devices: await countSubscriptions(sql),
    preferences: (await getAppSettings(sql)).notifications,
  }));
  app.post("/api/notifications/subscriptions", async (c) => {
    const body = await parseJsonBody(c, s.pushSubscriptionBody);
    await saveSubscription(sql, { ...body, userAgent: c.req.header("User-Agent")?.slice(0, 300) });
    return c.json({ devices: await countSubscriptions(sql) }, 201);
  });
  app.post("/api/notifications/subscriptions/remove", async (c) => {
    await removeSubscription(sql, (await parseJsonBody(c, s.pushEndpointBody)).endpoint);
    return c.json({ devices: await countSubscriptions(sql) });
  });
  /** Fournitures passées sous leur seuil : une notification par passage sous le seuil, si l'alerte est activée. */
  async function alertLowSupplies() {
    if (!(await getAppSettings(sql)).notifications.supplies) return;
    const low = await takeSupplyAlerts(sql);
    if (low.length > 0) await broadcast(sql, push, (locale) => suppliesMessage(low, locale));
  }
  /** Une notification d'essai sur chaque appareil abonné. */
  app.post("/api/notifications/test", async (c) => c.json(await broadcast(sql, push, testMessage)));
  /** Résumé du matin (tâche quotidienne, après la synchronisation des canaux) : envoyé s'il y a du nouveau. */
  app.post("/api/notifications/digest", async (c) => c.json(await sendDigest(sql, push, (await getAppSettings(sql)).notifications)));

  // ───────────────────────── Mise en ligne planifiée ─────────────────────────

  app.get("/api/publications", async (c) => c.json(await getSchedule(sql)));

  /** Répartit des offres prêtes sur des jours consécutifs ; sans `offerIds`, toutes les offres prêtes. */
  app.post("/api/publications/plan", async (c) => {
    const body = await parseJsonBody(c, s.planBody);
    return c.json(await planPublications(sql, { ...body, actor: c.var.actor }));
  });

  /** Calendrier des mises en ligne : prévues, publiées et en échec, jour par jour (`from` et `to` inclus, 93 jours au plus). */
  app.get("/api/publications/calendar", async (c) => {
    const { from, to } = parse(s.calendarQuery, c.req.query());
    return c.json(await getPublicationCalendar(sql, from, to));
  });
  /** Un jour du calendrier, carte par carte. */
  app.get("/api/publications/day/:date", async (c) => c.json(await getPublicationDay(sql, parse(s.calendarDate, c.req.param("date")))));
  /** Déplace une publication à un autre jour (ou replanifie une publication en échec). */
  app.patch("/api/publications/:id", async (c) => {
    const id = parse(s.publicationId, c.req.param("id"));
    await reschedulePublication(sql, id, (await parseJsonBody(c, s.rescheduleBody)).plannedOn);
    return c.json({ ok: true });
  });

  app.post("/api/publications/cancel", async (c) => c.json({ cancelled: await cancelPublications(sql, await parseJsonBody(c, s.cancelPlanBody)) }));

  /** Publie ce qui est dû aujourd'hui. Lancé chaque jour par la tâche planifiée, et à la demande. */
  app.post("/api/publications/run", async (c) => c.json(await runDuePublications(sql, live, c.var.actor)));

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
    // Quota de scans atteint : la carte est tout de même enregistrée avec sa photo, à identifier à la main.
    const recognizer = await meteredRecognizer(root, c.var.accountId, guardUpstream(deps.recognizer, deps.onError ?? console.error), "batch")
      .catch((e: unknown) => {
        if (e instanceof DomainError && (e.code === "SCAN_QUOTA_EXCEEDED" || e.code === "SCAN_RATE_LIMITED")) return { error: e.code };
        throw e;
      });
    const [identification, photo] = await Promise.all([
      "error" in recognizer
        ? recognizer
        : identifyCard(sql, recognizer, image, { defaultLanguage: batch.language }).catch((e: unknown) => {
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

  /**
   * Pilote automatique : entre en stock les cartes complètes du lot, pose leur prix et les met en file de mise en ligne
   * sur chaque canal actif, selon le réglage du lot. Les cartes à vérifier attendent, sans bloquer les autres.
   * Rejouable à volonté : ce qui est déjà entré n'est pas repris.
   */
  app.post("/api/scan-batches/:id/autopilot", async (c) => {
    const id = parse(s.batchId, c.req.param("id"));
    const batch = await getBatch(sql, id);
    if (!batch.autopilot) throw new HttpError(409, "AUTOPILOT_OFF", "the autopilot is switched off for this batch");
    const { received } = await receiveReady(sql, id, c.var.actor, (tx, position) => refreshOfferPricing(tx, position.offer.id));
    const offerIds = [...new Set(received.map((r) => r.offer.id))];
    let queued = 0;
    // Mettre le lot en file d'un coup, c'est la publication en masse : sans elle, les cartes entrent en stock et attendent.
    const bulk = await hasFeature(sql, "bulk");
    if (batch.publishMode !== "NONE" && offerIds.length > 0 && (bulk || offerIds.length === 1)) {
      for (const channel of (await listChannels(sql, live)).filter((ch) => ch.mode !== "OFF")) {
        queued += (await queuePublications(sql, { offerIds, channel: channel.id, perDay: batch.publishMode === "DAILY" ? batch.publishPerDay : null, actor: c.var.actor })).queued;
      }
    }
    if (received.length > 0) await syncQuantities(sql, live).catch(deps.onError ?? console.error);
    return c.json({ received: received.length, offerIds, queued, bulkRequired: !bulk && batch.publishMode !== "NONE" && offerIds.length > 1, batch: await getBatch(sql, id) });
  });

  // ───────────────────────── Stock à vendre ─────────────────────────

  /** Le stock, une ligne par carte à vendre, avec son statut sur le chemin de la vente. */
  app.get("/api/stock", async (c) => c.json(await listStock(sql, parse(s.stockQuery, c.req.query()))));

  /** Valeurs proposées par les filtres du stock : séries, boîtes et états présents. */
  app.get("/api/stock/facets", async (c) => c.json(await stockFacets(sql)));

  /**
   * Actions groupées sur la sélection du stock. Chaque carte passe par la même règle qu'à l'unité ; celles que l'action
   * ne concerne pas (déjà tarifée, déjà validée, déjà dans la boîte) sont laissées telles quelles.
   */
  app.post("/api/stock/bulk", async (c) => {
    const body = await parseJsonBody(c, s.stockBulkBody);
    const actor = c.var.actor;
    if (body.action === "ACCEPT_PRICE") {
      const offers = await sql<{ id: string; suggestedPriceCents: number }[]>`
        select id, suggested_price_cents from offers
         where id in ${sql(body.offerIds)} and target_price_cents is null and suggested_price_cents is not null`;
      for (const o of offers) await setOfferPrice(sql, { offerId: o.id, targetPriceCents: o.suggestedPriceCents, actor });
      return c.json({ affected: offers.length });
    }
    if (body.action === "ACTIVATE") {
      const items = await sql<{ id: string }[]>`
        select id from stock_items where offer_id in ${sql(body.offerIds)} and lifecycle = 'DRAFT' and on_hand > 0 order by created_at`;
      for (const item of items) await activateStock(sql, item.id, actor);
      return c.json({ affected: items.length });
    }
    const location = await resolveLocation(sql, s.toLocationRef(body));
    const items = await sql<{ id: string }[]>`
      select id from stock_items
       where offer_id in ${sql(body.offerIds)} and lifecycle <> 'ARCHIVED' and on_hand > 0 and location_id <> ${location.id}
       order by created_at`;
    for (const item of items) await moveStock(sql, item.id, location.id, actor);
    return c.json({ affected: items.length });
  });

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

  /** Suggestions de titre et de prix (forfaits Pro et Boutique). */
  app.get("/api/stock/:offerId/suggestions", async (c) => {
    await requireFeature(sql, "suggestions", "suggestions de titre et de prix");
    return c.json(await stockSuggestions(sql, parse(s.offerId, c.req.param("offerId"))));
  });

  /** Titre choisi pour cette carte (une suggestion appliquée) ; null : retour au modèle de titre. */
  app.put("/api/stock/:offerId/title", async (c) => {
    const offerId = parse(s.offerId, c.req.param("offerId"));
    const { title } = await parseJsonBody(c, s.titleBody);
    const [row] = await sql`update offers set title_override = ${title}, updated_at = now() where id = ${offerId} and kind = 'CARD' returning id`;
    if (!row) throw new HttpError(404, "OFFER_NOT_FOUND", "offer not found");
    await sql`insert into audit_events (actor, action, entity, entity_id, after) values (${c.var.actor}, 'offer_title_set', 'offer', ${offerId}, ${sql.json({ title })})`;
    return c.json(await getStockDetail(sql, offerId));
  });

  /**
   * Carte gradée : société de gradation, note et numéro de certificat ; null pour revenir à une carte non gradée.
   * Seul un exemplaire unique peut être gradé (chaque boîtier a sa note et son certificat).
   */
  app.put("/api/stock/:offerId/grading", async (c) => {
    const offerId = parse(s.offerId, c.req.param("offerId"));
    const { grading } = await parseJsonBody(c, s.gradingBody);
    const [offer] = await sql<{ isUnique: boolean }[]>`select is_unique from offers where id = ${offerId} and kind = 'CARD'`;
    if (!offer) throw new HttpError(404, "OFFER_NOT_FOUND", "offer not found");
    if (grading && !offer.isUnique) throw new HttpError(409, "GRADING_NEEDS_UNIQUE", "seul un exemplaire unique peut être gradé : sépare-le d'abord du lot de cartes identiques");
    await sql`
      update offers set grader = ${grading?.grader ?? null}, grade = ${grading?.grade ?? null}, cert_number = ${grading?.certNumber || null}, updated_at = now()
       where id = ${offerId}`;
    await sql`insert into audit_events (actor, action, entity, entity_id, after) values (${c.var.actor}, 'offer_grading_set', 'offer', ${offerId}, ${sql.json(grading as never)})`;
    return c.json(await getStockDetail(sql, offerId));
  });

  // ───────────────────────── Lots ─────────────────────────

  app.get("/api/lots", async (c) => c.json({ lots: await listLots(sql) }));

  /** Regroupe des cartes du stock en un lot : une annonce, un prix. Elles ne peuvent plus être vendues à part. */
  app.post("/api/lots", async (c) => {
    const body = await parseJsonBody(c, s.createLotBody);
    const locationId = body.locationId ?? (body.locationCode ? (await resolveLocation(sql, { code: body.locationCode })).id : undefined);
    const lot = await createLot(sql, { title: body.title, description: body.description, priceCents: body.priceCents, items: body.items, locationId, actor: c.var.actor });
    // Les cartes ont quitté leur position : les annonces qui les proposaient à l'unité suivent.
    await syncQuantities(sql, live).catch(deps.onError ?? console.error);
    return c.json(lot, 201);
  });

  app.patch("/api/lots/:id", async (c) => {
    const id = parse(s.lotId, c.req.param("id"));
    const body = await parseJsonBody(c, s.updateLotBody);
    const [row] = await sql`
      update offers set lot_title = coalesce(${body.title ?? null}, lot_title),
                        lot_description = ${body.description === undefined ? sql`lot_description` : body.description},
                        target_price_cents = coalesce(${body.priceCents ?? null}, target_price_cents), updated_at = now()
       where id = ${id} and kind = 'LOT' and status <> 'ARCHIVED' returning id`;
    if (!row) throw new HttpError(404, "LOT_NOT_FOUND", "ce lot n'existe pas");
    await sql`insert into audit_events (actor, action, entity, entity_id, after) values (${c.var.actor}, 'lot_updated', 'offer', ${id}, ${sql.json(body as never)})`;
    return c.json((await listLots(sql, { offerId: id }))[0]);
  });

  /** Défait un lot pas encore vendu : ses annonces sont retirées et ses cartes reviennent dans le stock. */
  app.delete("/api/lots/:id", async (c) => {
    const id = parse(s.lotId, c.req.param("id"));
    for (const l of await sql<{ id: string }[]>`select id from listings where offer_id = ${id} and status <> 'ENDED'`) {
      await endListing(sql, live, { listingId: l.id, actor: c.var.actor });
    }
    await dissolveLot(sql, id, c.var.actor);
    await syncQuantities(sql, live).catch(deps.onError ?? console.error);
    return c.json({ ok: true });
  });

  // ───────────────────────── Statistiques et alertes de prix ─────────────────────────

  app.get("/api/stats/dashboard", async (c) => c.json(await getDashboard(sql)));

  /** Activité récente pour l'accueil : ventes jour par jour sur 30 jours, dernières ventes, dernières mises en ligne. */
  app.get("/api/stats/activity", async (c) => c.json(await getActivity(sql)));

  /** Ce qui se vend : séries, tranches de prix, états, raretés, délai de vente, sur une période (90 jours par défaut). */
  app.get("/api/stats/sales", async (c) => c.json(await salesInsights(sql, parse(s.salesInsightsQuery, c.req.query()))));

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
  // ───────────────────────── Achats ─────────────────────────

  /** Cartes suivies : prix sur chaque plateforme, prix cible, alertes. */
  app.get("/api/watchlist", async (c) => c.json(await listWatched(sql)));
  app.post("/api/watchlist", async (c) => c.json(await watchCard(sql, await parseJsonBody(c, s.watchBody)), 201));
  app.patch("/api/watchlist/:id", async (c) => {
    await updateWatched(sql, parse(s.watchedId, c.req.param("id")), await parseJsonBody(c, s.watchUpdateBody));
    return c.json({ ok: true });
  });
  app.delete("/api/watchlist/:id", async (c) => {
    await unwatchCard(sql, parse(s.watchedId, c.req.param("id")));
    return c.json({ ok: true });
  });

  /**
   * Recherche libre pour suivre une carte : nom, numéro, série en une saisie. Une ligne par variante, avec son prix
   * (ventes réussies, sinon annonces) ; les noms qui commencent par le mot cherché d'abord, puis les plus chères.
   */
  app.get("/api/catalog/search", async (c) => {
    const q = parse(s.catalogSearchQuery, c.req.query());
    const hits = await searchCatalog(sql, q.q, { language: q.language, limit: 60 });
    const ids = hits.map((h) => h.variantId);
    const [estimates, watched] = await Promise.all([
      estimateVariants(sql, ids),
      ids.length ? sql<{ variantId: string; id: string }[]>`select variant_id, id from watched_cards where variant_id in ${sql(ids)}` : [],
    ]);
    const results = hits
      .map((h) => ({ ...h, estimate: estimates.get(h.variantId) ?? null, watchedId: watched.find((w) => w.variantId === h.variantId)?.id ?? null }))
      .sort((a, b) => Number(b.prefix) - Number(a.prefix) || (b.estimate?.cents ?? -1) - (a.estimate?.cents ?? -1))
      .slice(0, 20);
    return c.json({ results });
  });

  /** Les cartes les plus demandées du moment (vendues la veille, prix de vente en hausse), pour proposer quoi suivre. */
  app.get("/api/purchases/trending", async (c) => c.json({ cards: await trendingCards(sql, parse(s.topCardsQuery, c.req.query())) }));

  /**
   * Fiche d'une carte du catalogue : variantes avec leurs prix sur chaque plateforme et leur suivi, offres, exemplaires
   * en stock, ventes.
   */
  app.get("/api/cards/:id", async (c) => {
    const detail = await getCardDetail(sql, parse(s.catalogCardId, c.req.param("id")));
    const ids = detail.variants.map((v) => v.id);
    const [prices, watched] = await Promise.all([
      platformPrices(sql, ids),
      ids.length ? sql<{ variantId: string; id: string; targetCents: number | null }[]>`select variant_id, id, target_cents from watched_cards where variant_id in ${sql(ids)}` : [],
    ]);
    return c.json({
      ...detail,
      variants: detail.variants.map((v) => ({ ...v, prices: prices.get(v.id)!, watched: watched.find((w) => w.variantId === v.id) ?? null })),
    });
  });

  /** Bonnes affaires : cartes au-dessus d'une valeur, annoncées nettement sous leur prix de vente. */
  app.get("/api/deals", async (c) => c.json(await findDeals(sql, parse(s.dealsQuery, c.req.query()))));

  app.post("/api/prices/refresh", async (c) => {
    const refreshed = await refreshTrackedPrices(sql, catalogSource());
    return c.json({ ...refreshed, repriced: refreshed.pricesInserted > 0 ? await refreshPricing(sql) : 0 });
  });

  // ───────────────────────── Canaux de vente ─────────────────────────

  app.get("/api/channels", async (c) => c.json({ channels: await listChannels(sql, live) }));

  app.put("/api/channels/:channel", async (c) => {
    const channel = parse(s.channelId, c.req.param("channel"));
    const { mode } = await parseJsonBody(c, s.channelModeBody);
    await setChannelMode(sql, live, channel, mode, c.var.actor);
    return c.json({ channels: await listChannels(sql, live) });
  });

  /** Commandes des canaux réels, puis quantités annoncées. */
  app.post("/api/channels/sync", async (c) => c.json(await syncChannels(sql, live, c.var.actor, deps.onError ?? console.error)));

  // ───────────────────────── eBay : compte et réglages ─────────────────────────

  const ebayClient = () => {
    if (!ebay) throw new HttpError(409, "CHANNEL_NOT_CONFIGURED", "eBay application keys are not configured (EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RU_NAME)");
    return ebay;
  };
  const ebayConnection = async () => {
    const settings = await getEbaySettings(sql);
    return {
      configured: !!ebay,
      environment: ebay?.config.environment ?? null,
      account: ebay ? await ebay.account() : null,
      settings,
      missing: missingEbaySettings(settings),
      marketplaces: Object.entries(EBAY_MARKETPLACES).map(([id, m]) => ({ id, label: m.label })),
    };
  };

  app.get("/api/channels/ebay/connection", async (c) => c.json(await ebayConnection()));

  /** Adresse d'autorisation eBay où envoyer le propriétaire ; il revient sur /settings/channels/ebay. */
  app.post("/api/channels/ebay/connect", async (c) => c.json({ url: await ebayClient().consentUrl() }));

  app.post("/api/channels/ebay/connect/complete", async (c) => {
    const body = await parseJsonBody(c, s.ebayConsentBody);
    const { username } = await ebayClient().completeConsent(body);
    await sql`
      insert into audit_events (actor, action, entity, entity_id, after)
      values (${c.var.actor}, 'channel_connected', 'channel', 'ebay', ${sql.json({ environment: ebayClient().config.environment, username })})`;
    return c.json(await ebayConnection());
  });

  app.delete("/api/channels/ebay/connection", async (c) => {
    const [channel] = await listChannels(sql, live).then((all) => all.filter((ch) => ch.id === "ebay"));
    // Sans compte, le mode réel ne peut plus rien faire : le canal est éteint (les annonces restent sur eBay).
    if (channel?.mode === "LIVE") await setChannelMode(sql, live, "ebay", "OFF", c.var.actor);
    await ebayClient().disconnect();
    await sql`insert into audit_events (actor, action, entity, entity_id) values (${c.var.actor}, 'channel_disconnected', 'channel', 'ebay')`;
    return c.json(await ebayConnection());
  });

  /** Règles de vente et lieux d'expédition présents sur le compte eBay, pour le site choisi. */
  app.get("/api/channels/ebay/options", async (c) => c.json(await ebayAccountOptions(ebayClient(), await getEbaySettings(sql))));

  app.get("/api/channels/ebay/shipping-services", async (c) =>
    c.json({ services: await ebayShippingServices(ebayClient(), (await getEbaySettings(sql)).marketplaceId) }));

  app.put("/api/channels/ebay/settings", async (c) => {
    await saveEbaySettings(sql, await parseJsonBody(c, s.ebaySettingsBody), c.var.actor);
    return c.json(await ebayConnection());
  });

  /** Crée sur le compte eBay ce qui manque pour publier : règles d'envoi, de paiement, de retour, lieu d'expédition. */
  app.post("/api/channels/ebay/defaults", async (c) => {
    await createEbayDefaults(sql, ebayClient(), await parseJsonBody(c, s.ebayDefaultsBody), c.var.actor);
    return c.json(await ebayConnection());
  });

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

  // ───────────────────────── Catalogue public (site) ─────────────────────────

  // Pages publiques des séries et des cartes (dexlane.app/series) : catalogue commun et cotes seulement, jamais les
  // données d'un compte (voir @dexlane/catalog, public.ts).
  app.get("/api/public/catalog/sets", async (c) => {
    const { language } = parse(s.languageQuery, c.req.query());
    return c.json({ sets: await listPublicSets(sql, language) });
  });
  app.get("/api/public/catalog/sets/:set", async (c) => {
    const { language } = parse(s.languageQuery, c.req.query());
    const found = await getPublicSet(sql, language, parse(s.publicSegment, c.req.param("set")));
    if (!found) throw new HttpError(404, "CATALOG_SET_NOT_FOUND", "this set is not known for this language");
    return c.json(found);
  });
  app.get("/api/public/catalog/sets/:set/cards/:card", async (c) => {
    const { language } = parse(s.languageQuery, c.req.query());
    const card = await getPublicCard(sql, language, parse(s.publicSegment, c.req.param("set")), parse(s.publicSegment, c.req.param("card")));
    if (!card) throw new HttpError(404, "CATALOG_CARD_NOT_FOUND", "this card is not known for this language");
    return c.json(card);
  });
  app.get("/api/public/catalog/sitemap", async (c) => {
    const { language } = parse(s.languageQuery, c.req.query());
    const [sets, cards] = await Promise.all([listPublicSets(sql, language), listPublicCardsForSitemap(sql, language)]);
    return c.json({ sets, cards });
  });

  // ───────────────────────── Synchronisation du catalogue ─────────────────────────

  const catalogSource = () => guardCatalogSource((deps.tcgdex ?? createTcgdexClient)(), deps.onError ?? console.error);

  /** Séries connues et leur état : sans série synchronisée, ni le scan ni la recherche ne trouvent de carte. */
  app.get("/api/catalog/sets", async (c) => {
    const { language } = parse(s.languageQuery, c.req.query());
    return c.json({ sets: await listSets(sql, language) });
  });

  /** Code d'extension saisi à la main pour une série (« ME02.5 ») ; null : revenir au code déduit. */
  app.put("/api/catalog/sets/:id/code", async (c) => {
    const setId = parse(s.setId, c.req.param("id"));
    const body = await parseJsonBody(c, s.setCodeBody);
    return c.json(await setSetCode(sql, body.language, setId, body.code));
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

  /** Où en est l'import du catalogue complet d'une langue. */
  app.get("/api/catalog/import", async (c) => {
    const { language } = parse(s.languageQuery, c.req.query());
    return c.json(await catalogImportStatus(sql, language));
  });
  /** Importe les prochaines séries manquantes (les plus récentes d'abord) dans le budget de temps donné. */
  app.post("/api/catalog/import/next", async (c) => {
    const { language, budgetSeconds } = await parseJsonBody(c, s.catalogImportBody);
    return c.json(await importNextSets(sql, catalogSource(), language, { budgetMs: budgetSeconds * 1000 }));
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

  /** Évolution des prix d'une carte : moyennes des ventes, tendance et annonce la moins chère sur la période. */
  app.get("/api/pricing/variants/:id/history", async (c) => {
    const { days } = parse(s.priceHistoryQuery, c.req.query());
    return c.json(await priceHistory(sql, parse(s.variantId, c.req.param("id")), days));
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

  /**
   * Préparation des envois du jour : les commandes à préparer avec leurs prélèvements, et ce qu'il faut pour imprimer
   * bons de livraison et reçus (coordonnées du vendeur, papier de l'imprimante).
   */
  app.get("/api/orders/preparation", async (c) => {
    const { seller, slipPaper } = await getAppSettings(sql);
    return c.json({ orders: await listPreparation(sql), seller, slipPaper });
  });

  /** Frais d'envoi : affranchissement habituel par mode, sleeve, top-loader et enveloppe. */
  /** `stock` : le coût des fournitures d'après le stock quand leurs prix d'achat sont renseignés (il prime alors). */
  app.get("/api/shipping-costs", async (c) => {
    const stock = await stockSupplyCosts(sql);
    return c.json({ ...(await getShippingCosts(sql)), stock: stock && stockSuppliesSummary(stock) });
  });
  app.put("/api/shipping-costs", async (c) => c.json(await saveShippingCosts(sql, await parseJsonBody(c, s.shippingCostsBody), c.var.actor)));

  // ───────────────────────── Agents (serveur MCP) ─────────────────────────

  app.get("/api/agent-tokens", async (c) => c.json({ tokens: await listAgentTokens(sql) }));
  /** Le jeton n'est renvoyé qu'ici, une seule fois. */
  app.post("/api/agent-tokens", async (c) => c.json(await createAgentToken(sql, (await parseJsonBody(c, s.agentTokenBody)).name, c.var.actor), 201));
  app.delete("/api/agent-tokens/:id", async (c) => {
    await revokeAgentToken(sql, parse(s.agentTokenId, c.req.param("id")), c.var.actor);
    return c.body(null, 204);
  });

  /**
   * Serveur MCP (Streamable HTTP, sans session) : chaque requête monte le serveur, appelle l'outil demandé et répond en
   * JSON. Les outils passent par les routes de l'API, au nom de l'agent.
   */
  app.all("/api/mcp", async (c) => {
    if (c.req.method !== "POST") {
      return c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this MCP server is stateless, use POST" }, id: null }, 405, { Allow: "POST" });
    }
    const actor = c.var.actor.startsWith("agent:") ? c.var.actor : "agent:owner";
    const internal: InternalCall = async (method, path, body, idempotencyKey) => {
      const headers: Record<string, string> = { Authorization: `Bearer ${deps.token}`, "X-Dexlane-Agent": actor, "X-Dexlane-Account": c.var.accountId };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (method !== "GET") headers["Idempotency-Key"] = idempotencyKey ?? `mcp-${randomUUID()}`;
      const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) };
    };
    const server = createMcpServer(internal);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void server.close();
    }
  });

  // ───────────────────────── Fournitures ─────────────────────────

  app.get("/api/supplies", async (c) => c.json(await listSupplies(sql)));
  /** Journal du stock : entrées, sorties, corrections et déplacements, cartes et fournitures. */
  app.get("/api/stock-movements", async (c) => c.json(await listStockMovements(sql, parse(s.movementsQuery, c.req.query()))));
  app.post("/api/supplies", async (c) => c.json(await createSupply(sql, await parseJsonBody(c, s.createSupplyBody), c.var.actor), 201));
  app.get("/api/supplies/:id", async (c) => c.json(await getSupply(sql, parse(s.supplyId, c.req.param("id")))));
  app.patch("/api/supplies/:id", async (c) => c.json(await updateSupply(sql, parse(s.supplyId, c.req.param("id")), await parseJsonBody(c, s.updateSupplyBody))));
  app.delete("/api/supplies/:id", async (c) => {
    await archiveSupply(sql, parse(s.supplyId, c.req.param("id")));
    return c.body(null, 204);
  });
  /** Commande reçue : la quantité s'ajoute au stock et la commande en cours est close. */
  app.post("/api/supplies/:id/receive", async (c) => {
    const { quantity, note } = await parseJsonBody(c, s.supplyQuantityBody);
    return c.json(await receiveSupply(sql, parse(s.supplyId, c.req.param("id")), quantity, c.var.actor, note ?? null));
  });
  /** Inventaire : le stock compté remplace le stock calculé. */
  app.post("/api/supplies/:id/count", async (c) => {
    const { onHand, note } = await parseJsonBody(c, s.supplyCountBody);
    return c.json(await countSupply(sql, parse(s.supplyId, c.req.param("id")), onHand, c.var.actor, note ?? null));
  });
  app.post("/api/supplies/:id/ordered", async (c) =>
    c.json(await markSupplyOrdered(sql, parse(s.supplyId, c.req.param("id")), (await parseJsonBody(c, s.supplyOrderedBody)).ordered)));

  app.post("/api/orders/preparation/printed", async (c) =>
    c.json({ marked: await markSlipsPrinted(sql, (await parseJsonBody(c, s.slipsPrintedBody)).orderIds) }));

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

  // ───────────────────────── Livraison et avis ─────────────────────────

  const carriers = deps.tracking ?? trackingFromEnv(process.env);
  /** Transporteurs suivis automatiquement (identifiants configurés). */
  app.get("/api/shipments/tracking", async (c) => c.json({
    carriers: { LA_POSTE: Boolean(carriers.LA_POSTE), MONDIAL_RELAY: Boolean(carriers.MONDIAL_RELAY) },
  }));
  /** Interroge les transporteurs pour les envois en route (tâche quotidienne, ou à la demande avec `force`). */
  app.post("/api/shipments/tracking/refresh", async (c) => {
    const force = c.req.query("force") === "true";
    const list = await shipmentsToTrack(sql, { carriers: (Object.keys(carriers) as Carrier[]), staleHours: force ? 0 : 3 });
    let delivered = 0, failed = 0;
    for (const shipment of list) {
      try {
        const result = await carriers[shipment.carrier]!(shipment);
        await recordTracking(sql, shipment.id, result);
        if (result?.status === "DELIVERED") delivered++;
      } catch (e) {
        failed++;
        (deps.onError ?? console.error)(e);
      }
    }
    return c.json({ checked: list.length, delivered, failed });
  });
  /** Rappel des avis à demander : une notification pour les ventes livrées depuis 24 h, une seule fois chacune. */
  app.post("/api/sales/reviews/remind", async (c) => {
    if (!(await getAppSettings(sql)).notifications.reviews) return c.json({ reminded: 0, sent: 0 });
    const due = await takeReviewReminders(sql);
    const result = due.length > 0 ? await broadcast(sql, push, (locale) => reviewsMessage(due, locale)) : { sent: 0 };
    return c.json({ reminded: due.length, sent: result.sent });
  });
  app.patch("/api/orders/:id/tracking", async (c) => {
    const orderId = parse(s.orderId, c.req.param("id"));
    await updateTracking(sql, orderId, await parseJsonBody(c, s.trackingBody));
    return c.json(await getOrderDetail(sql, orderId));
  });
  app.post("/api/orders/:id/delivered", async (c) => {
    const orderId = parse(s.orderId, c.req.param("id"));
    await markDelivered(sql, orderId, c.var.actor);
    return c.json(await getOrderDetail(sql, orderId));
  });
  app.post("/api/orders/:id/review", async (c) => {
    const orderId = parse(s.orderId, c.req.param("id"));
    await markReviewRequested(sql, orderId, (await parseJsonBody(c, s.reviewBody)).requested);
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

  // Une base qui ne répond pas quelques secondes (réveil d'une base serverless, réseau) : une lecture est retentée,
  // deux fois, avant de renvoyer l'erreur. Les écritures ne sont jamais rejouées ici.
  const fetchOnce = app.fetch.bind(app);
  app.fetch = async (request, env, ctx) => {
    if (request.method !== "GET" && request.method !== "HEAD") return fetchOnce(request, env, ctx);
    for (let attempt = 0; ; attempt++) {
      const response = await fetchOnce(request.clone(), env, ctx);
      if (response.status !== 503 || attempt >= READ_RETRIES) return response;
      const body = (await response.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
      if (body?.error?.code !== "DATABASE_UNAVAILABLE") return response;
      await new Promise((resolve) => setTimeout(resolve, READ_RETRY_DELAY_MS * (attempt + 1)));
    }
  };
  return app;
}

const READ_RETRIES = 2;
const READ_RETRY_DELAY_MS = 400;
/** Erreurs de connexion à la base (délai dépassé, connexion coupée ou refusée, serveur en redémarrage). */
const CONNECTION_CODES = new Set(["CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN"]);
export function isConnectionError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return false;
  return CONNECTION_CODES.has(code) || code.startsWith("08") || code === "57P01" || code === "57P02" || code === "57P03";
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

/**
 * Lecture comptée (#50) : réserve un scan du forfait (refusé au-delà du quota ou du débit), puis renvoie le lecteur
 * qui note son coût. La réservation et le coût s'écrivent chacun dans leur propre transaction, courte et cloisonnée au
 * compte : ils restent acquis même si la requête échoue ensuite (la lecture a été payée), et la réservation, sérialisée
 * par compte, ne laisse pas des scans simultanés dépasser le plafond. Une panne du service ne consomme rien.
 */
async function meteredRecognizer(root: Db, accountId: string, inner: CardRecognizer, source: "single" | "batch"): Promise<CardRecognizer> {
  const scanId = await withAccount(root, accountId, (tx) => reserveScan(tx, source));
  return {
    async recognize(image) {
      try {
        const recognition = await inner.recognize(image);
        await withAccount(root, accountId, (tx) => recordScanCost(tx, scanId, recognition.usage.costUsd));
        return recognition;
      } catch (e) {
        if (e instanceof HttpError && e.code === "SCAN_UNAVAILABLE") await withAccount(root, accountId, (tx) => tx`delete from scan_usage where id = ${scanId}`);
        throw e;
      }
    },
  };
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
