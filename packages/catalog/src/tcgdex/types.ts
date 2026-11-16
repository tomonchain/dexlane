/** Sous-ensemble des réponses TCGdex v2 utilisé ici (https://tcgdex.dev). Tous les champs sont optionnels côté source. */

export interface TcgdexSetBrief {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  cardCount?: { total?: number; official?: number };
}

export interface TcgdexCardBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

export interface TcgdexSet extends TcgdexSetBrief {
  releaseDate?: string;
  serie?: { id: string; name: string };
  abbreviation?: { official?: string; localized?: string };
  cards: TcgdexCardBrief[];
}

export interface CardmarketPricing {
  updated?: string;
  unit?: string;
  idProduct?: number;
  [field: string]: number | string | null | undefined;
}

export interface TcgdexVariantDetailed {
  type: string;
  subtype?: string;
  size?: string;
  stamp?: string[];
  variantId?: string;
  thirdParty?: { cardmarket?: number; tcgplayer?: number };
  pricing?: { cardmarket?: CardmarketPricing | null; tcgplayer?: unknown } | null;
}

export interface TcgdexCard {
  id: string;
  localId: string;
  name: string;
  category?: string;
  rarity?: string;
  image?: string;
  updated?: string;
  set: { id: string; name: string; cardCount?: { total?: number; official?: number } };
  variants?: { normal?: boolean; reverse?: boolean; holo?: boolean; firstEdition?: boolean; wPromo?: boolean };
  variants_detailed?: TcgdexVariantDetailed[];
  pricing?: { cardmarket?: CardmarketPricing | null; tcgplayer?: unknown } | null;
}
