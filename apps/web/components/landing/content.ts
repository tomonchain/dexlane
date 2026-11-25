/**
 * Copy du site marketing, reprise mot pour mot du brief (dexlane-landing-copy) et du prompt de mise à jour.
 * Rien n'est reformulé ici. Un texte manquant est écrit `[À COMPLÉTER]` plutôt qu'inventé.
 *
 * Les éléments que le brief marque « [À CONFIRMER] » sont affichés tels que rédigés ; ils sont repérés ici par un
 * commentaire `[À CONFIRMER]`. Les prix et quotas vivent dans config/plans.ts.
 */
import { FREE_PLAN, OVERAGE_PACK, PARCEL_OFFER, formatCards, formatEuros } from "@/config/plans";

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
  docs: { title: "Docs — Dexlane", description: "[À COMPLÉTER]" },
  contact: { title: "Contact — Dexlane", description: "Une question, un bug, une idée ? Écris-nous, c'est le fondateur qui répond." },
  mentionsLegales: { title: "Mentions légales — Dexlane", description: "[À COMPLÉTER]" },
  cgu: { title: "CGU — Dexlane", description: "[À COMPLÉTER]" },
  confidentialite: { title: "Confidentialité — Dexlane", description: "[À COMPLÉTER]" },
  colis: {
    title: "Tu viens de recevoir une carte vendue avec Dexlane.",
    description: `Les tiennes peuvent partir aussi vite. Ton code ${PARCEL_OFFER.code} t'offre ${PARCEL_OFFER.offer}.`,
  },
  notFound: "Cette page n'existe pas.",
} satisfies Record<string, PageSeo | string>;

/* ——— Navigation ——— */

export const NAV = {
  features: "Fonctionnalités",
  pricing: "Tarifs",
  docs: "Docs",
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
  primary: "Essayer gratuitement",
  /** Variante à tester du CTA principal. */
  primaryVariant: `Publier mes ${FREE} premières cartes`,
  secondary: "Voir le code sur GitHub",
};

export const HERO = {
  eyebrow: "Pour les vendeurs de cartes Pokémon",
  subtitle:
    "Dexlane prépare l'annonce complète (titre, catégorie, état, prix) et la publie sur ton compte eBay. Toi, tu valides. Une carte ou cinq cents d'un coup.",
  underCta: `${FREE} cartes offertes chaque mois. Sans carte bancaire.`,
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
  /* [À CONFIRMER] */
  licence: "Licence [À CONFIRMER]",
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

export const DOCS = {
  title: "Docs",
  entries: ["Démarrer avec la version hébergée", "Installer la version Community"],
};

export const NOT_FOUND = { title: "Cette page n'existe pas.", home: "Accueil" };
