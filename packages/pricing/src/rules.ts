import type { CardCondition } from "@dexlane/inventory";

export type QuoteType = "LISTED_TREND" | "SOLD_AVG_30D" | "SOLD_AVG_7D" | "LISTED_LOW";
export const QUOTE_TYPES: QuoteType[] = ["LISTED_TREND", "SOLD_AVG_30D", "SOLD_AVG_7D", "LISTED_LOW"];

export type OfferCategory = "BULK" | "LOT" | "SINGLE" | "PREMIUM" | "REVIEW";
export type PriceSource = "NONE" | "AUTO" | "MANUAL";

/**
 * Motifs de revue. Les motifs bloquants empêchent de poser un prix automatiquement et classent l'offre « à revoir » ;
 * les autres sont des signalements sur un prix déjà décidé.
 */
export type PriceReason =
  | "NO_REFERENCE"        // aucune cotation pour cette variante
  | "STALE_REFERENCE"     // cotation trop ancienne
  | "AMBIGUOUS_REFERENCE" // cotation partagée avec une autre variante
  | "VARIANT_INCOMPLETE"  // variante à confirmer dans le catalogue
  | "GREY_ZONE"           // (ancien motif, plus émis) entre lot et vente à l'unité
  | "BELOW_COST"          // le prix décidé ne couvre plus le coût d'achat
  | "HELD_AT_COST"        // le marché est sous le prix d'achat : prix tenu au coût, vente plus lente
  | "PREMIUM_NOT_UNIQUE"  // valeur premium sur une offre interchangeable : à individualiser
  | "DRIFT";              // le prix décidé s'écarte de la suggestion actuelle

export const BLOCKING_REASONS: ReadonlySet<PriceReason> = new Set([
  "NO_REFERENCE", "STALE_REFERENCE", "AMBIGUOUS_REFERENCE", "VARIANT_INCOMPLETE", "BELOW_COST",
]);

/**
 * Où se placer dans la fourchette du marché :
 * FAST — au prix qui part tout de suite ; BALANCED — entre ce prix et le plus haut que le marché soutient ; MARGIN — au plus haut.
 */
export type PricingStrategy = "FAST" | "BALANCED" | "MARGIN";
export const STRATEGIES: PricingStrategy[] = ["FAST", "BALANCED", "MARGIN"];

export interface PricingSettings {
  /** Arbitrage entre vitesse de vente et marge. */
  strategy: PricingStrategy;
  /** Cotation de référence préférée ; les autres servent de repli dans l'ordre de QUOTE_TYPES. */
  basis: QuoteType;
  /** Au-delà, la cotation est jugée périmée (spec : « prix non publiable si donnée trop ancienne »). */
  maxAgeDays: number;
  /** Part de la référence retenue selon l'état, en pourcentage (la source ne distingue pas les états). */
  conditionPercent: Record<CardCondition, number>;
  /** Seuils de catégorie sur le prix estimé, en centimes (spec 4.3, valeurs indicatives de départ). */
  bulkBelowCents: number;
  lotBelowCents: number;
  singleFromCents: number;
  premiumFromCents: number;
  /** Prix plancher = cette part du prix cible… */
  floorPercent: number;
  /** …sans descendre sous le coût moyen, majoré de cette marge pour les ventes à l'unité. */
  minMarginCents: number;
  /** Écart entre prix décidé et suggestion au-delà duquel l'offre revient en revue. */
  driftPercent: number;
  /** À partir de ce montant, les prix calculés sont arrondis au pas ci-dessous (612,37 € → 612 €). */
  roundFromCents: number;
  /** Pas d'arrondi, en centimes : 100 = à l'euro, 500 = aux 5 euros. */
  roundStepCents: number;
}

export const DEFAULT_SETTINGS: PricingSettings = {
  strategy: "BALANCED",
  basis: "LISTED_TREND",
  maxAgeDays: 14,
  conditionPercent: { MT: 100, NM: 100, EX: 80, GD: 65, LP: 50, PL: 35, PO: 20 },
  bulkBelowCents: 100,
  lotBelowCents: 500,
  singleFromCents: 1500,
  premiumFromCents: 10000,
  floorPercent: 80,
  minMarginCents: 50,
  driftPercent: 20,
  roundFromCents: 1000,
  roundStepCents: 100,
};

export interface Quote {
  quoteType: QuoteType;
  amountCents: number;
  observedAt: Date;
  /** La source ne distingue pas cette variante d'une autre (même produit, même prix). */
  variantAmbiguous: boolean;
}

export interface PricingInput {
  condition: CardCondition;
  isUnique: boolean;
  variantIncomplete: boolean;
  /** Coût unitaire moyen des cartes en stock de cette offre ; 0 si inconnu. */
  averageCostCents: number;
  /** Dernière cotation connue par type. */
  quotes: Quote[];
  current: { priceSource: PriceSource; targetPriceCents: number | null };
  now: Date;
}

