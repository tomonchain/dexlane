import type { CardmarketPricing, TcgdexCard, TcgdexVariantDetailed, TcgplayerPricing } from "./types";

export interface MappedCard {
  setId: string;
  localNumber: string;
  name: string;
  language: string;
  rarity: string | null;
  category: string | null;
  imageUrl: string | null;
  externalIds: Record<string, string>;
  sourceUpdatedAt: Date | null;
  dexIds: number[] | null;
  illustrator: string | null;
  hp: number | null;
  types: string[] | null;
  stage: string | null;
}

export interface MappedVariant {
  finish: string;
  edition: string;
  promo: boolean;
  stamp: string;
  subtype: string;
  size: string;
  tcgdexVariantId: string | null;
  cardmarketProductId: number | null;
  tcgplayerProductId: number | null;
  incomplete: boolean;
  attributes: Record<string, unknown>;
  prices: MappedPrice[];
}

export type QuoteType = "LISTED_LOW" | "LISTED_TREND" | "SOLD_AVG_1D" | "SOLD_AVG_7D" | "SOLD_AVG_30D" | "MARKET";

export interface MappedPrice {
  source: string;
  quoteType: QuoteType;
  currency: string;
  amountCents: number;
  observedAt: Date;
  /** Cardmarket regroupe toutes les langues et tous les états d'un produit dans son guide des prix. */
  sourceScope: string;
  variantAmbiguous: boolean;
}

export interface MappedCardWithVariants {
  card: MappedCard;
  variants: MappedVariant[];
}

export const PRICE_SOURCE = "cardmarket_price_guide_via_tcgdex";
/** Prix du marché TCGplayer (États-Unis), en dollars : un repère d'un autre marché, jamais mélangé aux cotes en euros. */
export const TCGPLAYER_SOURCE = "tcgplayer_via_tcgdex";
const PRICE_SCOPE = "all_languages;all_conditions";

/** Champs du guide des prix Cardmarket → type de cotation. */
const CARDMARKET_FIELDS: [string, QuoteType][] = [
  ["low", "LISTED_LOW"],
  ["trend", "LISTED_TREND"],
  ["avg1", "SOLD_AVG_1D"],
  ["avg7", "SOLD_AVG_7D"],
  ["avg30", "SOLD_AVG_30D"],
];

const FIRST_EDITION = /^(1(re|st|ère)?\s*[ée]d(ition)?|first\s*edition|1st\s*edition)$/i;
/** Valeur de remplissage renvoyée par TCGdex quand la variante n'est pas encore documentée. */
const PLACEHOLDER_VARIANT_ID = "generated";

export function mapTcgdexCard(src: TcgdexCard, language: string): MappedCardWithVariants {
  const card: MappedCard = {
    setId: src.set.id,
    localNumber: src.localId,
    name: src.name,
    language,
    rarity: src.rarity ?? null,
    category: src.category ?? null,
    imageUrl: src.image ?? null,
    externalIds: { tcgdex: src.id },
    sourceUpdatedAt: src.updated ? new Date(src.updated) : null,
    dexIds: src.dexId?.filter((n) => Number.isInteger(n) && n > 0).length ? src.dexId.filter((n) => Number.isInteger(n) && n > 0) : null,
    illustrator: src.illustrator?.trim() || null,
    hp: typeof src.hp === "number" && Number.isFinite(src.hp) ? Math.round(src.hp) : null,
    types: src.types?.length ? src.types : null,
    stage: src.stage?.trim() || null,
  };
  const promo = src.rarity === "Promo";

  let variants: MappedVariant[] = src.variants_detailed?.length
    ? src.variants_detailed.map((v) => fromDetailed(v, promo))
    : fromFlags(src, promo);

  variants = disambiguateNaturalKeys(variants);
  attachPrices(variants, src);
  return { card, variants: localizeEnglishPrints(variants, language) };
}

/**
 * Impressions qui n'existent qu'en anglais : le Set de Base « sans ombre » (Shadowless) et le tirage britannique
 * « Copyright 1999-2000 ». TCGdex les rattache aussi aux fiches des autres langues.
 */
