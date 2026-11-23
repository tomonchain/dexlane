import type { CardCondition } from "@dexlane/inventory";

/** Longueur maximale d'un titre d'annonce (limite eBay, la plus stricte des canaux visés). */
export const TITLE_MAX = 80;

export type Background =
  | { type: "color"; color: string }
  | { type: "gradient"; from: string; to: string; angle: number }
  | { type: "image"; photoId: string };

/** Mise en scène d'un scan pour l'annonce : la carte posée sur un fond, au format carré. */
export interface PhotoStyle {
  background: Background;
  /** Côté de l'image produite, en pixels. */
  size: number;
  /** Marge autour de la carte, en pourcentage de la hauteur de l'image. */
  marginPercent: number;
  /** Bord du scan retiré de chaque côté, en pourcentage (liseré laissé par le scanner). */
  trimPercent: number;
  roundCorners: boolean;
  shadow: boolean;
  /** Texte discret en bas de l'image (pseudo du vendeur, par exemple). */
  caption: string;
  /** Logo de la boutique, posé dans un coin du visuel ; null : aucun. */
  logoPhotoId: string | null;
  /** Coin où se placent le logo et la mention « powered by Dexlane ». */
  brandPosition: BrandPosition;
  /** Mention « powered by » avec le logo Dexlane complet, à côté du logo de la boutique. */
  poweredBy: boolean;
}

export type BrandPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface ListingSettings {
  titleTemplate: string;
  descriptionTemplate: string;
  photo: PhotoStyle;
  /** Image ajoutée en dernière photo de chaque annonce (message commercial) ; null : aucune. */
  promoPhotoId: string | null;
  /** Le visuel d'annonce (carte sur le fond choisi) est composé d'office dès qu'une photo arrive. */
  autoCompose: boolean;
}

export const DEFAULT_LISTING_SETTINGS: ListingSettings = {
  titleTemplate: "{nom} {numero} {serie} {variante} {langue} {etat} Carte Pokémon",
  descriptionTemplate: [
    "{nom} — {serie} ({numero})",
    "",
    "Variante : {variante}",
    "Rareté : {rarete}",
    "Langue : {langue_nom}",
    "État : {etat_nom} ({etat})",
    "",
    "Carte authentique, conservée sous pochette. Envoi soigné sous protection rigide.",
    "Référence : {sku}",
  ].join("\n"),
  photo: {
    background: { type: "gradient", from: "#1e293b", to: "#0f172a", angle: 135 },
    size: 1600, marginPercent: 9, trimPercent: 0, roundCorners: true, shadow: true, caption: "",
    logoPhotoId: null, brandPosition: "bottom-left", poweredBy: true,
  },
  promoPhotoId: null,
  autoCompose: true,
};

export const VARIABLES = [
  { key: "nom", label: "Nom de la carte", example: "Dracaufeu" },
  { key: "numero", label: "Numéro", example: "4/102" },
  { key: "serie", label: "Série", example: "Set de Base" },
  { key: "serie_code", label: "Code de la série", example: "BASE1" },
  { key: "bloc", label: "Bloc", example: "Wizards" },
  { key: "variante", label: "Variante", example: "Holo" },
  { key: "rarete", label: "Rareté", example: "Rare" },
  { key: "langue", label: "Langue (code)", example: "FR" },
  { key: "langue_nom", label: "Langue", example: "Français" },
  { key: "etat", label: "État (code)", example: "NM" },
  { key: "etat_nom", label: "État", example: "Near Mint" },
  { key: "prix", label: "Prix cible", example: "250 €" },
  { key: "sku", label: "Référence de l'offre", example: "OF-BASE1-004-FR-H1-NM" },
] as const;
export type VariableKey = (typeof VARIABLES)[number]["key"];

const CONDITION_NAMES: Record<CardCondition, string> = {
  MT: "Mint", NM: "Near Mint", EX: "Excellent", GD: "Good", LP: "Light Played", PL: "Played", PO: "Poor",
};
const LANGUAGE_NAMES: Record<string, string> = {
  fr: "Français", en: "Anglais", de: "Allemand", it: "Italien", es: "Espagnol", pt: "Portugais", ja: "Japonais",
};
const FINISH_NAMES: Record<string, string> = { normal: "Normale", holo: "Holo", reverse: "Reverse" };

/** Ce qu'on sait d'une offre pour rédiger son annonce. */
export interface ListingSubject {
  name: string;
  localNumber: string;
  setId: string;
  setName: string | null;
  serieName: string | null;
  officialCount: number | null;
  language: string;
  rarity: string | null;
  finish: string;
  edition: string;
  subtype: string;
  stamp: string;
  condition: CardCondition;
  offerSku: string;
  targetPriceCents: number | null;
}

