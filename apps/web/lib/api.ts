import type {
  AcquisitionLot, Activity, AlertSettings, AppSettings, Candidate, CardCondition, CatalogSet, ChannelId, Dashboard, PriceMoves, ChannelMode, ChannelState, ListingState, CatalogSetDetail, InventoryPage, InventorySummary, ListingOffer, ListingSettings,
  Location, Photo, PositionDetail, Received,
  OfferPricing, OrderDetail, PriceHistory, OrderList, OrderStage, PricingSettings, ShippingRun, ReceivedBulkLot, ScanResult, SellableOffer, SetSyncReport,
  PlanResult, ScanBatch, ScanItem, Schedule, ShippingMode, StockDetail, StockPage, StockStatus, StoredPhoto, VariantQuote,
} from "./types";

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
    throw new ApiError(0, "NETWORK", "Connexion impossible. Vérifiez le réseau puis réessayez.");
  }
  if (res.status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new ApiError(401, "UNAUTHORIZED", "Session expirée.");
  }
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? "HTTP_ERROR", e?.message ?? `Erreur ${res.status}`, e?.details);
  }
  return data as T;
}

/** Routes de session du serveur web (/auth), hors relais d'API. */
async function auth<T = { ok: true }>(method: "GET" | "POST" | "PUT", body?: unknown): Promise<T> {
  const res = await fetch("/auth", {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!res) throw new ApiError(0, "NETWORK", "Connexion impossible. Vérifiez le réseau puis réessayez.");
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "HTTP_ERROR", data?.error?.message ?? `Erreur ${res.status}`, data?.error?.details);
  return data as T;
}

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
  scan: (image: Blob, language: string) => request<ScanResult>("POST", "/scans", { blob: image, query: { language } }),
  uploadPhoto: (image: Blob, kind: "SCAN_FRONT" | "SCAN_BACK" | "BACKGROUND" | "PROMO") => request<StoredPhoto>("POST", "/photos", { blob: image, query: { kind } }),
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
  saveAppSettings: (change: Partial<AppSettings>) => request<AppSettings>("PUT", "/app-settings", { json: change }),

  schedule: () => request<Schedule>("GET", "/publications"),
  planPublications: (input: { offerIds?: string[]; channel: ChannelId; startOn: string; perDay: number }) =>
    request<PlanResult>("POST", "/publications/plan", { json: input }),
  cancelPublications: (filter: { plannedOn?: string; channel?: ChannelId; offerId?: string }) =>
    request<{ cancelled: number }>("POST", "/publications/cancel", { json: filter }),
  runPublications: () => request<{ published: number; failed: number }>("POST", "/publications/run"),

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

  stock: (q: { q?: string; status?: StockStatus | "ALL"; sort?: "value" | "recent" | "name"; limit?: number; offset?: number }) =>
    request<StockPage>("GET", "/stock", { query: q }),
  stockDetail: (offerId: string) => request<StockDetail>("GET", `/stock/${offerId}`),

  dashboard: () => request<Dashboard>("GET", "/stats/dashboard"),
  activity: () => request<Activity>("GET", "/stats/activity"),
  priceMoves: (alertsOnly: boolean) => request<PriceMoves>("GET", "/stats/price-moves", { query: { alerts: String(alertsOnly) } }),
  saveAlertSettings: (settings: AlertSettings) => request<AlertSettings>("PUT", "/stats/alert-settings", { json: settings }),
  refreshPrices: () => request<{ cards: number; pricesInserted: number; errors: number; remaining: number; repriced: number }>("POST", "/prices/refresh"),

  channels: () => request<{ channels: ChannelState[] }>("GET", "/channels"),
  setChannelMode: (channel: ChannelId, mode: ChannelMode) => request<{ channels: ChannelState[] }>("PUT", `/channels/${channel}`, { json: { mode } }),
  syncChannels: () => request<{ orders: number; updated: number; errors: number }>("POST", "/channels/sync"),
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
  orders: (stage?: OrderStage) => request<OrderList>("GET", "/orders", { query: { stage } }),
  order: (id: string) => request<OrderDetail>("GET", `/orders/${id}`),
  shippingRun: () => request<ShippingRun>("GET", "/orders/preparation"),
  markSlipsPrinted: (orderIds: string[]) => request<{ marked: number }>("POST", "/orders/preparation/printed", { json: { orderIds } }),
  createSale: (
    input: { lines: { offerId: string; qty: number; unitPriceCents: number }[]; shippingMode: ShippingMode; shippingChargedCents?: number; buyerName?: string; addressLines?: string[]; note?: string },
    key: string,
  ) => request<OrderDetail>("POST", "/orders", { json: input, idempotencyKey: key }),
  pickAllocation: (orderId: string, allocationId: string, unitSku: string) =>
    request<OrderDetail>("POST", `/orders/${orderId}/pick`, { json: { allocationId, unitSku } }),
  packOrder: (orderId: string) => request<OrderDetail>("POST", `/orders/${orderId}/pack`),
  handOver: (orderId: string, input: { tracking?: string; postageCostCents?: number }) =>
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
  login: (password: string) => auth("POST", { password }),
  /** Première connexion ou mot de passe oublié : le jeton d'installation autorise à définir le mot de passe. */
  setPassword: (setupToken: string, newPassword: string) => auth("POST", { setupToken, newPassword }),
  changePassword: (currentPassword: string, newPassword: string) => auth("PUT", { currentPassword, newPassword }),
  logout: () => fetch("/auth", { method: "DELETE" }),
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