export interface Reference extends Quote {
  ageDays: number;
}

/** Ce que le marché dit d'une carte, toutes cotes confondues (état « comme neuf »). */
export interface MarketBand {
  /** Prix auquel la carte se vend sans attendre : la plus basse des cotes de vente. */
  liquidCents: number;
  /** Plus haut prix que le marché soutient encore (plafonné pour ignorer un pic isolé). */
  richCents: number;
  /** Annonce la moins chère du moment, si connue. */
  lowCents: number | null;
}

export interface PricingResult {
  reference: Reference | null;
  market: MarketBand | null;
  /** Prix estimé pour cet état : position dans la fourchette du marché × coefficient d'état, jamais sous le coût. */
  suggestedCents: number | null;
  /** Catégorie selon les seuils, sans tenir compte des motifs de revue. */
  tier: Exclude<OfferCategory, "REVIEW"> | null;
  /** Catégorie retenue : « REVIEW » dès qu'un motif bloquant existe. */
  category: OfferCategory;
  floorCents: number | null;
  reasons: PriceReason[];
}

const DAY_MS = 24 * 3600 * 1000;

export function tierOf(priceCents: number, s: PricingSettings): Exclude<OfferCategory, "REVIEW"> {
  if (priceCents < s.bulkBelowCents) return "BULK";
  if (priceCents < s.lotBelowCents) return "LOT";
  if (priceCents < s.premiumFromCents) return "SINGLE";
  return "PREMIUM";
}

/** Arrondit un prix calculé au pas configuré, à partir du seuil ; en dessous, il reste au centime. */
export function roundPrice(cents: number, s: PricingSettings): number {
  if (s.roundStepCents <= 1 || cents < s.roundFromCents) return cents;
  return Math.round(cents / s.roundStepCents) * s.roundStepCents;
}

/**
 * Prix plancher : une part du prix cible, sans descendre sous le coût. La marge minimale par carte ne s'applique
 * qu'aux ventes à l'unité : exigée sur des cartes à quelques centimes, elle enverrait tout le vrac en revue.
 */
export function floorFor(targetCents: number, averageCostCents: number, s: PricingSettings, category: OfferCategory | null): number {
  const fromTarget = roundPrice(Math.round((targetCents * s.floorPercent) / 100), s);
  const margin = category === "SINGLE" || category === "PREMIUM" ? s.minMarginCents : 0;
  const fromCost = averageCostCents > 0 ? averageCostCents + margin : 0;
  return Math.max(fromTarget, fromCost);
}

/** Cotation retenue : la base préférée si elle existe, sinon le premier repli disponible. */
export function pickReference(quotes: Quote[], s: PricingSettings, now: Date): Reference | null {
  for (const type of [s.basis, ...QUOTE_TYPES.filter((t) => t !== s.basis)]) {
    const quote = quotes.find((q) => q.quoteType === type && q.amountCents > 0);
    if (quote) return { ...quote, ageDays: Math.max(0, Math.floor((now.getTime() - quote.observedAt.getTime()) / DAY_MS)) };
  }
  return null;
}

/** Une cote de vente isolée au-dessus des autres (pic d'une semaine) ne tire pas le prix de plus de 25 %. */
const RICH_CAP = 1.25;
/** « Vendre vite » s'aligne sur l'annonce la moins chère, sans brader de plus de 10 % sous la valeur liquide. */
const FAST_UNDERCUT = 0.9;

/**
 * Fourchette du marché à partir des dernières cotes : tendance et moyennes des ventes sur 7 et 30 jours.
 * À défaut de cote de vente, l'annonce la moins chère sert seule de repère.
 */
export function marketBand(quotes: Quote[]): MarketBand | null {
  const amount = (type: QuoteType) => quotes.find((q) => q.quoteType === type && q.amountCents > 0)?.amountCents ?? null;
  const low = amount("LISTED_LOW");
  const sold = [amount("LISTED_TREND"), amount("SOLD_AVG_7D"), amount("SOLD_AVG_30D")].filter((v): v is number => v !== null);
  if (sold.length === 0) return low === null ? null : { liquidCents: low, richCents: low, lowCents: low };
  const liquid = Math.min(...sold);
  return { liquidCents: liquid, richCents: Math.min(Math.max(...sold), Math.round(liquid * RICH_CAP)), lowCents: low };
}

/** Prix de marché (état « comme neuf ») selon la stratégie. */
export function marketPrice(band: MarketBand, strategy: PricingStrategy): number {
  if (strategy === "MARGIN") return band.richCents;
  if (strategy === "BALANCED") return Math.round((band.liquidCents + band.richCents) / 2);
  const undercut = band.lowCents !== null && band.lowCents < band.liquidCents;
  return undercut ? Math.max(band.lowCents!, Math.round(band.liquidCents * FAST_UNDERCUT)) : band.liquidCents;
}

