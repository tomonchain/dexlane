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
 * Noms des niveaux 1 à 10 : la matière du cadre de la carte vendeur. Le niveau 1 (Carton) s'obtient en terminant la
 * configuration du compte ; les suivants, aux seuils de ventes confirmées ci-dessus.
 */
export const levelNames: readonly string[] = ["Carton", "Bois", "Pierre", "Fer", "Bronze", "Argent", "Or", "Platine", "Diamant", "Légende"];

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
 * Parrainage : pas encore en place dans Dexlane. Tant qu'il ne l'est pas, ni le récap ni l'image de partage ne
 * proposent de lien `/r/{CODE}`, et les succès de parrainage restent verrouillés.
 */
export const referral = { enabled: false, minDaysBeforeSuggestion: 30 } as const;

/**
 * E-mail qui annonce le récap mensuel : coupé pour le moment (les récaps restent dans l'application). Réactivé, il
 * n'annonce que les récaps créés dans les 7 derniers jours, et chaque utilisateur peut s'en désinscrire.
 */
export const recapEmailEnabled = false;
/** Réglage de chaque utilisateur quand l'e-mail du récap est actif. */
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

/** Rareté d'un succès : il se présente comme une carte à collectionner, rangée dans le classeur du compte. */
export type AchievementRarity = "common" | "uncommon" | "rare" | "holo" | "secret";

export const achievementRarities: readonly { id: AchievementRarity; label: string }[] = [
  { id: "common", label: "Commune" },
  { id: "uncommon", label: "Peu commune" },
  { id: "rare", label: "Rare" },
  { id: "holo", label: "Holo" },
  { id: "secret", label: "Secrète" },
];

/** Condition d'un succès, évaluée par le calcul de progression d'après le journal et les tables métier. */
export type AchievementCondition =
  | { kind: "onboardingComplete" }
  | { kind: "listingsPublished"; atLeast: number }
  /** Toutes les cartes en stock sont rangées à un emplacement précis, avec au moins `minCards` cartes en stock. */
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
  /** Identifiant stable, gardé en base : ne jamais le changer pour un succès déjà attribué. */
  id: string;
  /** Numéro dans le classeur (1 à 14). */
  number: number;
  name: string;
  description: string;
  rarity: AchievementRarity;
  category: AchievementCategory;
  condition: AchievementCondition;
}

/** Les 14 cartes du classeur, dans l'ordre de leur numéro. */
export const achievements: readonly AchievementDef[] = [
  { id: "account_ready", number: 1, name: "Premier classeur", description: "Compte prêt : les 7 étapes du démarrage faites", rarity: "common", category: "start", condition: { kind: "onboardingComplete" } },
  { id: "first_listing", number: 2, name: "Mise en vitrine", description: "Première annonce publiée", rarity: "common", category: "start", condition: { kind: "listingsPublished", atLeast: 1 } },
  { id: "first_sale", number: 3, name: "Vendu !", description: "Première vente confirmée", rarity: "common", category: "sales", condition: { kind: "confirmedSales", atLeast: 1 } },
  { id: "all_stored", number: 4, name: "Chaque carte à sa place", description: "Tout le stock a un emplacement précis, avec au moins 50 cartes en stock", rarity: "uncommon", category: "start", condition: { kind: "allStockLocated", minCards: 50 } },
  { id: "sales_100", number: 5, name: "La centaine", description: "100 ventes confirmées", rarity: "uncommon", category: "sales", condition: { kind: "confirmedSales", atLeast: 100 } },
  { id: "regular", number: 6, name: "Métronome", description: "Une publication par semaine pendant 8 semaines", rarity: "uncommon", category: "regularity", condition: { kind: "weeklyStreak", weeks: weeklyStreakTarget } },
  { id: "export", number: 7, name: "Passe-frontière", description: "Première vente confirmée livrée à l'étranger", rarity: "uncommon", category: "sales", condition: { kind: "confirmedExportSale" } },
  { id: "first_referral", number: 8, name: "Passeur", description: "Premier filleul qualifié", rarity: "uncommon", category: "referral", condition: { kind: "referralsQualified", atLeast: 1 } },
  { id: "graded_sale", number: 9, name: "Sous coque", description: "Première carte gradée vendue", rarity: "rare", category: "sales", condition: { kind: "confirmedGradedSale" } },
  { id: "record_session", number: 10, name: "Coup de feu", description: "100 annonces publiées en moins d'une heure", rarity: "rare", category: "speed", condition: { kind: "publishBurst", count: 100, withinMinutes: 60 } },
  { id: "flawless", number: 11, name: "Zéro défaut", description: "30 jours sans annonce en erreur, avec au moins 20 annonces par jour", rarity: "rare", category: "quality", condition: { kind: "flawlessDays", days: 30, minPerDay: 20 } },
  { id: "sales_1000", number: 12, name: "Le millier", description: "1 000 ventes confirmées", rarity: "holo", category: "sales", condition: { kind: "confirmedSales", atLeast: 1000 } },
  { id: "free_dexlane", number: 13, name: "Ambassadeur", description: "Dexlane offert grâce au parrainage", rarity: "holo", category: "referral", condition: { kind: "referralFullDiscount" } },
  { id: "sales_10000", number: 14, name: "Dix mille", description: "10 000 ventes confirmées", rarity: "secret", category: "sales", condition: { kind: "confirmedSales", atLeast: 10000 } },
];

/** Tous les textes de cette configuration affichés dans l'interface (contrôle des traductions). */
export const progressionTexts = (): string[] => [
  ...onboardingSteps.flatMap((s) => [s.title, s.action]),
  ...achievementCategories.map((c) => c.label),
  ...achievementRarities.map((r) => r.label),
  ...achievements.flatMap((a) => [a.name, a.description]),
  ...levelNames,
];
