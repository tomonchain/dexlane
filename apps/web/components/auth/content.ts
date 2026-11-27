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
    : { title: "Liste d'attente — Dexlane", description: "Dexlane ouvre bientôt : laisse ton adresse, on te prévient dès que tu peux créer ton compte." },
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
  waitlist: {
    title: "Rejoins la liste d'attente",
    lead: "Dexlane ouvre bientôt ses inscriptions. Laisse ton adresse : on te prévient dès que tu peux créer ton compte.",
    volume: "Combien de cartes vends-tu par mois ?",
    volumes: [["", "Je ne sais pas encore"], ["lt50", "Moins de 50"], ["50-200", "50 à 200"], ["200-1000", "200 à 1 000"], ["gt1000", "Plus de 1 000"]] as [string, string][],
    submit: "Rejoindre la liste d'attente",
    privacy: ["Ton adresse sert seulement à te prévenir de l'ouverture.", "Confidentialité"],
    haveAccount: "Déjà un compte ?",
    doneTitle: "C'est noté",
    doneText: "On écrira à {email} dès l'ouverture des inscriptions. Rien d'autre.",
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
    SIGNUP_CLOSED: "Les inscriptions ne sont pas encore ouvertes : rejoins la liste d'attente.",
    API_UNREACHABLE: "Le serveur ne répond pas. Réessaie dans un instant.",
    DEFAULT: "Quelque chose n'a pas fonctionné. Réessaie dans un instant.",
  },
};
