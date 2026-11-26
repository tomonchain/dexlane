import type {
  AcquisitionLot, Activity, CardPage, CatalogHit, Deal, DealList, TopCard, WatchedCard, AlertSettings, AppSettings, Candidate, CardCondition, CatalogSet, ChannelId, Dashboard, SalesInsights, PriceMoves, ChannelMode, ChannelState, EbayAccountOptions, EbayConnection, EbayDefaultsInput, EbaySettings, EbayShippingService, ListingState, CatalogSetDetail, InventoryPage, InventorySummary, ListingOffer, ListingSettings,
  Location, Photo, PositionDetail, Received,
  OfferPricing, OrderDetail, PriceHistory, OrderList, OrderStage, PricingSettings, ShippingCosts, ShippingRun, ReceivedBulkLot, ScanResult, SellableOffer, SetSyncReport,
  AccountSummary, Grading, PlanId, SaleLot, StockSuggestions, SupportRequest, TeamView,
  PlanResult, ScanBatch, ScanItem, Schedule, ShippingMode, StockDetail, StockFacets, StockPage, StockStatus, StoredPhoto, VariantQuote, SupplyDetail, SupplyInput, SupplyList, ShippingCostsView, CatalogImportStatus, PublicationCalendar, PublicationDay, AgentToken, Carrier, MovementPage, MovementKind, MovementCategory,
} from "./types";
import { clearCache } from "./cache";
import { t } from "./i18n";

const PLAN_NAMES: Record<string, string> = { decouverte: "Découverte", solo: "Solo", pro: "Pro", boutique: "Boutique" };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  json?: unknown;
  blob?: Blob;
  idempotencyKey?: string;
  query?: Record<string, string | number | undefined>;
}

async function request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, opts: RequestOptions = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") params.set(k, String(v));
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.blob) {
    headers["Content-Type"] = opts.blob.type;
    body = opts.blob;
  } else if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`/api${path}${params.size ? `?${params}` : ""}`, { method, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "NETWORK", t("Connexion impossible. Vérifiez le réseau puis réessayez."));
  }
  if (res.status === 401) {
    clearCache();
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new ApiError(401, "UNAUTHORIZED", t("Session expirée."));
  }
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) {
    const e = data?.error;
    if (e?.code === "DATABASE_UNAVAILABLE") throw new ApiError(res.status, e.code, t("La base de données ne répond pas pour l'instant. Réessayez dans quelques secondes."));
    // Forfait : le message du serveur est remplacé par un texte de l'interface, qui dit où agir.
    if (e?.code === "SCAN_QUOTA_EXCEEDED") {
      throw new ApiError(res.status, e.code, t("Scans du mois épuisés : ajoutez un pack ou changez de forfait (Réglages › Forfait). La carte peut se rechercher à la main."), e.details);
    }
    if (e?.code === "SCAN_RATE_LIMITED") throw new ApiError(res.status, e.code, t("Trop de scans en une minute. Patientez un instant, puis reprenez."), e.details);
    if (e?.code === "QUOTA_EXCEEDED") {
      throw new ApiError(res.status, e.code, t("Quota du mois atteint : ajoutez un pack de cartes ou changez de forfait (Réglages › Forfait). Vos annonces en ligne ne bougent pas."), e.details);
    }
    if (e?.code === "FEATURE_NOT_IN_PLAN") {
      const required = (e.details as { requiredPlan?: string } | undefined)?.requiredPlan ?? "";
      throw new ApiError(res.status, e.code, t("Disponible à partir du forfait {plan} (Réglages › Forfait).", { plan: PLAN_NAMES[required] ?? required }), e.details);
    }
    throw new ApiError(res.status, e?.code ?? "HTTP_ERROR", e?.message ?? t("Erreur {status}", { status: res.status }), e?.details);
  }
  return data as T;
}

