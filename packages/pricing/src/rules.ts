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
  | "GREY_ZONE"           // entre lot et vente à l'unité : rentabilité à décider
  | "BELOW_COST"          // le plancher imposé par le coût dépasse le prix
  | "PREMIUM_NOT_UNIQUE"  // valeur premium sur une offre interchangeable : à individualiser
  | "DRIFT";              // le prix décidé s'écarte de la suggestion actuelle

export const BLOCKING_REASONS: ReadonlySet<PriceReason> = new Set([
  "NO_REFERENCE", "STALE_REFERENCE", "AMBIGUOUS_REFERENCE", "VARIANT_INCOMPLETE", "GREY_ZONE", "BELOW_COST",
]);

export interface PricingSettings {
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
}

export const DEFAULT_SETTINGS: PricingSettings = {
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

export interface PricingResult {
  reference: Reference | null;
  /** Prix estimé pour cet état : référence × coefficient d'état. */
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

/**
 * Prix plancher : une part du prix cible, sans descendre sous le coût. La marge minimale par carte ne s'applique
 * qu'aux ventes à l'unité : exigée sur des cartes à quelques centimes, elle enverrait tout le vrac en revue.
 */
export function floorFor(targetCents: number, averageCostCents: number, s: PricingSettings, category: OfferCategory | null): number {
  const fromTarget = Math.round((targetCents * s.floorPercent) / 100);
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
    return { reference: null, suggestedCents: null, tier: null, category: "REVIEW", floorCents: null, reasons: onlyDriftIfManual(input, reasons) };
  }

  const suggestedCents = Math.max(1, Math.round((reference.amountCents * s.conditionPercent[input.condition]) / 100));
  const tier = tierOf(suggestedCents, s);

  if (reference.ageDays > s.maxAgeDays) reasons.push("STALE_REFERENCE");
  if (reference.variantAmbiguous) reasons.push("AMBIGUOUS_REFERENCE");
  if (input.variantIncomplete) reasons.push("VARIANT_INCOMPLETE");
  if (suggestedCents >= s.lotBelowCents && suggestedCents < s.singleFromCents) reasons.push("GREY_ZONE");
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
  const ints = [s.maxAgeDays, s.bulkBelowCents, s.lotBelowCents, s.singleFromCents, s.premiumFromCents, s.floorPercent, s.minMarginCents, s.driftPercent, ...Object.values(s.conditionPercent)];
  if (!ints.every((n) => Number.isInteger(n) && n >= 0)) return "all values must be non-negative integers";
  if (!(s.bulkBelowCents <= s.lotBelowCents && s.lotBelowCents <= s.singleFromCents && s.singleFromCents <= s.premiumFromCents)) {
    return "thresholds must be increasing: bulk ≤ lot ≤ single ≤ premium";
  }
  if (s.maxAgeDays < 1 || s.floorPercent > 100 || s.driftPercent < 1) return "maxAgeDays ≥ 1, floorPercent ≤ 100, driftPercent ≥ 1";
  if (Object.values(s.conditionPercent).some((p) => p < 1 || p > 200)) return "condition percentages must be between 1 and 200";
  return null;
}
