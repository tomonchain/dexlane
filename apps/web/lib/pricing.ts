import type { PricingSettings } from "./types";

export type Category = "BULK" | "LOT" | "SINGLE" | "PREMIUM" | "REVIEW";

export const CATEGORY_LABEL: Record<Category, string> = {
  BULK: "Vrac", LOT: "Lot", SINGLE: "À l'unité", PREMIUM: "Premium", REVIEW: "À revoir",
};
export const CATEGORY_VARIANT: Record<Category, "neutral" | "outline" | "brand" | "success" | "warning"> = {
  BULK: "neutral", LOT: "outline", SINGLE: "brand", PREMIUM: "success", REVIEW: "warning",
};
export const DECIDABLE_CATEGORIES: Exclude<Category, "REVIEW">[] = ["BULK", "LOT", "SINGLE", "PREMIUM"];

export const REASON_LABEL: Record<string, string> = {
  NO_REFERENCE: "Aucune cotation pour cette variante",
  STALE_REFERENCE: "Cotation trop ancienne",
  AMBIGUOUS_REFERENCE: "Cotation partagée avec une autre variante",
  VARIANT_INCOMPLETE: "Variante à confirmer dans le catalogue",
  GREY_ZONE: "Entre lot et vente à l'unité : à vous de décider",
  BELOW_COST: "Le prix ne couvre pas le coût d'achat",
  PREMIUM_NOT_UNIQUE: "Valeur premium : à vendre en exemplaire unique",
  DRIFT: "Le marché a bougé depuis votre prix",
};
export const reasonLabel = (code: string) => REASON_LABEL[code] ?? code;

export const QUOTE_LABEL: Record<string, string> = {
  LISTED_TREND: "Tendance", SOLD_AVG_30D: "Ventes 30 j", SOLD_AVG_7D: "Ventes 7 j", LISTED_LOW: "Prix le plus bas",
};
export const quoteLabel = (type: string) => QUOTE_LABEL[type] ?? type;

/** Catégorie que donnent les seuils pour un prix, sans tenir compte des motifs de revue (même règle que le serveur). */
export function tierOf(priceCents: number, s: PricingSettings): Exclude<Category, "REVIEW"> {
  if (priceCents < s.bulkBelowCents) return "BULK";
  if (priceCents < s.lotBelowCents) return "LOT";
  if (priceCents < s.premiumFromCents) return "SINGLE";
  return "PREMIUM";
}

const DAY_MS = 24 * 3600 * 1000;
/** « aujourd'hui », « hier », « il y a 12 j ». */
export function age(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS));
  return days === 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} j`;
}

/** Montant en euros pour un champ de saisie : « 12,50 ». */
export const eurosInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
