import { ApiError } from "./api";
import type { CardCondition } from "./types";

/** Réglages qui restent d'une carte à l'autre : on range une série de cartes au même endroit, au même coût. */
export interface ScanSession {
  locationCode: string;
  cost: string;
  lotId: string;
  language: string;
  /** État appliqué d'office à chaque carte de la session ; vide : à choisir carte par carte. */
  condition?: CardCondition | "";
}
export const SCAN_SESSION_KEY = "dexlane.scan.session";

/** Dernier réglage du pilote automatique, repris d'un lot à l'autre. */
export interface AutopilotPrefs { on: boolean; publishMode: "NONE" | "NOW" | "DAILY"; perDay: string }
export const AUTOPILOT_KEY = "dexlane.scan.autopilot";
export const DEFAULT_AUTOPILOT: AutopilotPrefs = { on: false, publishMode: "NOW", perDay: "20" };
export const PUBLISH_MODES: { value: AutopilotPrefs["publishMode"]; label: string }[] = [
  { value: "NOW", label: "Tout de suite" }, { value: "DAILY", label: "Étalée par jour" }, { value: "NONE", label: "Pas de mise en ligne" },
];
/** « mise en ligne immédiate », « 20 mises en ligne par jour », « sans mise en ligne ». */
export const publishModeLabel = (mode: AutopilotPrefs["publishMode"], perDay: number | null) =>
  mode === "NOW" ? "mise en ligne immédiate" : mode === "DAILY" ? `${perDay} mise${(perDay ?? 0) > 1 ? "s" : ""} en ligne par jour` : "sans mise en ligne";
export const DEFAULT_SCAN_SESSION: ScanSession = { locationCode: "", cost: "0", lotId: "", language: "fr", condition: "" };

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
