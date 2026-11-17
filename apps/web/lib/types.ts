import type { Candidate, CandidateVariant } from "@dexlane/catalog";
import type {
  AcquisitionLotRow, CardCondition, InventoryRow, LocationSummary, MovementRow, ReceivedBulk, ReceivedPosition,
} from "@dexlane/inventory";
import type { CardReadingRaw, RecognitionUsage } from "@dexlane/scan";

/** Forme d'un objet du serveur une fois passé par JSON (les dates deviennent des chaînes). */
type Json<T> = T extends Date ? string : T extends (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;

export type { Candidate, CandidateVariant, CardCondition };
export type Position = Json<InventoryRow>;
export type PositionDetail = Position & { movements: Json<MovementRow>[] };
export type Movement = Json<MovementRow>;
export type Location = Json<LocationSummary>;
export type AcquisitionLot = Json<AcquisitionLotRow>;
export type Received = Json<ReceivedPosition>;
export type ReceivedBulkLot = Json<ReceivedBulk>;

export interface ScanResult {
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
