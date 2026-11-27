/**
 * Copy du site marketing, reprise mot pour mot du brief (dexlane-landing-copy) et du prompt de mise à jour.
 * Rien n'est reformulé ici. Un texte manquant est écrit `[À COMPLÉTER]` plutôt qu'inventé.
 *
 * Les éléments que le brief marque « [À CONFIRMER] » sont affichés tels que rédigés ; ils sont repérés ici par un
 * commentaire `[À CONFIRMER]`. Les prix et quotas vivent dans config/plans.ts.
 */
import { FREE_PLAN, OVERAGE_PACK, PARCEL_OFFER, formatCards, formatEuros } from "@/config/plans";
import { SIGNUP_OPEN } from "@/config/site";

const FREE = formatCards(FREE_PLAN.cardsPerMonth);
const PACK = `${formatCards(OVERAGE_PACK.cards)} cartes`;
const PACK_PRICE = formatEuros(OVERAGE_PACK.priceEur);

/* ——— Référencement ——— */

export interface PageSeo {
  title: string;
  description: string;
}

export const SEO = {
  landing: {
    title: "Dexlane — Publie tes cartes Pokémon sur eBay en quelques secondes",
    description:
      "Dexlane prépare et publie tes annonces eBay à ta place : titre, catégorie, état, prix. Pensé pour les vendeurs de cartes Pokémon. Open-source, essai gratuit.",
  },
  /** Titre de partage de la landing (Open Graph). */
  ogTitle: "Tes cartes en vente sur eBay. Sans y passer tes soirées.",
  tarifs: {
    title: "Tarifs — Dexlane",
    description:
      "Dexlane ne prend aucune commission sur tes ventes. Les modifications de prix, la mise à jour du stock et les republications ne sont jamais décomptées.",
  },
  /** La copy des docs est dans components/docs/content.ts (DOCS_INDEX.seo pour la page d'accueil des docs). */
  contact: { title: "Contact — Dexlane", description: "Une question, un bug, une idée ? Écris-nous, c'est le fondateur qui répond." },
  mentionsLegales: { title: "Mentions légales — Dexlane", description: "Mentions légales de Dexlane : éditeur du site, directeur de la publication, hébergeur et contact." },
  cgu: { title: "CGU — Dexlane", description: "Conditions générales d'utilisation de Dexlane : compte, forfaits et facturation, usage du service, résiliation." },
  confidentialite: { title: "Confidentialité — Dexlane", description: "Comment Dexlane traite tes données : ce qui est collecté, pourquoi, combien de temps, par qui, et comment exercer tes droits." },
  colis: {
    title: "Tu viens de recevoir une carte vendue avec Dexlane.",
    description: `Les tiennes peuvent partir aussi vite. Ton code ${PARCEL_OFFER.code} t'offre ${PARCEL_OFFER.offer}.`,
  },
  signup: SIGNUP_OPEN
    ? { title: "Crée ton compte — Dexlane", description: `${FREE} cartes offertes chaque mois. Sans carte bancaire.` }
    : { title: "Liste d'attente — Dexlane", description: "Dexlane ouvre bientôt : laisse ton adresse, on te prévient dès que tu peux créer ton compte." },
  forgotPassword: { title: "Mot de passe oublié — Dexlane", description: "Reçois par e-mail un lien pour choisir un nouveau mot de passe Dexlane." },
  notFound: "Cette page n'existe pas.",
} satisfies Record<string, PageSeo | string>;

/* ——— Navigation ——— */

export const NAV = {
  features: "Fonctionnalités",
  pricing: "Tarifs",
  docs: "Docs",
  series: "Cotes des cartes",
  /** Lien court de l'en-tête vers /series. */
  quotes: "Cotes",
  guides: "Guides",
  github: "GitHub",
  login: "Se connecter",
  contact: "Contact",
  legal: "Mentions légales",
  terms: "CGU",
  privacy: "Confidentialité",
  groups: { product: "Produit", project: "Projet", legalGroup: "Légal" },
};

/* ——— Landing ——— */

/** Variantes à tester. Seule la variante A est affichée. */
export const HERO_VARIANTS = {
  A: { h1: "Tes cartes en vente sur eBay en quelques secondes. Pas en quelques soirées." },
  /** [À CONFIRMER : n'utiliser que si c'est vérifié en conditions réelles] */
  B: { h1: "Publie 100 cartes sur eBay le temps de boire un café." },
  C: { h1: "Arrête de saisir. Commence à vendre." },
} as const;
export const HERO_VARIANT: keyof typeof HERO_VARIANTS = "A";

