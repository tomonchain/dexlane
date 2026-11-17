import type {
  AcquisitionLot, Candidate, CardCondition, CatalogSet, InventoryPage, InventorySummary, Location, PositionDetail, Received,
  ReceivedBulkLot, ScanResult, SetSyncReport,
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

async function request<T>(method: "GET" | "POST", path: string, opts: RequestOptions = {}): Promise<T> {
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
  searchCatalog: (q: { language: string; name?: string; number?: string; set?: string }) =>
    request<{ candidates: Candidate[] }>("GET", "/catalog/cards", { query: q }),

  catalogSets: (language: string) => request<{ sets: CatalogSet[] }>("GET", "/catalog/sets", { query: { language } }),
  refreshCatalogSets: (language: string) => request<{ count: number }>("POST", "/catalog/sets/refresh", { json: { language } }),
  syncCatalogSet: (setId: string, language: string) =>
    request<SetSyncReport>("POST", `/catalog/sets/${encodeURIComponent(setId)}/sync`, { json: { language } }),

  locations: () => request<{ locations: Location[] }>("GET", "/locations"),
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

  login: async (token: string) => {
    const res = await fetch("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    if (!res) throw new ApiError(0, "NETWORK", "Connexion impossible. Vérifiez le réseau puis réessayez.");
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
      throw new ApiError(res.status, data?.error?.code ?? "HTTP_ERROR", data?.error?.message ?? `Erreur ${res.status}`);
    }
  },
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