export function variantName(v: Pick<ListingSubject, "finish" | "edition" | "subtype" | "stamp">): string {
  return [
    FINISH_NAMES[v.finish] ?? (v.finish === "unknown" ? "" : v.finish),
    v.edition === "1st" ? "Édition 1" : v.edition,
    v.subtype,
    v.stamp && `tampon ${v.stamp}`,
  ].filter(Boolean).join(" ");
}

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

export function variablesOf(s: ListingSubject): Record<VariableKey, string> {
  // « 4/102 » quand le numéro et le total imprimé sont numériques ; les numéros spéciaux (TG05, SWSH123) restent seuls.
  const numeric = /^\d+$/.test(s.localNumber);
  return {
    nom: s.name,
    numero: numeric && s.officialCount ? `${Number(s.localNumber)}/${s.officialCount}` : s.localNumber,
    serie: s.setName ?? s.setId.toUpperCase(),
    serie_code: s.setId.toUpperCase(),
    bloc: s.serieName ?? "",
    variante: variantName(s),
    rarete: s.rarity ?? "",
    langue: s.language.toUpperCase(),
    langue_nom: LANGUAGE_NAMES[s.language] ?? s.language.toUpperCase(),
    etat: s.condition,
    etat_nom: CONDITION_NAMES[s.condition],
    prix: s.targetPriceCents === null ? "" : euros.format(s.targetPriceCents / 100).replace(/,00(?=\s)/, ""),
    sku: s.offerSku,
  };
}

const KNOWN = new Set<string>(VARIABLES.map((v) => v.key));

/** Variables inconnues d'un modèle (faute de frappe) : elles resteraient telles quelles dans l'annonce. */
export function unknownVariables(template: string): string[] {
  return [...new Set([...template.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]!).filter((key) => !KNOWN.has(key)))];
}

/**
 * Remplit un modèle. Une ligne dont toutes les variables sont vides disparaît (« Rareté : » sans rareté),
 * et les espaces laissés par une variable vide sont resserrés.
 */
export function renderTemplate(template: string, values: Record<string, string>): string {
  const lines: string[] = [];
  for (const line of template.split("\n")) {
    const used = [...line.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]!).filter((key) => key in values);
    if (used.length > 0 && used.every((key) => values[key] === "")) continue;
    lines.push(
      line
        .replace(/\{([a-z_]+)\}/g, (whole, key: string) => (key in values ? values[key]! : whole))
        .replace(/\(\s*\)/g, "")
        .replace(/[ \t]{2,}/g, " ")
        .trim(),
    );
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Coupe un titre trop long à la limite d'un mot. */
export function truncateTitle(title: string, max = TITLE_MAX): string {
  if (title.length <= max) return title;
  const cut = title.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : title.slice(0, max)).trim();
}

export type ListingWarning = "TITLE_TOO_LONG" | "UNKNOWN_VARIABLE";

export interface ListingText {
  title: string;
  description: string;
  warnings: ListingWarning[];
}

export function buildListingText(subject: ListingSubject, settings: Pick<ListingSettings, "titleTemplate" | "descriptionTemplate">): ListingText {
  const values = variablesOf(subject);
  const full = renderTemplate(settings.titleTemplate, values).replace(/\s*\n\s*/g, " ");
  const warnings: ListingWarning[] = [];
  if (full.length > TITLE_MAX) warnings.push("TITLE_TOO_LONG");
  if (unknownVariables(settings.titleTemplate + settings.descriptionTemplate).length > 0) warnings.push("UNKNOWN_VARIABLE");
  return { title: truncateTitle(full), description: renderTemplate(settings.descriptionTemplate, values), warnings };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Message d'erreur (en français, montré tel quel) ou null si les réglages sont valides. */
export function validateListingSettings(s: ListingSettings): string | null {
  if (!s.titleTemplate.trim()) return "Le modèle de titre est vide.";
  if (!s.descriptionTemplate.trim()) return "Le modèle de description est vide.";
  if (s.titleTemplate.length > 300 || s.descriptionTemplate.length > 4000) return "Le modèle est trop long.";
  const p = s.photo;
  if (!Number.isInteger(p.size) || p.size < 800 || p.size > 2400) return "La taille des photos doit être comprise entre 800 et 2400 pixels.";
  if (p.marginPercent < 0 || p.marginPercent > 30) return "La marge doit être comprise entre 0 et 30 %.";
  if (p.trimPercent < 0 || p.trimPercent > 8) return "Le rognage doit être compris entre 0 et 8 %.";
  if (p.caption.length > 60) return "Le texte des photos est limité à 60 caractères.";
  const b = p.background;
  const colors = b.type === "color" ? [b.color] : b.type === "gradient" ? [b.from, b.to] : [];
  if (colors.some((c) => !HEX.test(c))) return "Couleur de fond invalide.";
  return null;
}
