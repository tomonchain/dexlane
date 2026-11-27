import { ApiError } from "./api";
import { t } from "./i18n";

const wait = (seconds: number) => (seconds >= 90 ? `${Math.ceil(seconds / 60)} min` : `${seconds} s`);

/** Message affiché pour une erreur de connexion ou de changement de mot de passe. */
export function authMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return (e as Error).message;
  const retryAfterS = (e.details as { retryAfterS?: number } | undefined)?.retryAfterS;
  switch (e.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return t("Adresse e-mail ou mot de passe incorrect.");
    case "PASSWORD_TOO_SHORT":
    case "PASSWORD_TOO_LONG":
      return t("Le mot de passe doit faire au moins 10 caractères.");
    case "EMAIL_TAKEN":
      return t("Cette adresse e-mail appartient déjà à un autre compte.");
    case "INVALID_EMAIL":
    case "VALIDATION_ERROR":
      return t("Vérifie l'adresse e-mail.");
    case "BANNED_USER":
      return t("Ce compte est suspendu.");
    case "INVALID_PASSWORD":
      return retryAfterS ? t("Mot de passe incorrect. Trop d'essais : nouvel essai possible dans {wait}.", { wait: wait(retryAfterS) }) : t("Mot de passe incorrect.");
    case "TOO_MANY_ATTEMPTS":
      return t("Trop d'essais. Réessaie dans {wait}.", { wait: wait(retryAfterS ?? 60) });
    case "WEAK_PASSWORD":
      return t("Le mot de passe doit faire au moins 10 caractères.");
    case "INVALID_SETUP_TOKEN":
      return t("Jeton d'installation refusé.");
    case "EMAIL_NOT_VERIFIED":
      return t("Cette adresse e-mail n'a pas encore été vérifiée : suis le lien reçu par e-mail.");
    case "PASSWORD_NOT_SET":
      return t("Aucun mot de passe n'est encore défini.");
    case "API_UNREACHABLE":
      return t("Le serveur dexlane ne répond pas. Vérifie qu'il est démarré.");
    case "SERVER_MISCONFIGURED":
      return t("Configuration incomplète : DEXLANE_API_TOKEN doit être défini sur le serveur.");
    default:
      return e.message;
  }
}