const ENGLISH_ONLY_PRINT = /sans ombre|shadowless|1999-2000/i;

/**
 * Dans une autre langue que l'anglais, une impression purement anglaise n'existe pas : elle est retirée. La 1re édition,
 * elle, existe aussi dans les autres langues ; elle est gardée sans la mention anglaise, mais sa cote est celle de
 * l'impression anglaise : elle est marquée partagée (jamais publiée sans revue) et le prix TCGplayer, américain, est retiré.
 */
function localizeEnglishPrints(variants: MappedVariant[], language: string): MappedVariant[] {
  if (language === "en") return variants;
  const keyOf = (v: MappedVariant) => [v.finish, v.edition, v.promo, v.stamp, v.subtype, v.size].join("|");
  const kept = new Set(variants.filter((v) => !ENGLISH_ONLY_PRINT.test(v.subtype)).map(keyOf));
  return variants.flatMap((v): MappedVariant[] => {
    if (!ENGLISH_ONLY_PRINT.test(v.subtype)) return [v];
    if (v.edition !== "1st") return [];
    // Une seule 1re édition par finition : plusieurs impressions anglaises deviennent la même variante une fois renommées.
    const key = keyOf({ ...v, subtype: "" });
    if (kept.has(key)) return [];
    kept.add(key);
    return [{
      ...v,
      subtype: "",
      attributes: { ...v.attributes, pricedFromEnglishPrint: v.subtype },
      prices: v.prices.filter((p) => p.quoteType !== "MARKET").map((p) => ({ ...p, variantAmbiguous: true })),
    }];
  });
}

function fromDetailed(v: TcgdexVariantDetailed, promo: boolean): MappedVariant {
  const stamps = v.stamp ?? [];
  const firstEdition = stamps.some((s) => FIRST_EDITION.test(s.trim()));
  const otherStamps = stamps.filter((s) => !FIRST_EDITION.test(s.trim())).sort();
  const placeholder = !v.variantId || v.variantId === PLACEHOLDER_VARIANT_ID;
  return {
    finish: v.type.trim().toLowerCase(),
    edition: firstEdition ? "1st" : "",
    promo,
    stamp: otherStamps.join(" + "),
    subtype: v.subtype?.trim() ?? "",
    size: (v.size ?? "standard").trim().toLowerCase(),
    tcgdexVariantId: placeholder ? null : v.variantId!,
    cardmarketProductId: v.thirdParty?.cardmarket ?? numberOrNull(v.pricing?.cardmarket?.idProduct),
    tcgplayerProductId: v.thirdParty?.tcgplayer ?? null,
    incomplete: placeholder,
    attributes: {},
    prices: [],
  };
}

/** Sans variantes détaillées : variantes déduites des drapeaux, toutes marquées incomplètes. */
function fromFlags(src: TcgdexCard, promo: boolean): MappedVariant[] {
  const flags = src.variants ?? {};
  const finishes = (["normal", "reverse", "holo"] as const).filter((f) => flags[f]);
  const base = {
    promo, stamp: "", subtype: "", size: "standard", tcgdexVariantId: null,
    cardmarketProductId: numberOrNull(src.pricing?.cardmarket?.idProduct), tcgplayerProductId: null,
    incomplete: true, attributes: { inferredFrom: "variant_flags" }, prices: [],
  };
  const variants: MappedVariant[] = finishes.map((finish) => ({ ...base, finish, edition: "" }));
  if (flags.firstEdition) {
    for (const finish of finishes.length ? finishes : ["unknown"]) variants.push({ ...base, finish, edition: "1st" });
  }
  if (variants.length === 0) variants.push({ ...base, finish: "unknown", edition: "", attributes: { inferredFrom: "none" } });
  return variants;
}

/** Deux variantes indiscernables par leur clé naturelle : on les garde distinctes et on exige une revue. */
function disambiguateNaturalKeys(variants: MappedVariant[]): MappedVariant[] {
  const seen = new Map<string, number>();
  return variants.map((v) => {
    const key = [v.finish, v.edition, v.promo, v.stamp, v.subtype, v.size].join("|");
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? v : { ...v, subtype: `${v.subtype}#${n}`, incomplete: true, attributes: { ...v.attributes, duplicateNaturalKey: true } };
  });
}