export const CTA = {
  /** Inscriptions fermées : les boutons mènent à la liste d'attente (#103). */
  primary: SIGNUP_OPEN ? "Essayer gratuitement" : "Rejoindre la liste d'attente",
  /** Le bouton de l'en-tête, plus court quand les inscriptions sont fermées. */
  header: SIGNUP_OPEN ? "Essayer gratuitement" : "Liste d'attente",
  /** Variante à tester du CTA principal. */
  primaryVariant: `Publier mes ${FREE} premières cartes`,
  secondary: "Voir le code sur GitHub",
};

export const HERO = {
  eyebrow: "Pour les vendeurs de cartes Pokémon",
  subtitle:
    "Dexlane prépare l'annonce complète (titre, catégorie, état, prix) et la publie sur ton compte eBay. Toi, tu valides. Une carte ou cinq cents d'un coup.",
  underCta: SIGNUP_OPEN ? `${FREE} cartes offertes chaque mois. Sans carte bancaire.` : `Ouverture prochaine. ${FREE} cartes offertes chaque mois, sans carte bancaire.`,
  reassurance: ["Connexion eBay officielle", "Code open-source", "Sans engagement"],
};

export const PROBLEM = {
  title: "Vendre des cartes, c'est 10 % de passion et 90 % de saisie.",
  text:
    "Tu connais la routine. Le titre à rédiger, la catégorie à retrouver, l'état à renseigner, les photos, le prix, les frais de port. Compte cinq minutes par annonce : pour 300 cartes, ça fait 25 heures. Résultat, les cartes restent dans les classeurs, et un stock qui dort ne rapporte rien.",
  points: [
    { title: "Chaque annonce se refait à la main", text: "Les mêmes champs, encore et encore. Carte après carte." },
    { title: "Les erreurs coûtent cher", text: "Une mauvaise catégorie ou un état mal renseigné, et l'annonce est refusée ou le client conteste." },
    { title: "Le stock et les prix dérivent", text: "Une carte vendue ailleurs reste en ligne. Un prix d'il y a six mois n'a plus de sens." },
  ],
};

export const STEPS = {
  title: "Trois étapes. La troisième est un clic.",
  items: [
    {
      title: "Connecte ton compte eBay",
      text: "Un clic, via la connexion officielle d'eBay. Pas de clé API à créer, pas de configuration technique. Dexlane ne voit jamais ton mot de passe.",
    },
    {
      title: "Ajoute tes cartes",
      text: "Dexlane prépare l'annonce pour toi : titre, catégorie, état, description, prix. Tu corriges ce que tu veux, tu gardes la main sur tout.",
    },
    { title: "Publie", text: "À l'unité ou par centaines. Tes annonces partent sur eBay, et ton stock reste à jour ensuite." },
  ],
};

export type FeatureIcon = "bulk" | "compliant" | "sync" | "lots" | "suggest" | "data" | "location" | "margin";
export const FEATURES = {
  title: "Tout ce qui te prend du temps, Dexlane s'en charge.",
  items: [
    {
      icon: "bulk",
      title: "Publication en masse",
      text: "Sélectionne 10, 100 ou 500 cartes et publie-les en une fois. Dexlane suit chaque annonce et te signale celles qui demandent une correction.",
    },
    {
      icon: "compliant",
      title: "Des annonces conformes du premier coup",
      text: "Catégorie exacte, état selon les critères d'eBay pour les cartes à collectionner, carte gradée ou non, société de gradation et note. Moins de refus, moins de litiges.",
    },
    /* [À CONFIRMER] */
    {
      icon: "sync",
      title: "Stock et prix synchronisés",
      text: "Tu changes un prix ou une quantité dans Dexlane, l'annonce eBay suit. Fini les cartes vendues deux fois.",
    },
    /* [À CONFIRMER] */
    { icon: "lots", title: "Vente en lots", text: "Regroupe tes communes et tes doubles en lots. Un lot, une annonce." },
    /* [À CONFIRMER] */
    {
      icon: "suggest",
      title: "Suggestions de titre et de prix",
      text: "Dexlane propose un titre que les acheteurs trouvent et un prix cohérent avec le marché. Tu décides, il ne publie rien sans toi.",
    },
    {
      icon: "data",
      title: "Tes données restent les tiennes",
      text: "Exporte ton inventaire quand tu veux. Le code est ouvert : tu peux vérifier ce que fait l'outil, ou l'héberger toi-même.",
    },
    {
      icon: "location",
      title: "Retrouve chaque carte en dix secondes",
      text: "Chaque carte a son emplacement : boîte, classeur, rangée. Quand elle se vend, Dexlane te dit où la prendre.",
    },
    {
      icon: "margin",
      title: "Achats, ventes, marge",
      text: "Tu enregistres ce que tu achètes, Dexlane suit ce que tu vends. Tu vois ce que chaque carte t'a vraiment rapporté.",
    },
  ] satisfies { icon: FeatureIcon; title: string; text: string }[],
};

