import type { CardCondition } from "@dexlane/inventory";

export type QuoteType = "SOLD_AVG_7D" | "SOLD_AVG_30D" | "SOLD_AVG_1D" | "LISTED_TREND" | "LISTED_LOW";
/** Moyennes des ventes réalisées rapportées par la source, sur 7 jours, 30 jours et la veille. */
export const SALE_QUOTES = ["SOLD_AVG_7D", "SOLD_AVG_30D", "SOLD_AVG_1D"] as const;
export type SaleQuoteType = (typeof SALE_QUOTES)[number];
export const QUOTE_TYPES: QuoteType[] = [...SALE_QUOTES, "LISTED_TREND", "LISTED_LOW"];
/** Ce qui fonde un prix estimé : l'estimation d'après les ventes réussies, ou à défaut une cote d'annonces. */
export type ReferenceType = QuoteType | "SOLD_ESTIMATE";

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

export interface Reference extends Omit<Quote, "quoteType"> {
  quoteType: ReferenceType;
  ageDays: number;
}

/**
 * Fiabilité d'une estimation d'après les ventes :
 * HIGH — des ventes cette semaine et ce mois, à des prix proches ; MEDIUM — le prix bouge entre le mois et la semaine ;
 * LOW — une seule période renseignée (peu de ventes).
 */
export type SalesConfidence = "HIGH" | "MEDIUM" | "LOW";

/** Prix estimé d'après les ventes réussies (toutes langues et tous états confondus, comme la source). */
export interface SalesEstimate {
  cents: number;
  confidence: SalesConfidence;
  /** Moyennes de ventes relevées, pour montrer d'où vient le chiffre. */
  sales: { quoteType: SaleQuoteType; amountCents: number }[];
}

/** Ce que le marché dit d'une carte (état « comme neuf »). */
export interface MarketBand {
  /** Prix du marché : l'estimation d'après les ventes ; à défaut de vente récente, la tendance puis l'annonce la moins chère. */
  marketCents: number;
  /** Prix auquel la carte se vend sans attendre : la plus basse des moyennes de ventes, bornée autour du prix du marché. */
  liquidCents: number;
  /** Plus haut prix que les ventes soutiennent encore, borné de la même façon. */
  richCents: number;
  /** Annonce la moins chère du moment, si connue. */
  lowCents: number | null;
}

