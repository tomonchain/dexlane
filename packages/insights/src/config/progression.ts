/**
 * Configuration des statistiques, du parcours de démarrage, des récaps, du niveau et des succès (#83 à #86).
 *
 * Toutes les valeurs réglables sont ici. Les textes sont en français, langue source de l'interface : l'application web
 * les traduit (`t()`), et le contrôle des traductions (`pnpm --filter @dexlane/web test`) vérifie qu'ils ont tous leur
 * traduction anglaise.
 *
 * Principe : la progression récompense des résultats réels (des ventes confirmées, un stock bien tenu). Une annonce
 * publiée ne donne aucun point, et il n'y a aucune série quotidienne.
 */

/** Temps gagné estimé par annonce publiée via Dexlane, par rapport à une saisie manuelle sur eBay. */
export const minutesSavedPerListing = 4;

/** Une carte en ligne depuis plus longtemps que ça, sans vente, est dormante. */
export const dormantAfterDays = 90;

/** À partir de ce nombre de cartes dormantes, l'accueil le rappelle. */
export const dormantReminderThreshold = 10;

/** Délai avant qu'une vente compte pour le niveau et les succès (retours, annulations, remboursements). */
export const saleConfirmationDays = 14;

/** Ventes confirmées cumulées pour atteindre les niveaux 1 à 10. */
export const levelThresholds = [0, 10, 50, 150, 400, 1000, 2500, 6000, 15000, 40000] as const;

/**
 * Noms des niveaux. [À CONFIRMER] : tant qu'ils ne sont pas choisis, la liste est vide et l'interface affiche
 * « Niveau N ».
 */
export const levelNames: readonly string[] = [];

/** Semaines consécutives (semaines ISO, fuseau de l'utilisateur) pour le succès de régularité. */
export const weeklyStreakTarget = 8;

/** Fuseau horaire par défaut des calculs. */
export const defaultTimezone = "Europe/Paris";

/**
 * Pays du vendeur, pour le succès « Export », quand le site eBay choisi ne le dit pas. Le site eBay (EBAY_FR, EBAY_DE…)
 * prime.
 */
export const defaultSellerCountry = "FR";

/**
 * Les frais eBay d'une vente ne sont pas encore synchronisés (`order_lines.fee_allocated_cents` reste à 0) : la marge
 * s'affiche sans eux, avec la mention « Frais eBay non inclus ». À passer à `true` quand l'import des commandes les
 * renseignera.
 */
export const ebayFeesSynced = false;

/**
 * Parrainage : pas encore en place dans Dexlane. Tant qu'il ne l'est pas, ni le récap ni l'image de partage ne
 * proposent de lien `/r/{CODE}`, et les succès de parrainage restent verrouillés.
 */
export const referral = { enabled: false, minDaysBeforeSuggestion: 30 } as const;

/** [À CONFIRMER] E-mail du récap mensuel activé par défaut pour chaque utilisateur. */
export const recapEmailDefault = true;

// ───────────────────────── Avantages par niveau ─────────────────────────

export type LevelPerk =
  /** Accès anticipé aux fonctionnalités en test (feature flag `beta`). */
  | { kind: "beta" }
  /** Cartes de bonus sur le mois en cours, par le quota de publication (version hébergée seulement). */
  | { kind: "bonusCards"; cards: number };

/**
 * Appliqués une seule fois, à l'atteinte du niveau. Jamais de réduction permanente. Les bonus de cartes n'existent que
 * là où les forfaits s'appliquent (version hébergée) ; en Community, seul l'accès anticipé s'applique.
 */
export const levelPerks: Readonly<Record<number, readonly LevelPerk[]>> = {
  3: [{ kind: "beta" }],
  5: [{ kind: "bonusCards", cards: 100 }],
  7: [{ kind: "bonusCards", cards: 300 }],
};

// ───────────────────────── Parcours de démarrage ─────────────────────────

export type OnboardingStepId = "ebay" | "policies" | "stock" | "listing" | "locations" | "sale" | "slip";

export interface OnboardingStepDef {
  id: OnboardingStepId;
  title: string;
  /** Le bouton qui mène à l'action. */
  action: string;
  href: string;
}

/** Les sept étapes, détectées d'après les données, jamais cochées à la main. */
export const onboardingSteps: readonly OnboardingStepDef[] = [
  { id: "ebay", title: "Connecter ton compte eBay", action: "Connecter eBay", href: "/settings/channels/ebay" },
  { id: "policies", title: "Renseigner tes conditions d'expédition, de paiement et de retour sur eBay", action: "Choisir mes conditions", href: "/settings/channels/ebay" },
  { id: "stock", title: "Ajouter 10 cartes à ton stock", action: "Ajouter des cartes", href: "/add" },
  { id: "listing", title: "Publier ta première carte", action: "Mettre en ligne", href: "/listings" },
  { id: "locations", title: "Donner un emplacement à toutes tes cartes en stock", action: "Ranger mes cartes", href: "/stock" },
  { id: "sale", title: "Faire ta première vente", action: "Voir mes annonces", href: "/listings" },
  { id: "slip", title: "Imprimer ton premier bordereau", action: "Préparer les envois", href: "/sales/preparation" },
];

