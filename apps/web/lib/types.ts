import type { Candidate, CandidateVariant, CatalogHit as CatalogHitRow, CatalogSetCard as SetCard, CatalogSetDetail as SetDetail, CatalogSetSummary, SyncStats } from "@dexlane/catalog";
import type {
  AcquisitionLotRow, CardCondition, InventoryRow, InventorySummary, LocationSummary, MovementRow, OrderDetail as OrderDetailRow, PhotoKind, PhotoRow,
  OrderStage, OrderSummary as OrderSummaryRow, ReceivedBulk, ReceivedPosition, SalesTotals, SellableOffer as SellableOfferRow,
  ShippingMode, ShippingCosts,
} from "@dexlane/inventory";
import type {
  Activity as ActivityRow, CardDetail as CardDetailRow, ChannelId, ChannelMode, ChannelState as ChannelStateRow, ListingBlocker, ListingOffer as ListingOfferRow, ListingSettings,
  ListingState as ListingStateRow, PhotoStyle, PlanResult, Schedule as ScheduleRow, StockDetail as StockDetailRow, StockFacets, StockPage as StockPageRow, StockRow as StockRowRaw, StockStatus,
} from "@dexlane/listings";
import type {
  AlertSettings, Dashboard as DashboardRow, OfferPricing as PricingRow, PriceMove as PriceMoveRow, PriceMoves as PriceMovesRow, PricingSettings,
  Deal as DealRow, PriceHistory as PriceHistoryRow, TopCard as TopCardRow, VariantQuote as Quote, WatchedCard as WatchedCardRow,
} from "@dexlane/pricing";
import type { CardReadingRaw, RecognitionUsage, ScanBatch as ScanBatchRow, ScanItem as ScanItemRow } from "@dexlane/scan";

/** Forme d'un objet du serveur une fois passé par JSON (les dates deviennent des chaînes). */
type Json<T> = T extends Date ? string : T extends (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;

export type { Candidate, CandidateVariant, CardCondition, InventorySummary };
export type Position = Json<InventoryRow>;
export type Photo = Json<PhotoRow>;
export type PositionDetail = Position & { movements: Json<MovementRow>[]; photos: Photo[] };
/** Photo déposée dans le stockage, pas encore rattachée à une position. */
export interface StoredPhoto {
  id: string;
  url: string;
  kind: PhotoKind;
}
export type Movement = Json<MovementRow>;
export type Location = Json<LocationSummary>;
export type AcquisitionLot = Json<AcquisitionLotRow>;
export type OfferPricing = Json<PricingRow>;
export type VariantQuote = Json<Quote>;
export type PriceHistory = Json<PriceHistoryRow>;
export type WatchedCard = Json<WatchedCardRow>;
export type Deal = Json<DealRow>;
export type TopCard = Json<TopCardRow>;
/** Une variante trouvée par la recherche libre, avec son prix et son suivi éventuel. */
export type CatalogHit = Json<CatalogHitRow> & { estimate: VariantEstimate | null; watchedId: string | null };
export interface DealList { deals: Deal[]; examined: number; freshDays: number; minCents: number; minDiscount: number }
/** Estimation d'après les ventes réussies, telle que l'API la sert partout (stock, prix, catalogue, saisie). */
export interface SalesEstimate { cents: number; confidence: "HIGH" | "MEDIUM" | "LOW"; sales: { quoteType: string; amountCents: number }[] }
export type { PricingSettings };
export type Received = Json<ReceivedPosition> & { pricing: OfferPricing | null };
export type ReceivedBulkLot = Json<ReceivedBulk>;
export type CatalogSet = Json<CatalogSetSummary>;
/** Prix du marché d'une variante : d'après les ventes réussies, ou les annonces quand `sales` est null. */
export interface VariantEstimate { cents: number; sales: SalesEstimate | null; observedAt: string; variantAmbiguous: boolean }
type SetCardJson = Json<SetCard>;
export type CatalogSetCard = Omit<SetCardJson, "variants"> & { variants: (SetCardJson["variants"][number] & { estimate: VariantEstimate | null })[] };
export type CatalogSetDetail = Omit<Json<SetDetail>, "cards"> & { cards: CatalogSetCard[] };
export type SetSyncReport = SyncStats & { errorCount: number };

export interface ScanResult {
  /** Photo conservée ; null si aucun stockage n'est configuré. */
  photo: StoredPhoto | null;
  requiresReview: boolean;
  reviewReasons: string[];
  ambiguous: boolean;
  language: string;
  reading: CardReadingRaw;
  candidates: Candidate[];
  suggestedVariantId: string | null;
  model: { requested: string; servedBy: string };
  usage: RecognitionUsage;
  latencyMs: number;
}

export interface InventoryPage {
  items: Position[];
  total: number;
  limit: number;
  offset: number;
}

export const CONDITIONS: { code: CardCondition; label: string }[] = [
  { code: "MT", label: "Mint" },
  { code: "NM", label: "Near Mint" },
  { code: "EX", label: "Excellent" },
  { code: "GD", label: "Good" },
  { code: "LP", label: "Light Played" },
  { code: "PL", label: "Played" },
  { code: "PO", label: "Poor" },
];

export type { OrderStage, SalesTotals, ShippingMode };
export type OrderSummary = Json<OrderSummaryRow>;
export type OrderDetail = Json<OrderDetailRow>;
export type SellableOffer = Json<SellableOfferRow>;
export interface OrderList {
  items: OrderSummary[];
  counts: Record<OrderStage, number>;
  last30Days: SalesTotals;
}

export type { ChannelId, ChannelMode, ListingBlocker, ListingSettings, PhotoStyle };
export type ChannelState = Json<ChannelStateRow>;
export type ListingState = Json<ListingStateRow>;
export type ListingOffer = Json<ListingOfferRow>;

export type { AlertSettings };
export type Dashboard = Json<DashboardRow>;
export type PriceMove = Json<PriceMoveRow>;
export type PriceMoves = Json<PriceMovesRow>;

export type { StockStatus };
export type StockRow = Json<StockRowRaw>;
export type StockPage = Json<StockPageRow>;
export type { StockFacets };
export type StockDetail = Json<StockDetailRow>;

export type ScanBatch = Json<ScanBatchRow>;
export type ScanItem = Json<ScanItemRow>;

export type { PlanResult };
export type Schedule = Json<ScheduleRow>;
export type Activity = Json<ActivityRow>;
/** Fiche d'une carte : chaque variante avec ses prix sur chaque plateforme et son suivi éventuel. */
export type CardPage = Omit<Json<CardDetailRow>, "variants"> & {
  variants: (Json<CardDetailRow>["variants"][number] & {
    prices: Pick<WatchedCard, "cardmarket" | "tcgplayer">;
    watched: { id: string; targetCents: number | null } | null;
  })[];
};

/** Papier des bons de livraison et reçus. */
export type SlipPaper = "ROLL_80" | "ROLL_58" | "LABEL_100X150" | "A4";
export interface Seller { name: string; address: string; legal: string }
export interface AppSettings {
  onboardingDone: boolean;
  intakeMode: "SCANNER" | "CAMERA" | "FILES" | null;
  slipPaper: SlipPaper;
  seller: Seller;
}
/** Préparation des envois : les commandes à préparer et ce qu'il faut pour imprimer leurs bons. */
export interface ShippingRun { orders: OrderDetail[]; seller: Seller; slipPaper: SlipPaper }

export type { ShippingCosts };
