/**
 * Forfaits du site : les textes de vente (accroche, bouton, mise en avant). Les prix, les quotas, les fonctionnalités et
 * le pack de dépassement sont ceux que l'API applique (@dexlane/shared, plans.ts) : la landing, /tarifs, la FAQ et les
 * mentions « 20 cartes offertes » les lisent d'ici.
 *
 * [À CONFIRMER] : toute la grille (noms des forfaits, prix, quotas, fonctionnalités incluses) et le pack de dépassement.
 */
import { OVERAGE_PACK as PACK_RULE, PLAN_RULES, type PlanFeature, type PlanId } from "@dexlane/shared";

export type { PlanFeature };

/** Lignes de la grille, dans l'ordre d'affichage. */
export const PLAN_FEATURES: { id: PlanFeature; label: string }[] = [
  { id: "ebay", label: "Connexion eBay en 1 clic" },
  { id: "bulk", label: "Publication en masse" },
  { id: "sync", label: "Synchronisation prix et stock" },
  { id: "suggestions", label: "Suggestions de titre et de prix" },
  { id: "team", label: "Plusieurs utilisateurs" },
  { id: "support", label: "Support prioritaire" },
];

export interface Plan {
  id: string;
  name: string;
  /** Prix mensuel en euros ; 0 = gratuit. */
  monthlyPriceEur: number;
  /** Cartes publiées par mois. */
  cardsPerMonth: number;
  /** Photos lues par Claude par mois. */
  scansPerMonth: number;
  pitch: string;
  button: string;
  features: PlanFeature[];
  /** Forfait mis en avant (badge). */
  featured?: boolean;
}

/** Ce que le site dit de chaque forfait ; le reste vient de la règle appliquée. */
const COPY: { id: Exclude<PlanId, "community">; pitch: string; button: string; featured?: boolean }[] = [
  { id: "decouverte", pitch: "Pour tester sur tes vraies cartes", button: "Commencer" },
  { id: "solo", pitch: "Pour écouler ta collection", button: "Choisir Solo" },
  { id: "pro", pitch: "Pour vendre toutes les semaines", button: "Choisir Pro", featured: true },
  { id: "boutique", pitch: "Pour les équipes et les gros stocks", button: "Choisir Boutique" },
];

export const PLANS: Plan[] = COPY.map((copy) => {
  const rule = PLAN_RULES[copy.id];
  return { ...copy, name: rule.name, monthlyPriceEur: rule.monthlyPriceEur, cardsPerMonth: rule.cardsPerMonth!, scansPerMonth: rule.scansPerMonth!, features: rule.features };
});

/** « Le plus choisi » seulement quand ce sera vrai ; d'ici là, « Recommandé ». */
export const FEATURED_BADGE = "Recommandé";

/** Dépassement de forfait : un pack de cartes supplémentaires. */
export const OVERAGE_PACK = PACK_RULE;

/** Le forfait gratuit : ses cartes offertes alimentent le hero et le CTA final. */
export const FREE_PLAN = PLANS.find((p) => p.monthlyPriceEur === 0)!;

/** Code du flyer glissé dans les colis (page /colis) et l'offre qu'il donne. */
export const PARCEL_OFFER = { code: "[À COMPLÉTER]", offer: "[À COMPLÉTER]" };

const NBSP = " ";
export const formatCards = (n: number) => new Intl.NumberFormat("fr-FR").format(n).replace(/ /g, " ");
export const formatEuros = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)}${NBSP}€`;
/** « Gratuit » ou « 9 € / mois ». */
export const formatPlanPrice = (plan: Plan) => (plan.monthlyPriceEur === 0 ? "Gratuit" : `${formatEuros(plan.monthlyPriceEur)} / mois`);

/** Rythme moyen que le quota permet : « ≈ 35 cartes par semaine » (un mois compte 52 / 12 semaines). */
export const formatWeeklyPace = (plan: Plan) => `≈ ${formatCards(Math.round(plan.cardsPerMonth / (52 / 12)))} cartes par semaine`;

/** Coût d'une carte publiée quand le quota est utilisé en entier : « soit 0,06 € la carte » ; null pour le gratuit. */
export function formatPricePerCard(plan: Plan): string | null {
  if (plan.monthlyPriceEur === 0) return null;
  const perCard = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(plan.monthlyPriceEur / plan.cardsPerMonth);
  return `soit ${perCard}${NBSP}€ la carte`;
}

/** Ce qu'un forfait ajoute au précédent dans la grille : la grille courte le présente en « Tout Solo, plus : … ». */
export function planIncrement(plan: Plan): { previous: Plan | null; added: PlanFeature[] } {
  const previous = PLANS[PLANS.indexOf(plan) - 1] ?? null;
  return { previous, added: plan.features.filter((f) => !previous?.features.includes(f)) };
}
