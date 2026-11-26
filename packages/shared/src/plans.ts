/**
 * Forfaits : quotas et fonctionnalités, la règle appliquée par l'API. Le site (apps/web/config/plans.ts) y ajoute les
 * textes de vente ; les prix sont ici parce que les packs et le changement de forfait les enregistrent.
 *
 * Une « carte publiée » est une offre mise en ligne pour la première fois sur un canal : réviser un prix, mettre à
 * jour une quantité ou remettre en ligne une annonce ne compte pas, et un lot compte pour une seule carte.
 */

export type PlanFeature = "ebay" | "bulk" | "sync" | "suggestions" | "team" | "support";
export const PLAN_FEATURE_IDS: PlanFeature[] = ["ebay", "bulk", "sync", "suggestions", "team", "support"];

export type PlanId = "decouverte" | "solo" | "pro" | "boutique" | "community";

export interface PlanRule {
  id: PlanId;
  name: string;
  /** Prix mensuel en euros ; 0 = gratuit. */
  monthlyPriceEur: number;
  /** Cartes publiées par mois ; null = sans limite. */
  cardsPerMonth: number | null;
  features: PlanFeature[];
  /** Forfait qu'un utilisateur peut choisir lui-même (pas le forfait d'installation). */
  selectable: boolean;
}

export const PLAN_RULES: Record<PlanId, PlanRule> = {
  decouverte: { id: "decouverte", name: "Découverte", monthlyPriceEur: 0, cardsPerMonth: 20, features: ["ebay"], selectable: true },
  solo: { id: "solo", name: "Solo", monthlyPriceEur: 9, cardsPerMonth: 150, features: ["ebay", "bulk", "sync"], selectable: true },
  pro: { id: "pro", name: "Pro", monthlyPriceEur: 29, cardsPerMonth: 750, features: ["ebay", "bulk", "sync", "suggestions"], selectable: true },
  boutique: {
    id: "boutique", name: "Boutique", monthlyPriceEur: 79, cardsPerMonth: 3000,
    features: ["ebay", "bulk", "sync", "suggestions", "team", "support"], selectable: true,
  },
  // Le compte d'installation, et tous les comptes quand les forfaits sont coupés (version Community auto-hébergée).
  community: { id: "community", name: "Community", monthlyPriceEur: 0, cardsPerMonth: null, features: [...PLAN_FEATURE_IDS], selectable: false },
};

export const SELECTABLE_PLANS: PlanId[] = ["decouverte", "solo", "pro", "boutique"];
export const FREE_PLAN_ID: PlanId = "decouverte";

/** Dépassement : un pack de cartes supplémentaires, valable pour le mois en cours. */
export const OVERAGE_PACK = { cards: 500, priceEur: 10 };

export const isPlanId = (v: unknown): v is PlanId => typeof v === "string" && v in PLAN_RULES;

/** Le forfait connu, ou Découverte pour une valeur inattendue. */
export const planRule = (id: string | null | undefined): PlanRule => (isPlanId(id) ? PLAN_RULES[id] : PLAN_RULES[FREE_PLAN_ID]);

/** Le forfait le moins cher qui comprend une fonctionnalité (pour dire à quel forfait passer). */
export const cheapestPlanWith = (feature: PlanFeature): PlanRule =>
  SELECTABLE_PLANS.map((id) => PLAN_RULES[id]).find((p) => p.features.includes(feature))!;

/** Premier jour du mois, heure de Paris, au format AAAA-MM-JJ : la période du quota. */
export function quotaMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-01`;
}

/** Premier jour du mois suivant (AAAA-MM-JJ). */
export function nextQuotaMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
