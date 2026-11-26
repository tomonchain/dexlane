import { referral } from "./config/progression";
import type { RecapData } from "./recap";

/**
 * Ce qui figure sur l'image de partage d'un récap (#85). Rien n'est partagé sans l'action de l'utilisateur ; par défaut,
 * aucun montant : cartes vendues, temps gagné, nombre de succès et niveau. Aucune image de carte : les noms de cartes en
 * texte seulement. Le rendu (polices embarquées, sans service externe) est fait par l'application web.
 *
 * Module sans accès à la base : l'application web l'importe tel quel (`@dexlane/insights/share`).
 */

export const SHARE_FORMATS = {
  /** Publication (portrait 4:5). */
  post: { width: 1080, height: 1350 },
  /** Story (9:16). */
  story: { width: 1080, height: 1920 },
} as const;
export type ShareFormat = keyof typeof SHARE_FORMATS;
export const isShareFormat = (v: string): v is ShareFormat => v in SHARE_FORMATS;

export interface ShareOptions {
  format: ShareFormat;
  /** « Afficher mon chiffre d'affaires » : désactivé par défaut. */
  showRevenue: boolean;
  /** « Ajouter mon lien de parrainage » : activé par défaut si le parrainage est actif. */
  showReferral: boolean;
  /** Nom de la boutique : désactivé par défaut. */
  showShopName: boolean;
}

export const defaultShareOptions = (format: ShareFormat = "post"): ShareOptions => ({
  format, showRevenue: false, showReferral: referral.enabled, showShopName: false,
});

export type ShareMetric =
  | { key: "cardsSold"; value: number }
  | { key: "timeSaved"; minutes: number }
  | { key: "achievements"; value: number }
  | { key: "level"; value: number }
  | { key: "revenue"; amounts: { currency: string; cents: number }[] };

export interface ShareCard {
  width: number;
  height: number;
  period: string;
  kind: "month" | "year";
  shopName: string | null;
  metrics: ShareMetric[];
  /** Nom de la meilleure vente, en texte ; son prix seulement si le chiffre d'affaires est affiché. */
  bestSale: { name: string; unitPriceCents: number | null; currency: string } | null;
  /** Lien `/r/{CODE}`, si l'option est activée et le parrainage actif. */
  referralLink: string | null;
}

export function shareCardModel(
  recap: RecapData,
  options: ShareOptions,
  context: { shopName?: string | null; showProgression: boolean; referralLink?: string | null },
): ShareCard {
  const size = SHARE_FORMATS[options.format];
  const metrics: ShareMetric[] = [
    { key: "cardsSold", value: recap.cardsSold },
    { key: "timeSaved", minutes: recap.timeSavedMinutes },
  ];
  // « Afficher le niveau et les succès » désactivé : rien de la progression ne sort non plus sur l'image.
  if (context.showProgression) {
    // Zéro succès ne se partage pas : la ligne n'apparaît qu'à partir d'un.
    if (recap.achievementsCount > 0) metrics.push({ key: "achievements", value: recap.achievementsCount });
    if (recap.level.level > 0) metrics.push({ key: "level", value: recap.level.level });
  }
  if (options.showRevenue && recap.revenue.length > 0) metrics.push({ key: "revenue", amounts: recap.revenue });
  return {
    ...size,
    period: recap.period,
    kind: recap.kind,
    shopName: options.showShopName && context.shopName?.trim() ? context.shopName.trim() : null,
    metrics,
    bestSale: recap.bestSale
      ? { name: recap.bestSale.name, unitPriceCents: options.showRevenue ? recap.bestSale.unitPriceCents : null, currency: recap.bestSale.currency }
      : null,
    referralLink: options.showReferral && referral.enabled && context.referralLink ? context.referralLink : null,
  };
}
