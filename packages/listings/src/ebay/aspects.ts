import type { Db } from "@dexlane/db";
import type { EbayClient } from "./api";
import { EBAY_MARKETPLACES, readEbayConfig, writeEbayConfig, type EbayMarketplaceId } from "./setup";

/**
 * Caractéristiques de l'objet (item specifics). Leurs noms et leurs valeurs admises dépendent du site et de la catégorie
 * (« Jeu » sur eBay.fr, « Spiel » sur eBay.de) : on les lit dans la taxonomie d'eBay, on les garde une semaine, et on y
 * range ce qu'on sait de la carte.
 */

/** Ce qu'on sait d'une carte pour remplir ses caractéristiques. */
export interface CardDetails {
  name: string;
  /** Numéro tel qu'imprimé (« 4/102 », « TG05 »). */
  number: string;
  set: string;
  /** Code de langue de l'impression (fr, en, ja…). */
  language: string;
  rarity: string;
  /** Code de finition : normal, holo, reverse. */
  finish: string;
  /** Lot de plusieurs cartes (la carte décrite est la plus chère du lot). */
  lot?: boolean;
  /** Carte gradée : société de gradation, note et numéro de certificat. */
  grader?: string | null;
  grade?: string | null;
  certNumber?: string | null;
}

export interface CategoryAspect {
  name: string;
  required: boolean;
  /** Seules les valeurs listées sont admises. */
  selectionOnly: boolean;
  maxLength: number | null;
  /** Valeurs proposées par eBay (pour les caractéristiques qu'on sait remplir seulement). */
  values: string[];
}

const CACHE_DAYS = 7;

/** Le mot exact peut varier d'un site à l'autre : on compare sans accents ni casse. */
export const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

type Source = {
  /** Noms possibles de la caractéristique, dans les langues des sites visés. */
  names: string[];
  /** Valeurs candidates, de la plus souhaitable à la moins ; la première sert quand le texte est libre. */
  values: (d: CardDetails, lang: Lang) => string[];
};
type Lang = "fr" | "de" | "it" | "es";

const LANGUAGE_NAMES: Record<string, Record<Lang, string> & { en: string }> = {
  fr: { fr: "Français", de: "Französisch", it: "Francese", es: "Francés", en: "French" },
  en: { fr: "Anglais", de: "Englisch", it: "Inglese", es: "Inglés", en: "English" },
  de: { fr: "Allemand", de: "Deutsch", it: "Tedesco", es: "Alemán", en: "German" },
  it: { fr: "Italien", de: "Italienisch", it: "Italiano", es: "Italiano", en: "Italian" },
  es: { fr: "Espagnol", de: "Spanisch", it: "Spagnolo", es: "Español", en: "Spanish" },
  pt: { fr: "Portugais", de: "Portugiesisch", it: "Portoghese", es: "Portugués", en: "Portuguese" },
  ja: { fr: "Japonais", de: "Japanisch", it: "Giapponese", es: "Japonés", en: "Japanese" },
};

const FINISHES: Record<string, string[]> = {
  holo: ["Holo", "Holographique", "Holofoil", "Holo Foil"],
  reverse: ["Reverse Holo", "Reverse", "Holo inversé"],
  normal: ["Normal", "Non holo", "Non-Holo", "Regular"],
};

const SOURCES: Source[] = [
  { names: ["jeu", "game", "spiel", "gioco", "juego"], values: () => ["Pokémon TCG", "Pokémon JCC", "Pokémon"] },
  { names: ["personnage", "character", "charakter", "personaggio", "personaje"], values: (d) => [d.name] },
  { names: ["nom de la carte", "card name", "kartenname", "nome della carta", "nombre de la carta"], values: (d) => [d.name] },
  { names: ["set", "extension", "serie", "set/extension", "edition", "espansione", "expansion"], values: (d) => [d.set] },
  { names: ["numero de la carte", "card number", "kartennummer", "numero della carta", "numero de la carta", "numero de carta"], values: (d) => [d.number] },
  {
    names: ["langue", "language", "sprache", "lingua", "idioma"],
    values: (d, lang) => {
      const names = LANGUAGE_NAMES[d.language];
      return names ? [names[lang], names.en] : [d.language.toUpperCase()];
    },
  },
  { names: ["rarete", "rarity", "seltenheit", "rarita", "rareza"], values: (d) => (d.rarity ? [d.rarity] : []) },
  { names: ["finition", "finish", "oberflache", "oberflachenveredelung", "finitura", "acabado"], values: (d) => FINISHES[d.finish] ?? [] },
  { names: ["fabricant", "manufacturer", "hersteller", "produttore", "fabricante"], values: () => ["The Pokémon Company", "Nintendo"] },
  { names: ["gradee", "graded", "gradiert", "gradata", "graduada"], values: (d, lang) => (d.grader ? YES[lang] : NO[lang]) },
  { names: ["societe de gradation", "professional grader", "bewertet von", "valutatore professionista", "evaluador profesional"], values: (d) => (d.grader ? [d.grader] : []) },
  { names: ["note", "grade", "note de gradation", "bewertung", "voto", "calificacion"], values: (d) => (d.grade ? [d.grade] : []) },
  { names: ["numero de certification", "certification number", "zertifizierungsnummer", "numero di certificazione", "numero de certificacion"], values: (d) => (d.certNumber ? [d.certNumber] : []) },
];

