/**
 * Forfaits, prix et quotas : le seul endroit où ils sont écrits. La landing (grille courte), la page /tarifs, la FAQ
 * et les mentions « 20 cartes offertes » lisent ce fichier.
 *
 * [À CONFIRMER] : toute la grille (noms des forfaits, prix, quotas, fonctionnalités incluses) et le pack de dépassement.
 */

export type PlanFeature = "ebay" | "bulk" | "sync" | "suggestions" | "team" | "support";

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
  pitch: string;
  button: string;
  features: PlanFeature[];
  /** Forfait mis en avant (badge). */
  featured?: boolean;
}

export const PLANS: Plan[] = [
  { id: "decouverte", name: "Découverte", monthlyPriceEur: 0, cardsPerMonth: 20, pitch: "Pour tester sur tes vraies cartes", button: "Commencer", features: ["ebay"] },
  { id: "solo", name: "Solo", monthlyPriceEur: 9, cardsPerMonth: 150, pitch: "Pour écouler ta collection", button: "Choisir Solo", features: ["ebay", "bulk", "sync"] },
  {
    id: "pro", name: "Pro", monthlyPriceEur: 29, cardsPerMonth: 750, pitch: "Pour vendre toutes les semaines", button: "Choisir Pro",
    features: ["ebay", "bulk", "sync", "suggestions"], featured: true,
  },
  {
    id: "boutique", name: "Boutique", monthlyPriceEur: 79, cardsPerMonth: 3000, pitch: "Pour les équipes et les gros stocks", button: "Choisir Boutique",
    features: ["ebay", "bulk", "sync", "suggestions", "team", "support"],
  },
];

/** « Le plus choisi » seulement quand ce sera vrai ; d'ici là, « Recommandé ». */
export const FEATURED_BADGE = "Recommandé";

/** Dépassement de forfait : un pack de cartes supplémentaires. */
export const OVERAGE_PACK = { cards: 500, priceEur: 10 };

/** Le forfait gratuit : ses cartes offertes alimentent le hero et le CTA final. */
export const FREE_PLAN = PLANS.find((p) => p.monthlyPriceEur === 0)!;

/** Code du flyer glissé dans les colis (page /colis) et l'offre qu'il donne. */
export const PARCEL_OFFER = { code: "[À COMPLÉTER]", offer: "[À COMPLÉTER]" };

const NBSP = " ";
export const formatCards = (n: number) => new Intl.NumberFormat("fr-FR").format(n).replace(/ /g, " ");
export const formatEuros = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)}${NBSP}€`;
/** « Gratuit » ou « 9 € / mois ». */
export const formatPlanPrice = (plan: Plan) => (plan.monthlyPriceEur === 0 ? "Gratuit" : `${formatEuros(plan.monthlyPriceEur)} / mois`);
