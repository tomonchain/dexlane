/** Sous-ensemble des réponses TCGdex v2 utilisé ici (https://tcgdex.dev). Tous les champs sont optionnels côté source. */

export interface TcgdexSetBrief {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  cardCount?: { total?: number; official?: number };
}

/** Bloc éditorial regroupant plusieurs séries (« Épée et Bouclier »). */
export interface TcgdexSerieBrief {
  id: string;
  name: string;
  logo?: string;
}

export interface TcgdexSerie extends TcgdexSerieBrief {
  sets?: TcgdexSetBrief[];
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
  pricing?: { cardmarket?: CardmarketPricing | null; tcgplayer?: TcgplayerPricing | null } | null;
}

/** Prix TCGplayer relayés par TCGdex, en dollars, par impression (normal, holofoil, reverse-holofoil, 1st-edition-…). */
export interface TcgplayerPricing {
  updated?: string;
  unit?: string;
  [printing: string]: { marketPrice?: number | null; lowPrice?: number | null } | string | undefined;
}

export interface TcgdexCard {
  id: string;
  localId: string;
  name: string;
  category?: string;
  rarity?: string;
  image?: string;
  updated?: string;
  /** Numéro(s) du Pokédex national : plusieurs pour une carte à plusieurs Pokémon (« Pikachu & Zekrom-GX »). */
  dexId?: number[];
  illustrator?: string;
  hp?: number;
  types?: string[];
  /** Stade d'évolution, dans la langue de la carte (« De base », « Niveau 1 »…). */
  stage?: string;
  set: { id: string; name: string; cardCount?: { total?: number; official?: number } };
  variants?: { normal?: boolean; reverse?: boolean; holo?: boolean; firstEdition?: boolean; wPromo?: boolean };
  variants_detailed?: TcgdexVariantDetailed[];
  pricing?: { cardmarket?: CardmarketPricing | null; tcgplayer?: TcgplayerPricing | null } | null;
}
