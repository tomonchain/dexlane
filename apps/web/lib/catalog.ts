import { ApiError } from "./api";

export const CATALOG_LANGUAGES: [string, string][] = [
  ["fr", "Français"], ["en", "Anglais"], ["de", "Allemand"], ["it", "Italien"], ["es", "Espagnol"], ["pt", "Portugais"], ["ja", "Japonais"],
];

const ERRORS: Record<string, string> = {
  CATALOG_SOURCE_UNAVAILABLE: "La source du catalogue (TCGdex) ne répond pas. Réessayez dans un moment.",
  CATALOG_SET_NOT_FOUND: "Cette série n'existe pas dans cette langue.",
  NETWORK: "Connexion interrompue. L'import a pu continuer côté serveur : rechargez la liste, puis relancez si besoin.",
};
export const catalogMessage = (e: unknown) => (e instanceof ApiError ? (ERRORS[e.code] ?? e.message) : (e as Error).message);
export const importedLabel = (n: number) => `${n} carte${n > 1 ? "s importées" : " importée"}`;

/** Minuscules sans accents, pour comparer une saisie à un nom. */
export const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
