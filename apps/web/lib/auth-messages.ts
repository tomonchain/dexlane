import { ApiError } from "./api";
import { t } from "./i18n";

const wait = (seconds: number) => (seconds >= 90 ? `${Math.ceil(seconds / 60)} min` : `${seconds} s`);

/** Message affiché pour une erreur de connexion ou de changement de mot de passe. */
export function authMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return (e as Error).message;
  const retryAfterS = (e.details as { retryAfterS?: number } | undefined)?.retryAfterS;
  switch (e.code) {
    case "INVALID_PASSWORD":
      return retryAfterS ? t("Mot de passe incorrect. Trop d'essais : nouvel essai possible dans {wait}.", { wait: wait(retryAfterS) }) : t("Mot de passe incorrect.");
    case "TOO_MANY_ATTEMPTS":
      return t("Trop d'essais. Réessayez dans {wait}.", { wait: wait(retryAfterS ?? 60) });
    case "WEAK_PASSWORD":
      return t("Le mot de passe doit faire au moins 10 caractères.");
    case "INVALID_SETUP_TOKEN":
      return t("Jeton d'installation refusé.");
    case "PASSWORD_NOT_SET":
      return t("Aucun mot de passe n'est encore défini.");
    case "API_UNREACHABLE":
      return t("Le serveur dexlane ne répond pas. Vérifiez qu'il est démarré.");
    case "SERVER_MISCONFIGURED":
      return t("Configuration incomplète : DEXLANE_API_TOKEN doit être défini sur le serveur.");
    default:
      return e.message;
  }
}
