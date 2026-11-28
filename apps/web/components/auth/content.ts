import { EDITION } from "@/config/edition";
import { SIGNUP_OPEN } from "@/config/site";

export interface PageSeo {
  title: string;
  description: string;
}

/** Titres et descriptions des écrans de compte. */
export const AUTH_SEO = {
  signup: SIGNUP_OPEN
    ? { title: "Crée ton compte — Dexlane", description: EDITION.signupLead }
    : { title: "Inscription sur invitation — Dexlane", description: "On entre dans une boutique Dexlane sur invitation de son équipe." },
  forgotPassword: { title: "Mot de passe oublié — Dexlane", description: "Reçois par e-mail un lien pour choisir un nouveau mot de passe Dexlane." },
} satisfies Record<string, PageSeo>;

/**
 * Inscription, vérification de l'adresse et mot de passe oublié : textes des écrans de compte, en français (comme le
 * site, ils ne passent pas par t()). [À CONFIRMER]
 */
export const AUTH = {
  email: "Adresse e-mail",
  password: "Mot de passe",
  passwordHint: "10 caractères minimum.",
  login: "Se connecter",
  backToLogin: "Retour à la connexion",
  signup: {
    title: "Crée ton compte",
    lead: EDITION.signupLead,
    submit: "Créer mon compte",
    terms: ["En créant un compte, tu acceptes les", "CGU", "et la politique de", "confidentialité"],
    haveAccount: "Déjà un compte ?",
    sentTitle: "Vérifie ta boîte mail",
    sentText: "On vient d'envoyer un lien à {email}. Clique dessus pour ouvrir ton compte. Le lien est valable 24 heures.",
    resend: "Renvoyer l'e-mail",
    resent: "Si l'adresse est correcte, un nouvel e-mail vient de partir.",
  },
  invite: {
    title: "Inscription sur invitation",
    lead: "On entre dans une boutique Dexlane parce que son équipe nous y invite.",
    text: "Demande à l'administrateur de la boutique de t'inviter depuis Réglages › Équipe. Le lien que tu recevras par e-mail ouvre ton compte.",
    haveAccount: "Déjà un compte ?",
  },
  verify: {
    title: "On ouvre ton compte",
    pending: "Vérification de ton adresse…",
    failedTitle: "Ce lien n'est plus valable",
    again: "Recommencer l'inscription",
  },
  forgot: {
    title: "Mot de passe oublié",
    lead: "Indique l'adresse de ton compte : on t'envoie un lien pour en choisir un nouveau.",
    submit: "Envoyer le lien",
    sent: "Si un compte existe avec cette adresse, un e-mail vient de partir. Le lien est valable 1 heure.",
  },
  reset: {
    title: "Nouveau mot de passe",
    lead: "Choisis ton nouveau mot de passe. Tes autres appareils seront déconnectés.",
    newPassword: "Nouveau mot de passe",
    submit: "Enregistrer le mot de passe",
    again: "Demander un nouveau lien",
  },
  errors: {
    PASSWORD_TOO_SHORT: "Le mot de passe doit faire au moins 10 caractères.",
    INVALID_EMAIL: "Vérifie l'adresse e-mail.",
    INVALID_TOKEN: "Ce lien est invalide, expiré ou déjà utilisé.",
    LINK_EXPIRED: "Ce lien est invalide, expiré ou déjà utilisé.",
    TOO_MANY_ATTEMPTS: "Trop d'essais. Réessaie dans une minute.",
    EMAIL_NOT_CONFIGURED: "L'envoi d'e-mails n'est pas encore configuré sur ce serveur.",
    SIGNUP_CLOSED: "Les inscriptions se font sur invitation : demande à l'équipe de la boutique de t'inviter.",
    API_UNREACHABLE: "Le serveur ne répond pas. Réessaie dans un instant.",
    DEFAULT: "Quelque chose n'a pas fonctionné. Réessaie dans un instant.",
  },
};
