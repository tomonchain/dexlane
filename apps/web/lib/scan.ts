import { ApiError } from "./api";

/** Réglages qui restent d'une carte à l'autre : on range une série de cartes au même endroit, au même coût. */
export interface ScanSession {
  locationCode: string;
  cost: string;
  lotId: string;
  language: string;
}
export const SCAN_SESSION_KEY = "dexlane.scan.session";
export const DEFAULT_SCAN_SESSION: ScanSession = { locationCode: "", cost: "0", lotId: "", language: "fr" };

export const LANGUAGES: [string, string][] = [
  ["fr", "Français"], ["en", "Anglais"], ["de", "Allemand"], ["it", "Italien"], ["es", "Espagnol"], ["pt", "Portugais"], ["ja", "Japonais"],
];

const SCAN_ERRORS: Record<string, string> = {
  SCAN_UNAVAILABLE: "La lecture automatique est indisponible. Recherchez la carte à la main.",
  REFUSED: "Le modèle n'a pas pu lire cette photo. Recherchez la carte à la main ou reprenez la photo.",
  TRUNCATED: "La lecture a été interrompue. Reprenez la photo ou recherchez la carte à la main.",
  UNPARSEABLE: "La lecture n'a pas abouti. Reprenez la photo ou recherchez la carte à la main.",
  IMAGE_TOO_LARGE: "Photo trop lourde. Reprenez-la d'un peu plus loin.",
  UNSUPPORTED_MEDIA_TYPE: "Format d'image non pris en charge. Prenez la photo en JPEG.",
};
const SUBMIT_ERRORS: Record<string, string> = {
  LOCATION_NOT_FOUND: "Cet emplacement n'existe pas. Choisissez-en un autre.",
  ACQUISITION_LOT_NOT_FOUND: "Ce lot d'acquisition n'existe plus. Choisissez-en un autre.",
  INSUFFICIENT_STOCK: "Le lot de vrac ne contient plus assez de cartes.",
  NOT_BULK: "Cette position n'est pas un lot de vrac.",
  VARIANT_NOT_FOUND: "Cette variante n'existe plus dans le catalogue. Relancez la recherche.",
  NETWORK: "Connexion impossible. Réessayez : la même saisie ne sera pas enregistrée deux fois.",
};

const translate = (table: Record<string, string>) => (e: unknown) =>
  e instanceof ApiError ? (table[e.code] ?? e.message) : (e as Error).message;
export const scanErrorMessage = translate(SCAN_ERRORS);
export const submitErrorMessage = translate(SUBMIT_ERRORS);
