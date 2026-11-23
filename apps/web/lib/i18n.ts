import { EN } from "./i18n/en";

/**
 * Langue de l'interface. Le français est la langue source : chaque texte s'écrit en français dans le code et passe par
 * `t()`, qui le remplace par sa traduction anglaise quand l'anglais est choisi (dictionnaire `lib/i18n/en`).
 * Un texte absent du dictionnaire reste en français ; `pnpm --filter @dexlane/web i18n` liste les manquants.
 *
 * La langue vient d'un cookie (choisie dans Compte), à défaut de la langue du navigateur. Le fournisseur
 * `I18nProvider` la pose à chaque rendu, avant les composants qui traduisent : `t()` ne s'appelle donc jamais au
 * chargement d'un module (une constante de module garde ses textes en français, traduits là où ils s'affichent).
 */
export type Locale = "fr" | "en";
export const LOCALES: { value: Locale; label: string }[] = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
];
export const LOCALE_COOKIE = "dexlane-locale";

let current: Locale = "fr";
export const getLocale = (): Locale => current;
export function setCurrentLocale(locale: Locale) {
  current = locale;
}
/** Locale des formats de nombres, de montants et de dates. */
export const intlLocale = () => (current === "en" ? "en-GB" : "fr-FR");

type Vars = Record<string, string | number>;
const fill = (template: string, vars?: Vars) =>
  vars ? template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match)) : template;

/** Traduit un texte écrit en français ; `{nom}` est remplacé par `vars.nom`. */
export function t(text: string, vars?: Vars): string {
  return fill(current === "en" ? (EN[text] ?? text) : text, vars);
}

/**
 * Accord en nombre : `tn(n, "{n} carte", "{n} cartes")`. Le singulier vaut pour 0 et 1 en français, pour 1 seulement
 * en anglais ; `{n}` est le nombre mis en forme.
 */
export function tn(n: number, one: string, many: string, vars?: Vars): string {
  const singular = current === "en" ? n === 1 : n <= 1;
  return t(singular ? one : many, { n: n.toLocaleString(intlLocale()), ...vars });
}

/** Langue d'une requête : le cookie, sinon le français si c'est la langue préférée du navigateur, sinon l'anglais. */
export function resolveLocale(cookie: string | undefined, acceptLanguage: string | null | undefined): Locale {
  if (cookie === "fr" || cookie === "en") return cookie;
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return first === "" || first.startsWith("fr") ? "fr" : "en";
}
