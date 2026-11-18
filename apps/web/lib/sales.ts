import { ApiError } from "./api";
import type { OrderStage, ShippingMode } from "./types";

export const SHIPPING_LABEL: Record<ShippingMode, string> = {
  LETTER_UNTRACKED: "Lettre non suivie",
  LETTER_TRACKED: "Lettre suivie",
  PARCEL_TRACKED: "Colis suivi",
  HAND_DELIVERY: "Remise en main propre",
};
export const SHIPPING_MODES = Object.keys(SHIPPING_LABEL) as ShippingMode[];
export const needsTracking = (mode: ShippingMode) => mode === "LETTER_TRACKED" || mode === "PARCEL_TRACKED";

export const STAGE_LABEL: Record<OrderStage, string> = {
  TO_PREPARE: "À préparer", PACKED: "Emballée", SHIPPED: "Remise", CANCELLED: "Annulée",
};
export const STAGE_VARIANT: Record<OrderStage, "warning" | "brand" | "success" | "outline"> = {
  TO_PREPARE: "warning", PACKED: "brand", SHIPPED: "success", CANCELLED: "outline",
};

const ERRORS: Record<string, string> = {
  INSUFFICIENT_STOCK: "Le stock disponible ne suffit plus pour cette vente. Vérifiez les quantités.",
  WRONG_ITEM: "Ce code correspond à une autre carte que celle vendue.",
  UNKNOWN_SKU: "Aucune position ne porte ce code.",
  SCANNED_POSITION_UNAVAILABLE: "Cette position n'a pas d'exemplaire libre pour cette vente.",
  NOT_FULLY_PICKED: "Toutes les cartes doivent être prélevées avant l'emballage.",
  NOT_FULLY_PACKED: "La vente doit être emballée avant la remise.",
  TRACKING_REQUIRED: "Un envoi suivi a besoin de son numéro de suivi.",
  ALREADY_SHIPPED: "Cette vente est déjà remise : elle ne peut plus être annulée.",
};
export const salesMessage = (e: unknown) => (e instanceof ApiError ? (ERRORS[e.code] ?? e.message) : (e as Error).message);