/** Arrondi au pas supérieur : un plancher de coût ne s'arrondit jamais vers le bas. */
function roundUpPrice(cents: number, s: PricingSettings): number {
  if (s.roundStepCents <= 1 || cents < s.roundFromCents) return cents;
  return Math.ceil(cents / s.roundStepCents) * s.roundStepCents;
}

/**
 * Cœur du moteur de règles : pur, sans base ni horloge implicite, donc entièrement testable.
 * Ne décide jamais d'un prix à la place de l'opérateur quand un doute existe — il le signale.
 */
export function computePricing(input: PricingInput, s: PricingSettings): PricingResult {
  const reference = pickReference(input.quotes, s, input.now);
  const reasons: PriceReason[] = [];

  if (!reference) {
    reasons.push("NO_REFERENCE");
    if (input.variantIncomplete) reasons.push("VARIANT_INCOMPLETE");
    return { reference: null, market: null, suggestedCents: null, tier: null, category: "REVIEW", floorCents: null, reasons: onlyDriftIfManual(input, reasons) };
  }

  // 1. Le marché : où la carte se vend, selon la stratégie, ramené à l'état de l'exemplaire.
  const market = marketBand(input.quotes)!;
  const atCondition = Math.max(1, Math.round((marketPrice(market, s.strategy) * s.conditionPercent[input.condition]) / 100));
  // 2. Le coût : jamais sous le prix d'achat (plus la marge minimale pour une vente à l'unité).
  //    Si le marché est en dessous, le prix est tenu au coût et l'offre le signale : elle se vendra moins vite.
  const costFloor = input.averageCostCents > 0
    ? input.averageCostCents + (["SINGLE", "PREMIUM"].includes(tierOf(Math.max(atCondition, input.averageCostCents), s)) ? s.minMarginCents : 0)
    : 0;
  const held = costFloor > roundPrice(atCondition, s);
  const suggestedCents = held ? roundUpPrice(costFloor, s) : roundPrice(atCondition, s);
  const tier = tierOf(suggestedCents, s);

  if (reference.ageDays > s.maxAgeDays) reasons.push("STALE_REFERENCE");
  if (reference.variantAmbiguous) reasons.push("AMBIGUOUS_REFERENCE");
  if (input.variantIncomplete) reasons.push("VARIANT_INCOMPLETE");
  if (held) reasons.push("HELD_AT_COST");
  if (tier === "PREMIUM" && !input.isUnique) reasons.push("PREMIUM_NOT_UNIQUE");

  // Le plancher et l'écart se jugent sur le prix décidé s'il existe, sinon sur la suggestion.
  const decided = input.current.targetPriceCents ?? suggestedCents;
  const floorCents = floorFor(decided, input.averageCostCents, s, tier);
  if (floorCents > decided) reasons.push("BELOW_COST");
  if (input.current.targetPriceCents !== null && input.current.priceSource !== "NONE") {
    const gap = Math.abs(suggestedCents - input.current.targetPriceCents) * 100;
    if (gap > s.driftPercent * input.current.targetPriceCents) reasons.push("DRIFT");
  }

  const kept = onlyDriftIfManual(input, reasons);
  return {
    reference,
    market,
    suggestedCents,
    tier,
    category: kept.some((r) => BLOCKING_REASONS.has(r)) ? "REVIEW" : tier,
    floorCents,
    reasons: kept,
  };
}

/** Un prix décidé à la main a déjà été revu : seul un écart notable avec le marché le ramène en revue. */
function onlyDriftIfManual(input: PricingInput, reasons: PriceReason[]): PriceReason[] {
  return input.current.priceSource === "MANUAL" ? reasons.filter((r) => r === "DRIFT" || r === "BELOW_COST") : reasons;
}

export function validateSettings(s: PricingSettings): string | null {
  const ints = [
    s.maxAgeDays, s.bulkBelowCents, s.lotBelowCents, s.singleFromCents, s.premiumFromCents, s.floorPercent, s.minMarginCents,
    s.driftPercent, s.roundFromCents, s.roundStepCents, ...Object.values(s.conditionPercent),
  ];
  if (!ints.every((n) => Number.isInteger(n) && n >= 0)) return "all values must be non-negative integers";
  if (!STRATEGIES.includes(s.strategy)) return "unknown pricing strategy";
  if (!(s.bulkBelowCents <= s.lotBelowCents && s.lotBelowCents <= s.singleFromCents && s.singleFromCents <= s.premiumFromCents)) {
    return "thresholds must be increasing: bulk ≤ lot ≤ single ≤ premium";
  }
  if (s.maxAgeDays < 1 || s.floorPercent > 100 || s.driftPercent < 1) return "maxAgeDays ≥ 1, floorPercent ≤ 100, driftPercent ≥ 1";
  if (Object.values(s.conditionPercent).some((p) => p < 1 || p > 200)) return "condition percentages must be between 1 and 200";
  if (s.roundStepCents < 1) return "roundStepCents must be at least 1";
  return null;
}