/** Routes de session du serveur web (/auth), hors relais d'API. */
async function send<T>(url: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!res) throw new ApiError(0, "NETWORK", t("Connexion impossible. Vérifiez le réseau puis réessayez."));
  // Nos routes répondent `{ error: { code, message } }` ; celles de BetterAuth, `{ code, message }`.
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown }; code?: string; message?: string } | null;
  if (!res.ok) {
    const code = data?.error?.code ?? data?.code ?? (res.status === 429 ? "TOO_MANY_ATTEMPTS" : "HTTP_ERROR");
    throw new ApiError(res.status, code, data?.error?.message ?? data?.message ?? t("Erreur {status}", { status: res.status }), data?.error?.details);
  }
  return data as T;
}
/** Installation (propriétaire, jeton d'installation) : route /auth du serveur web. */
const auth = <T = { ok: true }>(method: "GET" | "POST", body?: unknown) => send<T>("/auth", method, body);
/** Connexion, mot de passe, déconnexion : routes de BetterAuth, relayées sous /api/auth. */
const betterAuth = <T = unknown>(path: string, body: unknown = {}) => send<T>(`/api/auth/${path}`, "POST", body);

/** Nouvelle clé d'idempotence : une par intention de l'utilisateur, réutilisée telle quelle en cas de nouvel essai. */
export const newKey = () => crypto.randomUUID();

export interface ReceiveInput {
  variantId: string;
  condition: CardCondition;
  quantity: number;
  locationCode: string;
  unitCostCents: number;
  acquisitionLotId?: string;
  unique?: boolean;
  draft?: boolean;
  photoIds?: string[];
}

export interface BulkInput {
  descriptor: { setId?: string; era?: string; cardType: string; rarityBand?: string; language?: string };
  quantity: number;
  locationCode: string;
  totalCostCents: number;
  acquisitionLotId?: string;
}