/**
 * Cotations Cardmarket par variante.
 * - Variante « reverse » : Cardmarket publie le reverse dans les champs suffixés `-holo` du même produit.
 * - Deux variantes de même famille (reverse ou non) partageant un produit Cardmarket ont des prix
 *   indiscernables : cotations marquées `variantAmbiguous`.
 */
function attachPrices(variants: MappedVariant[], src: TcgdexCard): void {
  const familyOf = (v: MappedVariant) => (v.finish === "reverse" ? "reverse" : "main");
  const sharing = new Map<string, number>();
  for (const v of variants) {
    if (v.cardmarketProductId == null) continue;
    const k = `${v.cardmarketProductId}|${familyOf(v)}`;
    sharing.set(k, (sharing.get(k) ?? 0) + 1);
  }

  const detailed = src.variants_detailed ?? [];
  variants.forEach((v, i) => {
    let guide = detailed[i]?.pricing?.cardmarket ?? null;
    let ambiguous = v.cardmarketProductId != null && (sharing.get(`${v.cardmarketProductId}|${familyOf(v)}`) ?? 0) > 1;
    if (!guide && variants.length === 1 && src.pricing?.cardmarket) {
      guide = src.pricing.cardmarket; // cotation niveau carte, utilisable seulement s'il n'y a qu'une variante
      ambiguous ||= v.incomplete;
    }
    if (guide) v.prices = cardmarketPrices(guide, familyOf(v) === "reverse" ? "-holo" : "", ambiguous || v.incomplete);
    const tcgplayer = detailed[i]?.pricing?.tcgplayer ?? (variants.length === 1 ? src.pricing?.tcgplayer : null);
    const market = tcgplayer ? tcgplayerMarket(tcgplayer, v) : null;
    if (market) v.prices.push(market);
  });
}

/** Impression TCGplayer d'une variante : normale, holo ou reverse, en première édition s'il y a lieu. */
function tcgplayerMarket(pricing: TcgplayerPricing, v: MappedVariant): MappedPrice | null {
  if (!pricing.updated || (pricing.unit && pricing.unit !== "USD")) return null;
  const base = v.finish === "reverse" ? "reverse-holofoil" : v.finish === "holo" ? "holofoil" : v.finish === "normal" ? "normal" : null;
  if (!base) return null;
  const keys = v.edition === "1st" ? [`1st-edition-${base}`, "1st-edition"] : [base, `unlimited-${base}`];
  for (const key of keys) {
    const entry = pricing[key];
    const market = typeof entry === "object" && entry ? entry.marketPrice : null;
    if (typeof market === "number" && market > 0) {
      return {
        source: TCGPLAYER_SOURCE, quoteType: "MARKET", currency: "USD", amountCents: Math.round(market * 100),
        observedAt: new Date(pricing.updated), sourceScope: "tcgplayer_market_price;all_conditions", variantAmbiguous: v.incomplete,
      };
    }
  }
  return null;
}

function cardmarketPrices(guide: CardmarketPricing, suffix: string, ambiguous: boolean): MappedPrice[] {
  if (!guide.updated || (guide.unit && guide.unit !== "EUR")) return [];
  const observedAt = new Date(guide.updated);
  const prices: MappedPrice[] = [];
  for (const [field, quoteType] of CARDMARKET_FIELDS) {
    const value = guide[`${field}${suffix}`];
    // 0 ou absent = pas de donnée (Cardmarket renvoie parfois 0 faute de ventes) : on n'invente rien.
    if (typeof value !== "number" || !(value > 0)) continue;
    prices.push({
      source: PRICE_SOURCE,
      quoteType,
      currency: "EUR",
      amountCents: Math.round(value * 100),
      observedAt,
      sourceScope: PRICE_SCOPE,
      variantAmbiguous: ambiguous,
    });
  }
  return prices;
}

const numberOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null);