/** Cartes à avoir ajoutées pour l'étape « stock ». */
export const onboardingStockTarget = 10;

// ───────────────────────── Succès ─────────────────────────

export type AchievementCategory = "start" | "sales" | "quality" | "speed" | "regularity" | "referral";

export const achievementCategories: readonly { id: AchievementCategory; label: string }[] = [
  { id: "start", label: "Démarrage" },
  { id: "sales", label: "Ventes" },
  { id: "quality", label: "Qualité" },
  { id: "speed", label: "Vitesse" },
  { id: "regularity", label: "Régularité" },
  { id: "referral", label: "Parrainage" },
];

/** Condition d'un succès, évaluée par le calcul de progression d'après le journal et les tables métier. */
export type AchievementCondition =
  | { kind: "onboardingComplete" }
  | { kind: "listingsPublished"; atLeast: number }
  | { kind: "allStockLocated"; minCards: number }
  | { kind: "confirmedSales"; atLeast: number }
  | { kind: "confirmedGradedSale" }
  | { kind: "confirmedExportSale" }
  /** `days` jours consécutifs avec au moins `minPerDay` annonces publiées et aucune en échec. */
  | { kind: "flawlessDays"; days: number; minPerDay: number }
  /** `count` annonces publiées avec succès en moins de `withinMinutes` minutes. */
  | { kind: "publishBurst"; count: number; withinMinutes: number }
  /** Au moins une annonce publiée chaque semaine ISO pendant `weeks` semaines consécutives. */
  | { kind: "weeklyStreak"; weeks: number }
  | { kind: "referralsQualified"; atLeast: number }
  | { kind: "referralFullDiscount" };

export interface AchievementDef {
  id: string;
  /** [À CONFIRMER] Noms de travail. */
  name: string;
  description: string;
  category: AchievementCategory;
  condition: AchievementCondition;
}

export const achievements: readonly AchievementDef[] = [
  { id: "account_ready", name: "Compte prêt", description: "Les 7 étapes du démarrage faites", category: "start", condition: { kind: "onboardingComplete" } },
  { id: "first_listing", name: "Première mise en ligne", description: "1 annonce publiée avec succès", category: "start", condition: { kind: "listingsPublished", atLeast: 1 } },
  { id: "all_stored", name: "Tout est rangé", description: "Toutes les cartes en stock ont un emplacement, avec au moins 50 cartes en stock", category: "start", condition: { kind: "allStockLocated", minCards: 50 } },
  { id: "first_sale", name: "Première vente", description: "1 vente confirmée", category: "sales", condition: { kind: "confirmedSales", atLeast: 1 } },
  { id: "sales_100", name: "Cent", description: "100 ventes confirmées", category: "sales", condition: { kind: "confirmedSales", atLeast: 100 } },
  { id: "sales_1000", name: "Mille", description: "1 000 ventes confirmées", category: "sales", condition: { kind: "confirmedSales", atLeast: 1000 } },
  { id: "sales_10000", name: "Dix mille", description: "10 000 ventes confirmées", category: "sales", condition: { kind: "confirmedSales", atLeast: 10000 } },
  { id: "graded_sale", name: "Carte gradée", description: "1 vente confirmée d'une carte gradée", category: "sales", condition: { kind: "confirmedGradedSale" } },
  { id: "export", name: "Export", description: "1 vente confirmée livrée dans un autre pays que le tien", category: "sales", condition: { kind: "confirmedExportSale" } },
  { id: "flawless", name: "Sans faute", description: "30 jours consécutifs avec au moins 20 annonces publiées et aucune en erreur", category: "quality", condition: { kind: "flawlessDays", days: 30, minPerDay: 20 } },
  { id: "record_session", name: "Session record", description: "100 annonces publiées avec succès en moins d'une heure", category: "speed", condition: { kind: "publishBurst", count: 100, withinMinutes: 60 } },
  { id: "regular", name: "Régulier", description: "Au moins une annonce publiée chaque semaine pendant 8 semaines consécutives", category: "regularity", condition: { kind: "weeklyStreak", weeks: weeklyStreakTarget } },
  { id: "first_referral", name: "Premier filleul", description: "1 filleul qualifié", category: "referral", condition: { kind: "referralsQualified", atLeast: 1 } },
  { id: "free_dexlane", name: "Dexlane offert", description: "Remise de parrainage à 100 % sur une facture", category: "referral", condition: { kind: "referralFullDiscount" } },
];

/** Tous les textes de cette configuration affichés dans l'interface (contrôle des traductions). */
export const progressionTexts = (): string[] => [
  ...onboardingSteps.flatMap((s) => [s.title, s.action]),
  ...achievementCategories.map((c) => c.label),
  ...achievements.flatMap((a) => [a.name, a.description]),
  ...levelNames,
];