export interface PricingResult {
  reference: Reference | null;
  market: MarketBand | null;
  /** Estimation d'après les ventes réussies ; null quand la source ne rapporte aucune vente récente. */
  sales: SalesEstimate | null;
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

/** Une semaine atypique ne déplace pas l'estimation de plus de 20 % par rapport aux ventes du mois. */
const WEEK_SWAY = 0.2;
/** « Vendre vite » et « marge » restent à 15 % au plus du prix des ventes. */
const BAND_SPREAD = 0.15;
/** Au-delà de cet écart entre la semaine et le mois, le prix est jugé en mouvement. */
const STABLE_GAP = 0.2;
/** « Vendre vite » s'aligne sur l'annonce la moins chère, sans brader de plus de 10 % sous la valeur liquide. */
const FAST_UNDERCUT = 0.9;
/** Les cotes d'un même relevé portent la même date ; une cote plus ancienne n'a pas été confirmée par le dernier relevé. */
const SAME_READING_MS = 36 * 3600 * 1000;

/**
 * Cotes du dernier relevé seulement. La source omet une moyenne de ventes quand il n'y a pas eu de vente sur la période :
 * une vieille moyenne restée en base ne doit pas passer pour une vente récente.
 */
export function latestReading(quotes: Quote[]): Quote[] {
  const valid = quotes.filter((q) => q.amountCents > 0);
  const newest = Math.max(...valid.map((q) => q.observedAt.getTime()));
  return valid.filter((q) => newest - q.observedAt.getTime() <= SAME_READING_MS);
}

/**
 * Estimation d'après les ventes réussies. Les ventes du mois donnent la base (le plus de ventes, donc le plus stable),
 * celles de la semaine la direction : l'estimation est à mi-chemin, sans s'écarter de plus de 20 % du mois.
 * La moyenne de la veille repose sur trop peu de ventes pour compter : elle est montrée, et ne sert que seule.
 */
export function salesEstimate(quotes: Quote[]): SalesEstimate | null {
  const reading = latestReading(quotes);
  const sales = SALE_QUOTES.flatMap((quoteType) => {
    const found = reading.find((q) => q.quoteType === quoteType);
    return found ? [{ quoteType, amountCents: found.amountCents }] : [];
  });
  const amount = (type: SaleQuoteType) => sales.find((s) => s.quoteType === type)?.amountCents ?? null;
  const [week, month, day] = [amount("SOLD_AVG_7D"), amount("SOLD_AVG_30D"), amount("SOLD_AVG_1D")];
  if (week !== null && month !== null) {
    const cents = Math.round(Math.min(Math.max((week + month) / 2, month * (1 - WEEK_SWAY)), month * (1 + WEEK_SWAY)));
    return { cents, confidence: Math.abs(week - month) <= STABLE_GAP * Math.max(week, month) ? "HIGH" : "MEDIUM", sales };
  }
  const only = month ?? week ?? day;
  return only === null ? null : { cents: only, confidence: "LOW", sales };
}

/**
 * Fourchette du marché à partir du dernier relevé : centrée sur l'estimation d'après les ventes, bornée par les moyennes
 * de la semaine et du mois. Sans vente récente, la tendance puis l'annonce la moins chère servent de repère.
 */
export function marketBand(quotes: Quote[]): MarketBand | null {
  const reading = latestReading(quotes);
  const amount = (type: QuoteType) => reading.find((q) => q.quoteType === type)?.amountCents ?? null;
  const low = amount("LISTED_LOW");
  const estimate = salesEstimate(reading);
  if (!estimate) {
    const fallback = amount("LISTED_TREND") ?? low;
    return fallback === null ? null : { marketCents: fallback, liquidCents: fallback, richCents: fallback, lowCents: low };
  }
  const periods = estimate.sales.filter((s) => s.quoteType !== "SOLD_AVG_1D" || estimate.sales.length === 1).map((s) => s.amountCents);
  return {
    marketCents: estimate.cents,
    liquidCents: Math.max(Math.min(...periods), Math.round(estimate.cents * (1 - BAND_SPREAD))),
    richCents: Math.min(Math.max(...periods), Math.round(estimate.cents * (1 + BAND_SPREAD))),
    lowCents: low,
  };
}

/** Prix de marché (état « comme neuf ») selon la stratégie. */
export function marketPrice(band: MarketBand, strategy: PricingStrategy): number {
  if (strategy === "MARGIN") return band.richCents;
  if (strategy === "BALANCED") return band.marketCents;
  const undercut = band.lowCents !== null && band.lowCents < band.liquidCents;
  return undercut ? Math.max(band.lowCents!, Math.round(band.liquidCents * FAST_UNDERCUT)) : band.liquidCents;
}

/**
 * Ce qui fonde le prix, avec sa date : l'estimation d'après les ventes quand il y en a, sinon la tendance, sinon l'annonce
 * la moins chère. Sa date et son ambiguïté sont celles du relevé.
 */
export function pickReference(quotes: Quote[], now: Date): Reference | null {
  const reading = latestReading(quotes);
  const estimate = salesEstimate(reading);
  const used = estimate
    ? reading.filter((q) => (SALE_QUOTES as readonly string[]).includes(q.quoteType))
    : reading.filter((q) => q.quoteType === "LISTED_TREND").concat(reading.filter((q) => q.quoteType === "LISTED_LOW")).slice(0, 1);
  if (used.length === 0) return null;
  const observedAt = new Date(Math.min(...used.map((q) => q.observedAt.getTime())));
  return {
    quoteType: estimate ? "SOLD_ESTIMATE" : used[0]!.quoteType,
    amountCents: estimate ? estimate.cents : used[0]!.amountCents,
    observedAt,
    variantAmbiguous: used.some((q) => q.variantAmbiguous),
    ageDays: Math.max(0, Math.floor((now.getTime() - observedAt.getTime()) / DAY_MS)),
  };
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
  const reference = pickReference(input.quotes, input.now);
  const reasons: PriceReason[] = [];

  if (!reference) {
    reasons.push("NO_REFERENCE");
    if (input.variantIncomplete) reasons.push("VARIANT_INCOMPLETE");
    return { reference: null, market: null, sales: null, suggestedCents: null, tier: null, category: "REVIEW", floorCents: null, reasons: onlyDriftIfManual(input, reasons) };
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
    sales: salesEstimate(input.quotes),
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