export const api = {
  /** Appel direct d'une route de l'API (modules qui déclarent leurs propres appels, comme lib/insights.ts). */
  raw: <T,>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, opts: RequestOptions = {}) => request<T>(method, path, opts),
  scan: (image: Blob, language: string) => request<ScanResult>("POST", "/scans", { blob: image, query: { language } }),
  uploadPhoto: (image: Blob, kind: "SCAN_FRONT" | "SCAN_BACK" | "BACKGROUND" | "PROMO" | "LOGO") => request<StoredPhoto>("POST", "/photos", { blob: image, query: { kind } }),
  /** Visuel d'annonce composé à partir d'un scan ; remplace le précédent visuel de ce scan. */
  uploadListingPhoto: (image: Blob, sourcePhotoId: string) => request<Photo>("POST", "/photos", { blob: image, query: { kind: "LISTING", source: sourcePhotoId } }),
  /** Photo ajoutée après coup à une carte déjà en stock. */
  addOfferPhoto: (offerId: string, image: Blob, kind: "SCAN_FRONT" | "SCAN_BACK") =>
    request<Photo>("POST", `/stock/${offerId}/photos`, { blob: image, query: { kind } }),
  deletePhoto: (photoId: string) => request<{ ok: true }>("DELETE", `/photos/${photoId}`),
  /** Adresse du contenu d'une photo sur la même origine (utilisable dans un canvas). */
  photoContentUrl: (photoId: string) => `/api/photos/${photoId}/content`,

  listingSettings: () => request<ListingSettings>("GET", "/listings/settings"),
  saveListingSettings: (settings: ListingSettings) => request<ListingSettings>("PUT", "/listings/settings", { json: settings }),
  listingOffers: (q: { q?: string; limit?: number; offset?: number }) =>
    request<{ items: ListingOffer[]; total: number }>("GET", "/listings/offers", { query: q }),

  appSettings: () => request<AppSettings>("GET", "/app-settings"),
  notifications: () => request<{ publicKey: string; devices: number; preferences: AppSettings["notifications"] }>("GET", "/notifications"),
  subscribePush: (subscription: { endpoint: string; keys: { p256dh: string; auth: string }; locale: "fr" | "en" }) =>
    request<{ devices: number }>("POST", "/notifications/subscriptions", { json: subscription }),
  unsubscribePush: (endpoint: string) => request<{ devices: number }>("POST", "/notifications/subscriptions/remove", { json: { endpoint } }),
  testPush: () => request<{ sent: number; removed: number; failed: number }>("POST", "/notifications/test"),
  saveAppSettings: (change: Partial<AppSettings>) => request<AppSettings>("PUT", "/app-settings", { json: change }),

  schedule: () => request<Schedule>("GET", "/publications"),
  planPublications: (input: { offerIds?: string[]; channel: ChannelId; startOn: string; perDay: number }) =>
    request<PlanResult>("POST", "/publications/plan", { json: input }),
  cancelPublications: (filter: { plannedOn?: string; channel?: ChannelId; offerId?: string }) =>
    request<{ cancelled: number }>("POST", "/publications/cancel", { json: filter }),
  runPublications: () => request<{ published: number; failed: number }>("POST", "/publications/run"),
  publicationCalendar: (from: string, to: string) => request<PublicationCalendar>("GET", "/publications/calendar", { query: { from, to } }),
  publicationDay: (date: string) => request<PublicationDay>("GET", `/publications/day/${date}`),
  reschedulePublication: (id: string, plannedOn: string) => request<{ ok: true }>("PATCH", `/publications/${id}`, { json: { plannedOn } }),

  scanBatches: () => request<{ batches: ScanBatch[] }>("GET", "/scan-batches"),
  createScanBatch: (input: {
    name?: string; locationCode: string; unitCostCents?: number; defaultCondition?: CardCondition | null; language?: string; paired?: boolean;
    autopilot?: boolean; publishMode?: ScanBatch["publishMode"]; publishPerDay?: number | null;
  }) =>
    request<ScanBatch>("POST", "/scan-batches", { json: input }),
  scanBatch: (id: string) => request<{ batch: ScanBatch; items: ScanItem[] }>("GET", `/scan-batches/${id}`),
  updateScanBatch: (id: string, change: {
    name?: string; locationCode?: string; unitCostCents?: number; defaultCondition?: CardCondition | null;
    autopilot?: boolean; publishMode?: ScanBatch["publishMode"]; publishPerDay?: number | null;
  }) =>
    request<ScanBatch>("PATCH", `/scan-batches/${id}`, { json: change }),
  /** Pilote automatique : entre en stock les cartes complètes, pose leur prix et les met en file de mise en ligne. */
  autopilotScanBatch: (id: string) =>
    request<{ received: number; offerIds: string[]; queued: number; batch: ScanBatch }>("POST", `/scan-batches/${id}/autopilot`),
  /** Enregistre la carte de ce rang ; si le rang existe déjà, il est renvoyé sans nouvelle lecture. */
  addScanItem: (batchId: string, position: number, fileName: string, image: Blob) =>
    request<ScanItem>("POST", `/scan-batches/${batchId}/items`, { blob: image, query: { position, fileName } }),
  setScanItemBack: (itemId: string, image: Blob) => request<ScanItem>("POST", `/scan-items/${itemId}/back`, { blob: image }),
  updateScanItem: (itemId: string, change: { catalogCardId?: string; variantId?: string | null; condition?: CardCondition | null; skipped?: boolean }) =>
    request<ScanItem>("PATCH", `/scan-items/${itemId}`, { json: change }),
  receiveScanBatch: (id: string) => request<{ received: number; firstSku: string | null; lastSku: string | null; batch: ScanBatch }>("POST", `/scan-batches/${id}/receive`),

  stock: (q: {
    q?: string; status?: StockStatus | "ALL"; sort?: "value" | "recent" | "name"; limit?: number; offset?: number;
    setId?: string; location?: string; condition?: string; minCents?: number; maxCents?: number;
  }) => request<StockPage>("GET", "/stock", { query: q }),
  stockFacets: () => request<StockFacets>("GET", "/stock/facets"),
  /** Action groupée sur des cartes du stock ; renvoie le nombre de positions ou d'offres réellement modifiées. */
  stockBulk: (body: { action: "ACCEPT_PRICE" | "ACTIVATE"; offerIds: string[] } | { action: "MOVE"; offerIds: string[]; locationCode: string }) =>
    request<{ affected: number }>("POST", "/stock/bulk", { json: body }),
  stockDetail: (offerId: string) => request<StockDetail>("GET", `/stock/${offerId}`),

  dashboard: () => request<Dashboard>("GET", "/stats/dashboard"),
  salesInsights: (days: number) => request<SalesInsights>("GET", "/stats/sales", { query: { days: String(days) } }),
  activity: () => request<Activity>("GET", "/stats/activity"),
  priceMoves: (alertsOnly: boolean) => request<PriceMoves>("GET", "/stats/price-moves", { query: { alerts: String(alertsOnly) } }),
  saveAlertSettings: (settings: AlertSettings) => request<AlertSettings>("PUT", "/stats/alert-settings", { json: settings }),
  watchlist: () => request<{ items: WatchedCard[]; alerts: number }>("GET", "/watchlist"),
  watch: (input: { variantId: string; targetCents?: number | null }) => request<{ id: string }>("POST", "/watchlist", { json: input }),
  updateWatched: (id: string, change: { targetCents?: number | null; note?: string | null }) => request<{ ok: true }>("PATCH", `/watchlist/${id}`, { json: change }),
  unwatch: (id: string) => request<{ ok: true }>("DELETE", `/watchlist/${id}`),
  card: (id: string) => request<CardPage>("GET", `/cards/${id}`),
  searchCards: (q: string) => request<{ results: CatalogHit[] }>("GET", "/catalog/search", { query: { q } }),
  trendingCards: (limit = 5) => request<{ cards: TopCard[] }>("GET", "/purchases/trending", { query: { limit } }),
  deals: (q: { minCents?: number; minDiscount?: number; freshDays?: number }) => request<DealList>("GET", "/deals", { query: q }),
  refreshPrices: () => request<{ cards: number; pricesInserted: number; errors: number; remaining: number; repriced: number }>("POST", "/prices/refresh"),

  channels: () => request<{ channels: ChannelState[] }>("GET", "/channels"),
  setChannelMode: (channel: ChannelId, mode: ChannelMode) => request<{ channels: ChannelState[] }>("PUT", `/channels/${channel}`, { json: { mode } }),
  syncChannels: () => request<{ orders: number; updated: number; errors: number }>("POST", "/channels/sync"),
  ebayConnection: () => request<EbayConnection>("GET", "/channels/ebay/connection"),
  ebayConnect: () => request<{ url: string }>("POST", "/channels/ebay/connect"),
  ebayCompleteConsent: (input: { state: string; code: string }) => request<EbayConnection>("POST", "/channels/ebay/connect/complete", { json: input }),
  ebayDisconnect: () => request<EbayConnection>("DELETE", "/channels/ebay/connection"),
  ebayOptions: () => request<EbayAccountOptions>("GET", "/channels/ebay/options"),
  ebayShippingServices: () => request<{ services: EbayShippingService[] }>("GET", "/channels/ebay/shipping-services"),
  saveEbaySettings: (change: Partial<EbaySettings>) => request<EbayConnection>("PUT", "/channels/ebay/settings", { json: change }),
  createEbayDefaults: (input: EbayDefaultsInput) => request<EbayConnection>("POST", "/channels/ebay/defaults", { json: input }),
  publishListing: (offerId: string, channel: ChannelId) => request<ListingState>("POST", `/listings/offers/${offerId}/publish`, { json: { channel } }),
  endListing: (listingId: string) => request<{ ok: true }>("POST", `/listings/${listingId}/end`),
  simulateOrder: (listingId: string, qty = 1) => request<OrderDetail>("POST", `/listings/${listingId}/simulate-order`, { json: { qty } }),
  searchCatalog: (q: { language: string; name?: string; number?: string; set?: string }) =>
    request<{ candidates: Candidate[] }>("GET", "/catalog/cards", { query: q }),

  catalogSets: (language: string) => request<{ sets: CatalogSet[] }>("GET", "/catalog/sets", { query: { language } }),
  refreshCatalogSets: (language: string) => request<{ count: number }>("POST", "/catalog/sets/refresh", { json: { language } }),
  syncCatalogSet: (setId: string, language: string) =>
    request<SetSyncReport>("POST", `/catalog/sets/${encodeURIComponent(setId)}/sync`, { json: { language } }),

  sellableOffers: (q?: string) => request<{ offers: SellableOffer[] }>("GET", "/offers/sellable", { query: { q } }),
  orders: (stage?: OrderStage, review?: "DUE") => request<OrderList>("GET", "/orders", { query: { stage, review } }),
  trackingStatus: () => request<{ carriers: Record<"LA_POSTE" | "MONDIAL_RELAY", boolean> }>("GET", "/shipments/tracking"),
  refreshTracking: () => request<{ checked: number; delivered: number; failed: number }>("POST", "/shipments/tracking/refresh", { query: { force: "true" } }),
  updateTracking: (orderId: string, input: { carrier?: Carrier | null; tracking?: string | null }) => request<OrderDetail>("PATCH", `/orders/${orderId}/tracking`, { json: input }),
  markDelivered: (orderId: string) => request<OrderDetail>("POST", `/orders/${orderId}/delivered`),
  markReviewRequested: (orderId: string, requested: boolean) => request<OrderDetail>("POST", `/orders/${orderId}/review`, { json: { requested } }),
  order: (id: string) => request<OrderDetail>("GET", `/orders/${id}`),
  shippingCosts: () => request<ShippingCostsView>("GET", "/shipping-costs"),
  saveShippingCosts: (costs: ShippingCosts) => request<ShippingCosts>("PUT", "/shipping-costs", { json: costs }),
  shippingRun: () => request<ShippingRun>("GET", "/orders/preparation"),

  agentTokens: () => request<{ tokens: AgentToken[] }>("GET", "/agent-tokens"),
  createAgentToken: (name: string) => request<AgentToken & { token: string }>("POST", "/agent-tokens", { json: { name } }),
  revokeAgentToken: (id: string) => request<null>("DELETE", `/agent-tokens/${id}`),

  supplies: () => request<SupplyList>("GET", "/supplies"),
  stockMovements: (q: { category?: MovementCategory; kind?: MovementKind; offerId?: string; supplyId?: string; before?: string; limit?: number; days?: number } = {}) =>
    request<MovementPage>("GET", "/stock-movements", { query: q }),
  createSupply: (input: SupplyInput & { onHand: number }) => request<SupplyDetail>("POST", "/supplies", { json: input }),
  updateSupply: (id: string, input: Partial<SupplyInput>) => request<SupplyDetail>("PATCH", `/supplies/${id}`, { json: input }),
  archiveSupply: (id: string) => request<null>("DELETE", `/supplies/${id}`),
  receiveSupply: (id: string, quantity: number, note?: string) => request<SupplyDetail>("POST", `/supplies/${id}/receive`, { json: { quantity, note } }),
  countSupply: (id: string, onHand: number, note?: string) => request<SupplyDetail>("POST", `/supplies/${id}/count`, { json: { onHand, note } }),
  markSupplyOrdered: (id: string, ordered: boolean) => request<SupplyDetail>("POST", `/supplies/${id}/ordered`, { json: { ordered } }),
  markSlipsPrinted: (orderIds: string[]) => request<{ marked: number }>("POST", "/orders/preparation/printed", { json: { orderIds } }),
  createSale: (
    input: { lines: { offerId: string; qty: number; unitPriceCents: number }[]; shippingMode: ShippingMode; shippingChargedCents?: number; buyerName?: string; addressLines?: string[]; note?: string },
    key: string,
  ) => request<OrderDetail>("POST", "/orders", { json: input, idempotencyKey: key }),
  pickAllocation: (orderId: string, allocationId: string, unitSku: string) =>
    request<OrderDetail>("POST", `/orders/${orderId}/pick`, { json: { allocationId, unitSku } }),
  packOrder: (orderId: string) => request<OrderDetail>("POST", `/orders/${orderId}/pack`),
  handOver: (orderId: string, input: { tracking?: string; carrier?: Carrier; postageCostCents?: number }) =>
    request<OrderDetail>("POST", `/orders/${orderId}/handover`, { json: input }),
  cancelOrder: (orderId: string, reason: string) => request<OrderDetail>("POST", `/orders/${orderId}/cancel`, { json: { reason } }),

  pricingSettings: () => request<PricingSettings>("GET", "/pricing/settings"),
  savePricingSettings: (settings: PricingSettings) =>
    request<{ settings: PricingSettings; repriced: number }>("PUT", "/pricing/settings", { json: settings }),
  variantQuote: (variantId: string, condition: CardCondition, unique: boolean) =>
    request<VariantQuote>("GET", `/pricing/variants/${variantId}`, { query: { condition, unique: String(unique) } }),
  priceHistory: (variantId: string, days: number) => request<PriceHistory>("GET", `/pricing/variants/${variantId}/history`, { query: { days } }),
  pricedOffers: (q: { status: "REVIEW" | "ALL"; q?: string; limit?: number; offset?: number }) =>
    request<{ items: OfferPricing[]; total: number; reviewCount: number; allCount: number }>("GET", "/pricing/offers", { query: q }),
  setOfferPrice: (offerId: string, input: { targetPriceCents: number; floorPriceCents?: number; category?: "BULK" | "LOT" | "SINGLE" | "PREMIUM" }) =>
    request<OfferPricing>("POST", `/pricing/offers/${offerId}/price`, { json: input }),
  recomputePricing: () => request<{ repriced: number }>("POST", "/pricing/recompute"),

  catalogImport: (language: string) => request<CatalogImportStatus>("GET", "/catalog/import", { query: { language } }),
  importNextSets: (language: string, budgetSeconds = 50) =>
    request<{ imported: { setId: string; name: string; cards: number; errorCount: number }[]; status: CatalogImportStatus }>("POST", "/catalog/import/next", { json: { language, budgetSeconds } }),
  setSetCode: (setId: string, language: string, code: string | null) =>
    request<{ code: string; codeOverride: string | null }>("PUT", `/catalog/sets/${encodeURIComponent(setId)}/code`, { json: { language, code } }),
  catalogSet: (setId: string, language: string) =>
    request<CatalogSetDetail>("GET", `/catalog/sets/${encodeURIComponent(setId)}`, { query: { language } }),

  locations: () => request<{ locations: Location[] }>("GET", "/locations"),
  createLocations: (codes: string[]) =>
    request<{ created: { code: string }[]; existing: { code: string }[] }>("POST", "/locations/batch", { json: { codes } }),
  describeLocation: (id: string, description: string | null) => request<Location>("PATCH", `/locations/${id}`, { json: { description } }),
  deleteLocation: (id: string) => request<{ code: string }>("DELETE", `/locations/${id}`),
  createLocation: (code: string, description?: string) =>
    request<Location & { created: boolean }>("POST", "/locations", { json: { code, description } }),

  lots: () => request<{ lots: AcquisitionLot[] }>("GET", "/acquisition-lots"),
  createLot: (
    input: { sourceType: string; sellerRef?: string; purchaseDate: string; totalCostCents: number; shippingCostCents?: number },
    key: string,
  ) => request<AcquisitionLot>("POST", "/acquisition-lots", { json: input, idempotencyKey: key }),

  inventory: (q: Record<string, string | number | undefined>) => request<InventoryPage>("GET", "/inventory", { query: q }),
  inventorySummary: () => request<InventorySummary>("GET", "/inventory/summary"),
  position: (ref: string) => request<PositionDetail>("GET", `/inventory/${encodeURIComponent(ref)}`),
  receive: (input: ReceiveInput, key: string) =>
    request<Received>("POST", "/inventory/receive", { json: input, idempotencyKey: key }),
  receiveBulk: (input: BulkInput, key: string) =>
    request<ReceivedBulkLot>("POST", "/inventory/bulk", { json: input, idempotencyKey: key }),
  extract: (bulkId: string, input: Omit<ReceiveInput, "unitCostCents" | "acquisitionLotId">, key: string) =>
    request<Received>("POST", `/inventory/${bulkId}/extract`, { json: input, idempotencyKey: key }),
  move: (id: string, locationCode: string) =>
    request<PositionDetail>("POST", `/inventory/${id}/move`, { json: { locationCode } }),
  adjust: (id: string, countedOnHand: number, reason: string, key: string) =>
    request<PositionDetail>("POST", `/inventory/${id}/adjust`, { json: { countedOnHand, reason }, idempotencyKey: key }),
  activate: (id: string) => request<PositionDetail>("POST", `/inventory/${id}/activate`),

  authStatus: () => auth<{ passwordSet: boolean }>("GET"),
  login: (email: string, password: string) => betterAuth("sign-in/email", { email, password }),
  /** Première connexion ou clé de secours : le jeton d'installation autorise à choisir l'adresse et le mot de passe du propriétaire. */
  setupOwner: async (setupToken: string, email: string, newPassword: string) => {
    await auth("POST", { setupToken, email, newPassword });
    await betterAuth("sign-in/email", { email, password: newPassword });
  },
  changePassword: (currentPassword: string, newPassword: string) => betterAuth("change-password", { currentPassword, newPassword, revokeOtherSessions: true }),
  /** L'utilisateur de la session : adresse, rôle (admin pour le propriétaire de l'installation), forfait choisi. */
  account: () => request<AccountSummary>("GET", "/account"),
  changePlan: (plan: Exclude<PlanId, "community">) => request<AccountSummary>("PUT", "/account/plan", { json: { plan } }),
  deleteAccount: (password: string) =>
    request<{ ok: true; deleted: "account" | "user" }>("POST", "/account/delete", { json: { password, confirm: "SUPPRIMER" }, idempotencyKey: crypto.randomUUID() }),
  addPacks: (packs = 1) => request<AccountSummary>("POST", "/account/packs", { json: { packs }, idempotencyKey: crypto.randomUUID() }),
  team: () => request<TeamView>("GET", "/team"),
  invite: (email: string) => request<{ id: string; email: string }>("POST", "/team/invitations", { json: { email }, idempotencyKey: crypto.randomUUID() }),
  revokeInvitation: (id: string) => request<{ ok: true }>("DELETE", `/team/invitations/${id}`),
  removeMember: (id: string) => request<{ ok: true }>("DELETE", `/team/members/${encodeURIComponent(id)}`),
  previewInvitation: (token: string) =>
    request<{ email: string; invitedBy: string; matches: boolean }>("POST", "/team/invitations/preview", { json: { token }, idempotencyKey: crypto.randomUUID() }),
  acceptInvitation: (token: string) => request<{ ok: true; accountId: string }>("POST", "/team/invitations/accept", { json: { token }, idempotencyKey: crypto.randomUUID() }),
  supportRequests: () => request<{ requests: SupportRequest[]; priority: boolean }>("GET", "/support"),
  contactSupport: (subject: string, message: string) =>
    request<{ id: string; priority: boolean }>("POST", "/support", { json: { subject, message }, idempotencyKey: crypto.randomUUID() }),
  saleLots: () => request<{ lots: SaleLot[] }>("GET", "/lots"),
  createSaleLot: (input: { title: string; description?: string | null; priceCents: number; items: { offerId: string; qty: number }[]; locationCode?: string }) =>
    request<SaleLot>("POST", "/lots", { json: input, idempotencyKey: crypto.randomUUID() }),
  updateSaleLot: (id: string, input: { title?: string; description?: string | null; priceCents?: number }) => request<SaleLot>("PATCH", `/lots/${id}`, { json: input }),
  dissolveSaleLot: (id: string) => request<{ ok: true }>("DELETE", `/lots/${id}`),
  setGrading: (offerId: string, grading: Grading | null) => request<StockDetail>("PUT", `/stock/${offerId}/grading`, { json: { grading } }),
  setTitle: (offerId: string, title: string | null) => request<StockDetail>("PUT", `/stock/${offerId}/title`, { json: { title } }),
  suggestions: (offerId: string) => request<StockSuggestions>("GET", `/stock/${offerId}/suggestions`),
  logout: () => {
    clearCache(); // les données de ce compte ne restent pas sur l'appareil
    return betterAuth("sign-out").catch(() => undefined);
  },
};

/**
 * Clé d'idempotence stable pour un même contenu : renvoyer la même saisie après une coupure réseau
 * réutilise la clé (pas de double entrée) ; une saisie modifiée en obtient une nouvelle.
 */
export function createKeyring() {
  let last: { payload: string; key: string } | null = null;
  return {
    keyFor(payload: unknown): string {
      const serialized = JSON.stringify(payload);
      if (last?.payload !== serialized) last = { payload: serialized, key: newKey() };
      return last.key;
    },
    reset() {
      last = null;
    },
  };
}
