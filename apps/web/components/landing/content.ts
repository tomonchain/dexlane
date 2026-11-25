/**
 * Copy de la landing page, reprise mot pour mot du brief. Rien n'est reformulé ici : une modification de texte passe
 * par le brief.
 *
 * Validation : tout ce que le brief marque « [À CONFIRMER] » porte `confirmed: false`. Tant qu'un élément n'est pas
 * confirmé, il est affiché avec un repère « À confirmer » en développement et en preview, et retiré en production.
 * Pour le mettre en ligne, passer `confirmed` à `true` ici.
 */

/** Liens externes et adresses du brief. `null` : pas encore fourni, le lien n'est pas affiché. */
export const LINKS = {
  /** CTA principal du brief. */
  signup: "/signup",
  /** `[URL DU REPO]` du brief. */
  github: "https://github.com/tomonchain/dexlane",
  /** `mailto:[EMAIL]` du brief : à renseigner, le lien « Écrire à Thomas » et « Contact » restent masqués d'ici là. */
  email: null as string | null,
  /** Pages légales du pied de page : pas encore rédigées, liens masqués tant qu'elles n'existent pas. */
  legal: null as string | null,
  terms: null as string | null,
  privacy: null as string | null,
};

export const SEO = {
  title: "Dexlane — Publie tes cartes Pokémon sur eBay en quelques secondes",
  description:
    "Dexlane prépare et publie tes annonces eBay à ta place : titre, catégorie, état, prix. Pensé pour les vendeurs de cartes Pokémon. Open-source, essai gratuit.",
  ogTitle: "Tes cartes en vente sur eBay. Sans y passer tes soirées.",
};

/** Variantes à tester. Seule la variante A est affichée ; la B ne doit servir que vérifiée en conditions réelles. */
export const HERO_VARIANTS = {
  A: { h1: "Tes cartes en vente sur eBay en quelques secondes. Pas en quelques soirées.", confirmed: true },
  B: { h1: "Publie 100 cartes sur eBay le temps de boire un café.", confirmed: false },
  C: { h1: "Arrête de saisir. Commence à vendre.", confirmed: true },
} as const;
export const HERO_VARIANT: keyof typeof HERO_VARIANTS = "A";

export const CTA = {
  primary: "Essayer gratuitement",
  /** Variante à tester du CTA principal. */
  primaryVariant: "Publier mes 20 premières cartes",
  secondary: "Voir le code sur GitHub",
};

