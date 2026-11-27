import { ApiError } from "./api";
import { t } from "./i18n";
import type { Carrier, OrderStage, ShippingMode } from "./types";

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
  INSUFFICIENT_STOCK: "Le stock disponible ne suffit plus pour cette vente. Vérifie les quantités.",
  WRONG_ITEM: "Ce code correspond à une autre carte que celle vendue.",
  UNKNOWN_SKU: "Aucune position ne porte ce code.",
  SCANNED_POSITION_UNAVAILABLE: "Cette position n'a pas d'exemplaire libre pour cette vente.",
  NOT_FULLY_PICKED: "Toutes les cartes doivent être prélevées avant l'emballage.",
  NOT_FULLY_PACKED: "La vente doit être emballée avant la remise.",
  TRACKING_REQUIRED: "Un envoi suivi a besoin de son numéro de suivi.",
  ALREADY_SHIPPED: "Cette vente est déjà remise : elle ne peut plus être annulée.",
};
export const salesMessage = (e: unknown) => (e instanceof ApiError ? (ERRORS[e.code] ? t(ERRORS[e.code]!) : e.message) : (e as Error).message);

export const CARRIER_LABEL: Record<Carrier, string> = { LA_POSTE: "La Poste / Colissimo", MONDIAL_RELAY: "Mondial Relay", OTHER: "Autre" };
export const CARRIERS = Object.keys(CARRIER_LABEL) as Carrier[];

/** Même règle que le serveur : La Poste (13 caractères ou format international), Mondial Relay (8 à 12 chiffres). */
export function detectCarrier(tracking: string): Carrier | null {
  const code = tracking.replace(/\s+/g, "").toUpperCase();
  if (!code) return null;
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code) || (/^[0-9A-Z]{13}$/.test(code) && /[A-Z]/.test(code) && /\d{8,}/.test(code))) return "LA_POSTE";
  if (/^\d{8,12}$/.test(code)) return "MONDIAL_RELAY";
  return null;
}

/** Page de suivi publique du transporteur. */
export function trackingUrl(carrier: Carrier | null, tracking: string, addressLines: string[] = []): string | null {
  if (carrier === "LA_POSTE") return `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(tracking)}`;
  if (carrier === "MONDIAL_RELAY") {
    const postcode = addressLines.join(" ").match(/\b\d{5}\b/)?.[0];
    return `https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=${encodeURIComponent(tracking)}${postcode ? `&codePostal=${postcode}` : ""}`;
  }
  return null;
}

export const DELIVERY_LABEL: Record<string, string> = {
  HANDED_OVER: "Déposée", IN_TRANSIT: "En route", DELIVERED: "Livrée", RETURNED: "Retournée", LOST: "Perdue",
};
export const DELIVERY_VARIANT: Record<string, "outline" | "brand" | "success" | "destructive"> = {
  HANDED_OVER: "outline", IN_TRANSIT: "brand", DELIVERED: "success", RETURNED: "destructive", LOST: "destructive",
};

/** Message de demande d'avis : celui des réglages, ou le message par défaut ; {acheteur} et {boutique} remplacés. */
export function reviewMessage(template: string, buyer: string | null, shop: string): string {
  const base = template.trim() || t("Bonjour {acheteur},\n\nVotre commande est bien arrivée ? J'espère que les cartes vous plaisent ! Si tout vous convient, un petit avis m'aiderait beaucoup.\n\nMerci et à bientôt,\n{boutique}");
  return base.replaceAll("{acheteur}", buyer ?? "").replaceAll("{boutique}", shop).replace(/Bonjour ,/g, "Bonjour,").replace(/Hello ,/g, "Hello,");
}
