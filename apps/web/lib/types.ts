import type { Candidate, CandidateVariant, CatalogSetCard as SetCard, CatalogSetDetail as SetDetail, CatalogSetSummary, SyncStats } from "@dexlane/catalog";
import type {
  AcquisitionLotRow, CardCondition, InventoryRow, InventorySummary, LocationSummary, MovementRow, OrderDetail as OrderDetailRow, PhotoKind, PhotoRow,
  OrderStage, OrderSummary as OrderSummaryRow, ReceivedBulk, ReceivedPosition, SalesTotals, SellableOffer as SellableOfferRow,
  ShippingMode,
} from "@dexlane/inventory";
import type {
  ChannelId, ChannelMode, ChannelState as ChannelStateRow, ListingBlocker, ListingOffer as ListingOfferRow, ListingSettings,
  ListingState as ListingStateRow, PhotoStyle,
} from "@dexlane/listings";
import type { OfferPricing as PricingRow, PricingSettings, VariantQuote as Quote } from "@dexlane/pricing";
import type { CardReadingRaw, RecognitionUsage } from "@dexlane/scan";

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
export type { PricingSettings };
export type Received = Json<ReceivedPosition> & { pricing: OfferPricing | null };
export type ReceivedBulkLot = Json<ReceivedBulk>;
export type CatalogSet = Json<CatalogSetSummary>;
export type CatalogSetDetail = Json<SetDetail>;
export type CatalogSetCard = Json<SetCard>;
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