export const HERO = {
  eyebrow: "Pour les vendeurs de cartes Pokémon",
  subtitle:
    "Dexlane prépare l'annonce complète (titre, catégorie, état, prix) et la publie sur ton compte eBay. Toi, tu valides. Une carte ou cinq cents d'un coup.",
  underCta: "20 cartes offertes chaque mois. Sans carte bancaire.",
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

export type FeatureIcon = "bulk" | "compliant" | "sync" | "lots" | "suggest" | "data";
export const FEATURES = {
  title: "Tout ce qui te prend du temps, Dexlane s'en charge.",
  items: [
    {
      icon: "bulk",
      title: "Publication en masse",
      text: "Sélectionne 10, 100 ou 500 cartes et publie-les en une fois. Dexlane suit chaque annonce et te signale celles qui demandent une correction.",
      confirmed: true,
    },
    {
      icon: "compliant",
      title: "Des annonces conformes du premier coup",
      text: "Catégorie exacte, état selon les critères d'eBay pour les cartes à collectionner, carte gradée ou non, société de gradation et note. Moins de refus, moins de litiges.",
      confirmed: true,
    },
    {
      icon: "sync",
      title: "Stock et prix synchronisés",
      text: "Tu changes un prix ou une quantité dans Dexlane, l'annonce eBay suit. Fini les cartes vendues deux fois.",
      confirmed: false,
    },
    {
      icon: "lots",
      title: "Vente en lots",
      text: "Regroupe tes communes et tes doubles en lots. Un lot, une annonce.",
      confirmed: false,
    },
    {
      icon: "suggest",
      title: "Suggestions de titre et de prix",
      text: "Dexlane propose un titre que les acheteurs trouvent et un prix cohérent avec le marché. Tu décides, il ne publie rien sans toi.",
      confirmed: false,
    },
    {
      icon: "data",
      title: "Tes données restent les tiennes",
      text: "Exporte ton inventaire quand tu veux. Le code est ouvert : tu peux vérifier ce que fait l'outil, ou l'héberger toi-même.",
      confirmed: true,
    },
  ] satisfies { icon: FeatureIcon; title: string; text: string; confirmed: boolean }[],
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

export const PRICING = {
  title: "Tu paies selon ce que tu publies. Rien sur ce que tu vends.",
  subtitle:
    "Dexlane ne prend aucune commission sur tes ventes. Les modifications de prix, la mise à jour du stock et les republications ne sont jamais décomptées.",
  /** Toute la grille est « [À CONFIRMER] » : prix, quotas, noms des plans. */
  confirmed: false,
  /** « Le plus choisi » uniquement quand ce sera vrai ; d'ici là, « Recommandé ». */
  featuredBadge: "Recommandé",
  quotaLabel: "Cartes publiées par mois",
  features: [
    "Connexion eBay en 1 clic",
    "Publication en masse",
    "Synchronisation prix et stock",
    "Suggestions de titre et de prix",
    "Plusieurs utilisateurs",
    "Support prioritaire",
  ],
  plans: [
    { name: "Découverte", price: "Gratuit", quota: "20", pitch: "Pour tester sur tes vraies cartes", included: 1, button: "Commencer", featured: false },
    { name: "Solo", price: "9 € / mois", quota: "150", pitch: "Pour écouler ta collection", included: 3, button: "Choisir Solo", featured: false },
    { name: "Pro", price: "29 € / mois", quota: "750", pitch: "Pour vendre toutes les semaines", included: 4, button: "Choisir Pro", featured: true },
    { name: "Boutique", price: "79 € / mois", quota: "3 000", pitch: "Pour les équipes et les gros stocks", included: 6, button: "Choisir Boutique", featured: false },
  ],
  notes: [
    "Un lot compte pour une seule carte.",
    "Tu dépasses ton forfait ? 10 € les 500 cartes supplémentaires. On te prévient avant, on ne bloque jamais une publication en cours.",
    "Sans engagement. Tu changes de forfait ou tu arrêtes quand tu veux.",
  ],
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
  /** `Licence [À CONFIRMER]` : nom de la licence à renseigner. */
  licence: { name: null as string | null, confirmed: false },
};

export const FOUNDER = {
  title: "Fait par un vendeur, pour des vendeurs.",
  /** « [À CONFIRMER — à réécrire par Thomas avec ses mots] ». */
  text:
    "Je m'appelle Thomas. Je collectionne et je vends des cartes Pokémon, et j'ai construit Dexlane parce que j'en avais assez de recopier les mêmes champs. Je l'utilise pour mes propres ventes : chaque carte que j'envoie est passée par l'outil. Si quelque chose te manque, écris-moi, c'est moi qui réponds.",
  confirmed: false,
  link: "Écrire à Thomas →",
};

/** Section masquée tant qu'il n'y a pas de vraies citations. */
export const TESTIMONIALS = {
  title: "Ce qu'en disent les vendeurs",
  items: [] as { quote: string; author: string }[],
};

export const FAQ = {
  title: "Les questions qu'on nous pose",
  items: [
    {
      q: "Dexlane a-t-il accès à mon mot de passe eBay ?",
      a: "Non. La connexion passe par le système d'autorisation officiel d'eBay : tu te connectes chez eBay, et eBay donne à Dexlane le droit de gérer tes annonces. Tu peux retirer cet accès à tout moment depuis les paramètres de ton compte eBay.",
      confirmed: true,
    },
    {
      q: "Est-ce que Dexlane prend une commission sur mes ventes ?",
      a: "Non, aucune. Tu paies ton forfait, c'est tout. Les frais de vente d'eBay restent ceux d'eBay et ne changent pas.",
      confirmed: true,
    },
    {
      q: "Qu'est-ce qui compte comme une « carte publiée » ?",
      a: "Chaque nouvelle annonce mise en ligne. Un lot de 50 cartes vendu en une annonce compte pour une. Modifier un prix, mettre à jour une quantité ou republier une annonce expirée ne compte pas.",
      confirmed: true,
    },
    {
      q: "Que se passe-t-il si je dépasse mon forfait ?",
      a: "On te prévient quand tu approches de la limite. Tu peux alors ajouter un pack de 500 cartes pour 10 €, ou passer au forfait supérieur. Tes annonces déjà en ligne ne sont jamais touchées.",
      confirmed: true,
    },
    {
      q: "Est-ce que ça marche pour les cartes gradées ?",
      a: "Oui. Dexlane renseigne la société de gradation et la note dans les champs prévus par eBay.",
      confirmed: true,
    },
    {
      q: "Je peux arrêter quand je veux ?",
      a: "Oui, sans préavis. Tes annonces restent en ligne sur eBay et tu peux exporter ton inventaire.",
      confirmed: true,
    },
    {
      q: "Quelle différence entre la version hébergée et la version open-source ?",
      a: "C'est le même cœur. La version hébergée t'évite l'installation, la création d'un compte développeur eBay et la maintenance. La version Community est gratuite, mais c'est toi qui gères la technique.",
      confirmed: true,
    },
    {
      q: "Et les autres plateformes ? Les autres jeux ?",
      a: "Aujourd'hui, Dexlane publie des cartes Pokémon sur eBay. D'autres plateformes et d'autres jeux sont à l'étude : dis-nous ce dont tu as besoin, c'est ce qui décide des priorités.",
      confirmed: false,
    },
  ],
};

export const FINAL_CTA = {
  title: "Tes cartes ne se vendront pas depuis un classeur.",
  subtitle: "Mets tes 20 premières cartes en ligne gratuitement. Si tu n'as pas gagné de temps, tu n'as rien perdu.",
  /** « [À CONFIRMER le délai réel d'inscription] ». */
  underCta: { text: "Sans carte bancaire. Prêt en deux minutes.", confirmed: false },
};

export const FOOTER = {
  legalNotice:
    "Dexlane est un outil indépendant. Il n'est ni affilié, ni approuvé, ni sponsorisé par Nintendo, The Pokémon Company, Creatures Inc., GAME FREAK inc. ou eBay Inc. Pokémon et eBay sont des marques déposées de leurs propriétaires respectifs.",
};