const YES: Record<Lang, string[]> = { fr: ["Oui", "Yes"], de: ["Ja", "Yes"], it: ["Sì", "Yes"], es: ["Sí", "Yes"] };
const NO: Record<Lang, string[]> = { fr: ["Non", "No"], de: ["Nein", "No"], it: ["No"], es: ["No"] };

const sourceOf = (aspectName: string) => SOURCES.find((s) => s.names.includes(normalize(aspectName)));

interface RawAspect {
  localizedAspectName: string;
  aspectConstraint?: { aspectRequired?: boolean; aspectMode?: "FREE_TEXT" | "SELECTION_ONLY"; aspectMaxLength?: number };
  aspectValues?: { localizedValue: string }[];
}

type Cached = { key: string; fetchedAt: string; aspects: CategoryAspect[] };

/** Caractéristiques de la catégorie sur le site, d'après la taxonomie d'eBay (gardées une semaine). */
export async function categoryAspects(sql: Db, client: EbayClient, marketplaceId: EbayMarketplaceId, categoryId: string): Promise<CategoryAspect[]> {
  const key = `${client.config.environment}:${marketplaceId}:${categoryId}`;
  const cached = await readEbayConfig<Cached>(sql, "aspects");
  if (cached?.key === key && Date.now() - Date.parse(cached.fetchedAt) < CACHE_DAYS * 86_400_000) return cached.aspects;

  const { categoryTreeId } = await client.request<{ categoryTreeId: string }>(
    "GET", `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(marketplaceId)}`);
  const r = await client.request<{ aspects?: RawAspect[] }>(
    "GET", `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(categoryTreeId)}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`);
  const aspects = (r?.aspects ?? [])
    .filter((a) => a.aspectConstraint?.aspectRequired || sourceOf(a.localizedAspectName))
    .map((a) => ({
      name: a.localizedAspectName,
      required: !!a.aspectConstraint?.aspectRequired,
      selectionOnly: a.aspectConstraint?.aspectMode === "SELECTION_ONLY",
      maxLength: a.aspectConstraint?.aspectMaxLength ?? null,
      values: sourceOf(a.localizedAspectName) ? (a.aspectValues ?? []).map((v) => v.localizedValue).slice(0, 500) : [],
    }));
  await writeEbayConfig(sql, "aspects", { key, fetchedAt: new Date().toISOString(), aspects } satisfies Cached);
  return aspects;
}

/**
 * Remplit les caractéristiques qu'on connaît. Une valeur proposée par eBay est préférée à notre texte (orthographe
 * exacte, filtres de recherche) ; quand eBay n'admet que ses valeurs et qu'aucune ne correspond, la caractéristique
 * est laissée vide plutôt que fausse.
 */
export function buildAspects(aspects: CategoryAspect[], details: CardDetails, marketplaceId: EbayMarketplaceId): Record<string, string[]> {
  const lang = EBAY_MARKETPLACES[marketplaceId].language.slice(0, 2) as Lang;
  const out: Record<string, string[]> = {};
  for (const aspect of aspects) {
    const source = sourceOf(aspect.name);
    if (!source) continue;
    const candidates = source.values(details, lang).map((v) => v.trim()).filter(Boolean);
    if (candidates.length === 0) continue;
    const offered = new Map(aspect.values.map((v) => [normalize(v), v]));
    const match = candidates.map((c) => offered.get(normalize(c))).find(Boolean);
    const value = match ?? (aspect.selectionOnly ? null : candidates[0]!);
    if (value) out[aspect.name] = [aspect.maxLength ? value.slice(0, aspect.maxLength) : value];
  }
  return out;
}

/** Caractéristiques obligatoires qu'on n'a pas su remplir. */
export function missingAspects(aspects: CategoryAspect[], filled: Record<string, string[]>): string[] {
  return aspects.filter((a) => a.required && !filled[a.name]).map((a) => a.name);
}