export const AUDIENCE = {
  title: "Que tu vendes 30 cartes ou 3 000.",
  items: [
    {
      title: "Tu vides tes classeurs",
      text: "Tu as une collection à écouler et pas envie d'y passer tes week-ends. Dexlane met tout en ligne pendant que tu fais autre chose.",
    },
    {
      title: "Tu vends régulièrement",
      text: "Tu achètes, tu ouvres, tu revends. Chaque heure de saisie en moins est une heure de sourcing en plus.",
    },
    {
      title: "Tu tiens une boutique",
      text: "Plusieurs personnes, un gros stock, des sorties d'extension à absorber. Dexlane suit le volume sans embaucher pour la saisie.",
    },
  ],
};

/* [À CONFIRMER] : toute la grille (prix, quotas, noms des plans) — voir config/plans.ts. */
export const PRICING = {
  title: "Tu paies selon ce que tu publies. Rien sur ce que tu vends.",
  subtitle:
    "Dexlane ne prend aucune commission sur tes ventes. Les modifications de prix, la mise à jour du stock et les republications ne sont jamais décomptées.",
  quotaLabel: "Cartes publiées par mois",
  scansLabel: "scans par mois",
  /** Grille courte : ce qu'inclut le premier forfait, puis ce que chaque forfait ajoute au précédent. */
  includes: "Inclus",
  includesAll: "Tout {plan}, plus :",
  notes: [
    "Un lot compte pour une seule carte.",
    `Tu dépasses ton forfait ? ${PACK_PRICE} les ${PACK} supplémentaires. On te prévient avant, on ne bloque jamais une publication en cours.`,
    "Sans engagement. Tu changes de forfait ou tu arrêtes quand tu veux.",
  ],
  detailLink: "Voir le détail des tarifs →",
  selfHost: {
    title: "Tu préfères l'héberger toi-même ?",
    text: "Dexlane est open-source. La version Community est gratuite et sans limite de cartes, avec tes propres clés développeur eBay.",
    link: "Voir sur GitHub →",
  },
};

export const OPEN_SOURCE = {
  title: "Le code est ouvert. Vérifie par toi-même.",
  text:
    "Tu confies à Dexlane ton stock et l'accès à ton compte vendeur. Tu as le droit de savoir ce qu'il en fait. Tout le code est public : tu peux le lire, l'auditer, le faire tourner sur ta propre machine, ou proposer des améliorations.",
  columns: [
    { title: "Version hébergée", text: "Rien à installer. Connexion eBay en un clic, mises à jour automatiques, sauvegardes. Tu t'inscris et tu publies." },
    {
      title: "Version Community",
      text: "Gratuite, à installer sur ton serveur. Tu crées ton propre compte développeur eBay et tu gères toi-même l'hébergement.",
    },
  ],
  /** Licence du code (fichier LICENSE du dépôt). */
  licence: "Licence AGPL-3.0",
};

export const FOUNDER = {
  title: "Fait par un vendeur, pour des vendeurs.",
  /* [À CONFIRMER — à réécrire par Thomas avec ses mots] */
  text:
    "Je m'appelle Thomas. Je collectionne et je vends des cartes Pokémon, et j'ai construit Dexlane parce que j'en avais assez de recopier les mêmes champs. Je l'utilise pour mes propres ventes : chaque carte que j'envoie est passée par l'outil. Si quelque chose te manque, écris-moi, c'est moi qui réponds.",
  link: "Écrire à Thomas →",
};

/** Section masquée tant qu'il n'y a pas de vraies citations. */
export const TESTIMONIALS = {
  title: "Ce qu'en disent les vendeurs",
  items: [] as { quote: string; author: string }[],
};

export type FaqId = "password" | "commission" | "published" | "overage" | "graded" | "stop" | "versions" | "platforms";
export const FAQ = {
  title: "Les questions qu'on nous pose",
  items: [
    {
      id: "password",
      q: "Dexlane a-t-il accès à mon mot de passe eBay ?",
      a: "Non. La connexion passe par le système d'autorisation officiel d'eBay : tu te connectes chez eBay, et eBay donne à Dexlane le droit de gérer tes annonces. Tu peux retirer cet accès à tout moment depuis les paramètres de ton compte eBay.",
    },
    {
      id: "commission",
      q: "Est-ce que Dexlane prend une commission sur mes ventes ?",
      a: "Non, aucune. Tu paies ton forfait, c'est tout. Les frais de vente d'eBay restent ceux d'eBay et ne changent pas.",
    },
    {
      id: "published",
      q: "Qu'est-ce qui compte comme une « carte publiée » ?",
      a: "Chaque nouvelle annonce mise en ligne. Un lot de 50 cartes vendu en une annonce compte pour une. Modifier un prix, mettre à jour une quantité ou republier une annonce expirée ne compte pas.",
    },
    {
      id: "overage",
      q: "Que se passe-t-il si je dépasse mon forfait ?",
      a: `On te prévient quand tu approches de la limite. Tu peux alors ajouter un pack de ${PACK} pour ${PACK_PRICE}, ou passer au forfait supérieur. Tes annonces déjà en ligne ne sont jamais touchées.`,
    },
    {
      id: "graded",
      q: "Est-ce que ça marche pour les cartes gradées ?",
      a: "Oui. Dexlane renseigne la société de gradation et la note dans les champs prévus par eBay.",
    },
    {
      id: "stop",
      q: "Je peux arrêter quand je veux ?",
      a: "Oui, sans préavis. Tes annonces restent en ligne sur eBay et tu peux exporter ton inventaire.",
    },
    {
      id: "versions",
      q: "Quelle différence entre la version hébergée et la version open-source ?",
      a: "C'est le même cœur. La version hébergée t'évite l'installation, la création d'un compte développeur eBay et la maintenance. La version Community est gratuite, mais c'est toi qui gères la technique.",
    },
    /* [À CONFIRMER] */
    {
      id: "platforms",
      q: "Et les autres plateformes ? Les autres jeux ?",
      a: "Aujourd'hui, Dexlane publie des cartes Pokémon sur eBay. D'autres plateformes et d'autres jeux sont à l'étude : dis-nous ce dont tu as besoin, c'est ce qui décide des priorités.",
    },
  ] satisfies { id: FaqId; q: string; a: string }[],
};

/** Questions de la FAQ qui concernent le prix, reprises sur /tarifs. */
export const PRICING_FAQ: FaqId[] = ["commission", "published", "overage", "stop"];

export const FINAL_CTA = {
  title: "Tes cartes ne se vendront pas depuis un classeur.",
  subtitle: `Mets tes ${FREE} premières cartes en ligne gratuitement. Si tu n'as pas gagné de temps, tu n'as rien perdu.`,
  /* [À CONFIRMER le délai réel d'inscription] */
  underCta: "Sans carte bancaire. Prêt en deux minutes.",
};

export const FOOTER = {
  legalNotice:
    "Dexlane est un outil indépendant. Il n'est ni affilié, ni approuvé, ni sponsorisé par Nintendo, The Pokémon Company, Creatures Inc., GAME FREAK inc. ou eBay Inc. Pokémon et eBay sont des marques déposées de leurs propriétaires respectifs.",
};

/* ——— Autres pages ——— */

export const CONTACT = {
  title: "Contact",
  text: "Une question, un bug, une idée ? Écris-nous, c'est le fondateur qui répond.",
};

export const PARCEL = {
  title: "Tu viens de recevoir une carte vendue avec Dexlane.",
  subtitle: `Les tiennes peuvent partir aussi vite. Ton code ${PARCEL_OFFER.code} t'offre ${PARCEL_OFFER.offer}.`,
};

/**
 * Inscription, vérification de l'adresse et mot de passe oublié. Ces textes ne figurent pas dans le brief : rédigés au
 * plus court, dans son ton. [À CONFIRMER]
 */
export const AUTH = {
  email: "Adresse e-mail",
  password: "Mot de passe",
  passwordHint: "10 caractères minimum.",
  login: "Se connecter",
  backToLogin: "Retour à la connexion",
  signup: {
    title: "Crée ton compte",
    lead: HERO.underCta,
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

export const NOT_FOUND = { title: "Cette page n'existe pas.", home: "Accueil" };
