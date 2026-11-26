/**
 * Documentation publique (/docs) : une page par sujet, rangées en groupes. Tutoiement, comme le reste du site.
 *
 * Mise en forme dans les textes : `**gras**`, `` `code` `` et `[lien](/adresse)` (voir components/docs/prose.tsx).
 * Les forfaits, prix et quotas viennent de config/plans.ts : rien n'est recopié à la main.
 */
import { FREE_PLAN, OVERAGE_PACK, PLANS, PLAN_FEATURES, formatCards, formatEuros, formatPlanPrice } from "@/config/plans";
import { GITHUB_ISSUES_URL, GITHUB_URL } from "@/config/site";

export type DocBlock =
  | { p: string }
  | { list: string[] }
  | { steps: string[] }
  | { code: string; label?: string }
  | { note: string; tone?: "info" | "warning" }
  | { table: { head: string[]; rows: string[][] } }
  | { faq: { q: string; a: string }[] };

export interface DocSection {
  id: string;
  title: string;
  blocks: DocBlock[];
}

export interface DocPage {
  slug: string;
  title: string;
  /** Une phrase : sous le titre, dans l'index et en description pour les moteurs. */
  lead: string;
  group: DocGroup;
  sections: DocSection[];
}

export type DocGroup = "start" | "sell" | "account" | "tech";
export const DOC_GROUPS: { id: DocGroup; title: string }[] = [
  { id: "start", title: "Bien démarrer" },
  { id: "sell", title: "Vendre avec Dexlane" },
  { id: "account", title: "Compte et forfaits" },
  { id: "tech", title: "Technique" },
];

const FREE = formatCards(FREE_PLAN.cardsPerMonth);
const PACK = `${formatCards(OVERAGE_PACK.cards)} cartes`;
const PACK_PRICE = formatEuros(OVERAGE_PACK.priceEur);
const PACK_SCANS = OVERAGE_PACK.scans;
const featureLabel = (id: string) => PLAN_FEATURES.find((f) => f.id === id)?.label ?? id;

export const DOCS_INDEX = {
  title: "Documentation",
  lead: "Tout ce qu'il faut pour passer d'une pile de cartes à des annonces eBay en ligne : la version hébergée pas à pas, les forfaits, et l'installation de la version Community sur ton propre serveur.",
  seo: {
    title: "Docs — Dexlane",
    description: "Guide de Dexlane : connexion eBay, ajout des cartes, prix, publication en masse, ventes et envois, forfaits, version Community et serveur MCP.",
  },
  navLabel: "Documentation",
  menu: "Sommaire de la documentation",
  onThisPage: "Sur cette page",
  previous: "Précédent",
  next: "Suivant",
  help: { title: "Une question sans réponse ici ?", text: "Écris-nous, c'est le fondateur qui répond. Un bug ? Ouvre un ticket sur GitHub.", contact: "Contact", issues: "Signaler un bug" },
};

export const DOC_PAGES: DocPage[] = [
  /* ——— Bien démarrer ——— */
  {
    slug: "demarrer",
    group: "start",
    title: "Démarrer avec la version hébergée",
    lead: "De l'inscription à ta première annonce : compte, démarrage guidé, connexion eBay, puis tes premières cartes.",
    sections: [
      {
        id: "compte",
        title: "Crée ton compte",
        blocks: [
          { p: `Sur [la page d'inscription](/signup), indique ton adresse e-mail et un mot de passe de 10 caractères au moins. Le forfait Découverte est gratuit, sans carte bancaire : ${FREE} cartes publiées chaque mois.` },
          { p: "Un e-mail de confirmation part aussitôt. Clique sur le lien qu'il contient (valable 24 heures) : ton adresse est vérifiée, ta session s'ouvre et le démarrage guidé commence. Tant que l'adresse n'est pas vérifiée, la connexion est refusée." },
          { note: "Tu n'as rien reçu ? Regarde dans les indésirables, puis utilise « Renvoyer l'e-mail » sur l'écran de confirmation." },
        ],
      },
      {
        id: "demarrage-guide",
        title: "Le démarrage guidé",
        blocks: [
          { p: "Quatre étapes, chacune peut être passée et retrouvée plus tard dans **Réglages** :" },
          {
            steps: [
              "**Ta boutique** : le nom et les coordonnées qui apparaissent sur tes bons de livraison et tes reçus.",
              "**Comment scannes-tu tes cartes ?** Scanner à défilement, appareil photo du téléphone ou fichiers déjà sur ton ordinateur.",
              "**Où ranges-tu tes cartes ?** Le nombre de boîtes et de classeurs : Dexlane crée les emplacements (`BOITE-01`, `CLASSEUR-01`…). Écris ces codes sur tes boîtes.",
              "**Tes envois et tes prix** : l'affranchissement habituel (lettre simple, lettre suivie, colis) et ta stratégie de prix.",
            ],
          },
        ],
      },
      {
        id: "ebay",
        title: "Connecte ton compte eBay",
        blocks: [
          { p: "Dans **Réglages › Canaux de vente › eBay**, clique sur « Connecter le compte eBay ». Tu te connectes chez eBay, qui donne à Dexlane le droit de publier tes annonces et de lire tes commandes. Dexlane ne voit jamais ton mot de passe eBay." },
          { p: "Choisis ensuite le site eBay et tes règles de vente (envoi, paiement, retours) et ton lieu d'expédition — ou laisse Dexlane les créer pour toi. Le détail est dans [Connexion et réglages eBay](/docs/ebay)." },
        ],
      },
      {
        id: "premieres-cartes",
        title: "Tes premières cartes",
        blocks: [
          { p: "Depuis l'**Accueil** ou le **Stock**, « Ajouter des cartes » : scanne une pile, photographie une carte au téléphone ou cherche-la dans le catalogue. Chaque carte reconnue entre en stock avec son état, son emplacement et un prix proposé. Voir [Ajouter des cartes](/docs/ajouter-des-cartes)." },
          { p: "Une carte est prête à publier quand elle a un prix, au moins une photo et une variante confirmée. Sélectionne-la dans le Stock et publie-la, ou planifie tout un lot : voir [Publier et planifier](/docs/publier)." },
        ],
      },
      {
        id: "accueil",
        title: "L'accueil « Aujourd'hui »",
        blocks: [
          { p: "Une fois connecté, la page d'accueil liste ce qui attend une action : lots à revoir, cartes à tarifer, cartes prêtes non planifiées, mises en ligne du jour ou en échec, ventes à préparer, alertes de cote. Chaque ligne mène droit à l'écran concerné. En dessous : l'activité des 30 derniers jours, tes dernières ventes et tes dernières mises en ligne." },
        ],
      },
    ],
  },

  /* ——— Vendre ——— */
  {
    slug: "ebay",
    group: "sell",
    title: "Connexion et réglages eBay",
    lead: "Autoriser Dexlane sur ton compte vendeur, choisir tes règles de vente, et comprendre comment tes annonces sont remplies.",
    sections: [
      {
        id: "connexion",
        title: "La connexion officielle",
        blocks: [
          { p: "La connexion passe par le système d'autorisation d'eBay (OAuth) : tu te connectes sur eBay, et eBay donne à Dexlane le droit de gérer tes annonces et de lire tes commandes. L'autorisation dure 18 mois ; Dexlane la renouvelle seul tant qu'elle est valable." },
          { p: "Tu peux retirer cet accès à tout moment : « Déconnecter » dans Réglages › Canaux de vente › eBay, ou depuis les paramètres de ton compte eBay. Tes annonces restent alors en ligne sur eBay, mais Dexlane ne les suit plus." },
        ],
      },
      {
        id: "reglages",
        title: "Avant de publier",
        blocks: [
          { p: "Trois choses à régler une fois :" },
          {
            list: [
              "**Le site eBay** : eBay.fr par défaut (les sites en euros sont proposés).",
              "**Tes règles de vente** : envoi, paiement et retours. Choisis-les parmi celles de ton compte, ou clique sur « Créer ce qui manque » : Dexlane les crée avec le service d'envoi, les frais de port, le délai d'expédition et la durée de retour que tu indiques (14 jours au minimum pour un vendeur professionnel dans l'Union européenne).",
              "**Ton lieu d'expédition** : code postal et ville.",
            ],
          },
          { p: "Quand tout est fait, l'écran l'indique : « Tout est prêt ». Passe alors le canal eBay de **Simulation** à **Réel**." },
          { note: "Le mode Simulation accepte tout et n'envoie rien à eBay : pratique pour essayer le parcours de bout en bout. « Simuler un achat » crée une vraie commande dans Dexlane (elle réserve le stock) — annule-la après ton essai." },
        ],
      },
      {
        id: "annonce",
        title: "Ce que contient une annonce",
        blocks: [
          {
            list: [
              "**Titre et description** rendus à partir de ton modèle (Réglages › Modèle d'annonce), avec des variables comme `{nom}`, `{numero}`, `{serie}`, `{variante}`, `{langue}`, `{etat}`. Le titre est coupé au dernier mot avant 80 caractères, la limite d'eBay.",
              "**Catégorie** : cartes à collectionner à l'unité (183454), et les caractéristiques demandées par eBay (jeu, langue, finition, personnage, numéro…) remplies avec les valeurs exactes qu'eBay propose.",
              "**Photos** : le visuel de ta carte (le scan posé sur le fond de ton choix), le verso s'il existe, puis ton image de fin d'annonce si tu en as réglé une.",
              "**Prix et quantité** : le prix fixé dans Dexlane et le stock vendable.",
            ],
          },
          { p: "Si eBay exige une caractéristique que Dexlane ne sait pas remplir, la publication est refusée avec son nom, et le message d'eBay est affiché tel quel." },
        ],
      },
      {
        id: "etats",
        title: "États des cartes",
        blocks: [
          { p: "Dexlane utilise l'échelle de Cardmarket (sept niveaux). Pour une carte non gradée, eBay n'en a que quatre : entre deux niveaux, Dexlane annonce le plus prudent, pour éviter les litiges." },
          {
            table: {
              head: ["État Dexlane", "État annoncé sur eBay"],
              rows: [
                ["MT, NM", "Near mint or better"],
                ["EX", "Lightly played (Excellent)"],
                ["GD, LP", "Moderately played (Very good)"],
                ["PL, PO", "Heavily played (Poor)"],
              ],
            },
          },
          { p: "**Cartes gradées** : sur la fiche d'un exemplaire unique, section **Gradation**, choisis la société (PSA, BGS, CGC, SGC…), la note (de 1 à 10 par demi-point, ou Authentique) et, si tu veux, le numéro de certificat. L'annonce eBay passe en état « Gradée » avec ces trois informations, et la note remplace l'état dans le titre (« PSA 10 »)." },
        ],
      },
      {
        id: "synchro",
        title: "Stock, prix et commandes synchronisés",
        blocks: [
          { p: `Avec la synchronisation (${PLANS.filter((p) => p.features.includes("sync")).map((p) => p.name).join(", ")}), tout suit tout seul : après chaque vente ou correction de stock, la quantité annoncée sur eBay est réalignée sur ton stock vendable ; un prix changé dans Dexlane, ou un titre choisi pour une carte, révise l'annonce en ligne. Ces mises à jour ne comptent jamais dans ton quota.` },
          { p: "Sur tous les forfaits, une carte vendue n'est jamais revendue : quand son stock tombe à zéro, l'annonce passe à zéro et se met en pause. Sans la synchronisation, les autres changements partent quand tu le décides, avec **Mettre à jour** sur la fiche de la carte." },
          { p: "Les commandes payées sur eBay arrivent dans **Ventes** avec le nom et l'adresse de l'acheteur, la date limite d'expédition et le mode d'envoi. Seules les annonces publiées par Dexlane sont reprises : une annonce créée à la main sur eBay n'est pas touchée." },
        ],
      },
    ],
  },
  {
    slug: "ajouter-des-cartes",
    group: "sell",
    title: "Ajouter des cartes",
    lead: "Scanner une pile, photographier au téléphone, saisir une carte ou un lot de vrac — et retrouver chaque carte à sa place.",
    sections: [
      {
        id: "scanner",
        title: "Une pile au scanner",
        blocks: [
          { p: "Un **lot scanné** est une pile de cartes passée au scanner à défilement et rangée dans une boîte, dans l'ordre. Ouvre un lot, choisis sa boîte, puis relie une fois le dossier où ton scanner enregistre ses images (Chrome ou Edge) : chaque carte scannée arrive d'elle-même, est lue et prend son rang." },
          {
            list: [
              "En recto verso, deux fichiers par carte, dans l'ordre des noms.",
              "Formats lus : JPEG, PNG et WebP.",
              "Le lot vit sur le serveur : fermer l'onglet ne perd ni les lectures ni les corrections.",
            ],
          },
          { p: "La revue ne te montre que les cartes signalées. Une variante illisible (normale, reverse, holo) s'applique d'un clic à toutes les cartes concernées. Quand tout est décidé, le lot entre en stock d'un bloc : les codes suivent exactement la pile, et le jour de la vente, la carte se retrouve à son rang dans sa boîte." },
          { note: "Le **pilote automatique** (option du lot) va plus loin : chaque carte reconnue sans doute entre en stock, reçoit son prix, voit sa photo d'annonce composée et part à la mise en ligne. Seules les exceptions t'attendent." },
        ],
      },
      {
        id: "telephone",
        title: "Au téléphone",
        blocks: [
          { p: "Sans scanner, le même lot s'alimente au téléphone : photographie le recto puis le verso de chaque carte (ou le recto seul), dans l'ordre. La carte est repérée, redressée et recadrée au format carte avant d'être lue. Le lot ouvert sur l'ordinateur se met à jour tout seul : tu peux faire la revue sur grand écran." },
          { p: "Pour une carte isolée, « Ajouter des cartes » › photo : la carte est lue et les trois meilleurs candidats du catalogue sont proposés. Elle n'est présélectionnée que si l'identification est sûre." },
        ],
      },
      {
        id: "saisie",
        title: "Saisie manuelle et vrac",
        blocks: [
          { p: "Si la lecture ne suffit pas, cherche la carte par nom, numéro ou série. L'état n'est jamais prérempli ; emplacement, coût et lot d'achat restent d'une carte à l'autre." },
          { p: "Le **vrac** (communes, doubles) entre en une seule position : une quantité, un coût total réparti par carte. Tu en sors une carte identifiée quand elle mérite sa propre annonce." },
        ],
      },
      {
        id: "emplacements",
        title: "Emplacements",
        blocks: [
          { p: "Chaque carte a son emplacement : boîte, classeur, rangée (`BOITE-03/RANG-12`). Les emplacements se créent en série dans **Emplacements** ; une faute de frappe n'en crée jamais un par erreur. Quand une carte se vend, la liste de prélèvement te dit où la prendre." },
        ],
      },
      {
        id: "export",
        title: "Exporter ton inventaire",
        blocks: [
          { p: "Dans le **Stock**, sélectionne des cartes (ou toutes) et exporte-les en CSV. Tes données restent les tiennes : tu peux partir avec quand tu veux." },
        ],
      },
    ],
  },
  {
    slug: "prix",
    group: "sell",
    title: "Les prix",
    lead: "D'où vient le prix proposé pour chaque carte, comment choisir ta stratégie, et pourquoi il ne descend jamais sous ton prix d'achat.",
    sections: [
      {
        id: "estimation",
        title: "L'estimation d'après les ventes",
        blocks: [
          { p: "Le prix part des ventes réussies sur Cardmarket (moyennes sur 30 jours et 7 jours, relayées par TCGdex) : le mois donne la base, la semaine la direction, sans s'écarter de plus de 20 % du mois. Chaque prix montre la cote dont il vient et sa date." },
          { p: "La fiabilité est affichée : « fiable » quand semaine et mois s'accordent, « prix en mouvement » sinon, « peu de ventes » quand une seule période est connue. Sans vente récente, l'écran le dit et un repère d'annonces est utilisé." },
        ],
      },
      {
        id: "strategie",
        title: "Ta stratégie",
        blocks: [
          {
            list: [
              "**Équilibré** (par défaut) : à l'estimation.",
              "**Vendre vite** : vers la plus basse des moyennes, sans brader.",
              "**Marge maximale** : vers la plus haute.",
            ],
          },
          { p: "Le prix est ensuite ramené à l'état de l'exemplaire (EX 80 %, GD 65 %…) et arrondi à l'euro à partir de 10 €." },
        ],
      },
      {
        id: "plancher",
        title: "Jamais sous ton prix d'achat",
        blocks: [
          { p: "Si le prix calculé passe sous ton coût (plus la marge minimale), il est tenu au coût et la carte est signalée. Un prix que tu as décidé à la main n'est jamais modifié tout seul : quand la cote s'en éloigne, la carte revient dans la file de revue de **Prix**." },
        ],
      },
      {
        id: "suggestions",
        title: "Suggestions de titre et de prix",
        blocks: [
          { p: `Avec les forfaits ${PLANS.filter((p) => p.features.includes("suggestions")).map((p) => p.name).join(" et ")}, la fiche d'une carte du stock montre un encadré **Suggestions** : un titre construit pour la recherche (nom, numéro, extension, état ou note de gradation, variante, langue, sans dépasser les 80 caractères d'eBay) et le prix que soutiennent tes règles et les ventes réussies. **Utiliser ce titre** le garde pour cette carte à la place du modèle ; **Revenir au modèle** l'annule. Tu décides : rien n'est publié sans toi.` },
        ],
      },
    ],
  },
  {
    slug: "publier",
    group: "sell",
    title: "Publier et planifier",
    lead: "Mettre une carte en ligne, en publier des centaines d'un coup, étaler la mise en ligne, et vendre tes communes en lots.",
    sections: [
      {
        id: "prete",
        title: "Une carte prête à publier",
        blocks: [
          { p: "Il faut un prix, au moins une photo de l'exemplaire et une variante confirmée. Sinon, Dexlane refuse la publication et liste ce qui manque. Une photo oubliée s'ajoute après coup depuis la fiche de la carte dans le Stock." },
        ],
      },
      {
        id: "unite",
        title: "À l'unité",
        blocks: [
          { p: "Dans le **Stock**, ouvre la fiche d'une carte et publie-la. Republier une carte déjà en ligne révise son annonce (texte, prix, photos)." },
        ],
      },
      {
        id: "masse",
        title: "En masse",
        blocks: [
          { p: "Sélectionne 10, 100 ou 500 cartes dans le Stock et lance la mise en ligne. Dexlane suit chaque annonce et te signale celles qui demandent une correction, sans bloquer les autres." },
        ],
      },
      {
        id: "planifier",
        title: "Étaler la mise en ligne",
        blocks: [
          { p: "Plutôt que tout publier d'un coup, répartis une sélection (ou toutes tes cartes prêtes, dans l'ordre d'entrée en stock) sur des jours consécutifs, N cartes par jour. Chaque matin, ce qui est dû part en ligne ; une publication impossible est marquée en échec avec son motif. Le calendrier des **Mises en ligne** montre ce qui est prévu, publié ou en échec, et une carte se déplace à une autre date." },
        ],
      },
      {
        id: "lots",
        title: "Vendre en lots",
        blocks: [
          { p: "Regroupe tes communes et tes doubles en un lot : une annonce pour tout le lot. Un lot compte pour une seule carte publiée dans ton forfait, quel que soit le nombre de cartes qu'il contient." },
          {
            steps: [
              "Dans **Stock**, coche au moins deux cartes, puis **Créer un lot**.",
              "Choisis combien d'exemplaires de chacune y mettre, le titre de l'annonce et le prix du lot.",
              "Les cartes quittent le stock à l'unité : elles ne peuvent plus être vendues séparément. Le lot apparaît dans **Lots de vente**, d'où tu le publies : une photo par carte, et la liste des cartes dans la description.",
              "Vendu, il se prépare et s'expédie comme une carte. Pas encore vendu, il se défait : ses annonces sont retirées et ses cartes reviennent dans le stock.",
            ],
          },
        ],
      },
      {
        id: "photos",
        title: "Photos d'annonce",
        blocks: [
          { p: "Le scan devient un visuel carré : la carte posée sur le fond de ton choix (couleur, dégradé ou image), avec marge, coins arrondis et ombre. Il se compose tout seul dès qu'une photo arrive. Une **image de fin d'annonce** (ta boutique, tes conditions) s'ajoute en dernière photo de chaque annonce." },
        ],
      },
    ],
  },
  {
    slug: "ventes-et-envois",
    group: "sell",
    title: "Ventes et envois",
    lead: "Des commandes eBay et des ventes directes jusqu'au colis déposé, avec la marge de chaque vente.",
    sections: [
      {
        id: "commandes",
        title: "Les commandes",
        blocks: [
          { p: "Les commandes eBay arrivent d'elles-mêmes dans **Ventes**. Une vente en direct (salon, main propre) s'enregistre aussi : elle réserve le stock et retire la carte des canaux. Une carte vendue deux fois ? Impossible côté Dexlane : le stock réservé ne peut pas être revendu, et un écart est signalé tout de suite." },
        ],
      },
      {
        id: "preparation",
        title: "Préparer les envois",
        blocks: [
          { p: "**Ventes › Préparer les envois** produit un seul document : la liste de prélèvement rangée par boîte (avec le rang de chaque carte dans sa pile), puis un bon de livraison et un reçu par commande. Rouleau thermique 80 ou 58 mm, étiquette 100 × 150 mm ou A4." },
          { p: "Ensuite : prélève (par code), emballe, dépose avec le numéro de suivi. Dexlane suit la livraison et peut demander un avis à l'acheteur." },
        ],
      },
      {
        id: "marge",
        title: "Achats, ventes, marge",
        blocks: [
          { p: "Enregistre ce que tu achètes (lots d'achat avec leur coût) : chaque vente affiche sa marge — encaissé, moins le coût des cartes, l'affranchissement et les fournitures. **Statistiques** montre ce qui se vend, à quel rythme, et la valeur de ton stock." },
          { p: "Les **Fournitures** (sleeves, top-loaders, enveloppes) se décomptent à chaque envoi et t'alertent quand il faut en recommander." },
        ],
      },
    ],
  },

  /* ——— Compte ——— */
  {
    slug: "forfaits",
    group: "account",
    title: "Forfaits et quotas",
    lead: "Tu paies selon ce que tu publies, rien sur ce que tu vends. Ce qui compte, ce qui ne compte pas, et ce qui se passe à la limite.",
    sections: [
      {
        id: "grille",
        title: "Les forfaits",
        blocks: [
          {
            table: {
              head: ["Forfait", "Prix", "Cartes publiées par mois", "Scans par mois", "Inclus"],
              rows: PLANS.map((plan) => [plan.name, formatPlanPrice(plan), formatCards(plan.cardsPerMonth), formatCards(plan.scansPerMonth), plan.features.map(featureLabel).join(" · ")]),
            },
          },
          { p: "Aucune commission sur tes ventes : les frais de vente d'eBay restent ceux d'eBay. Le détail est sur [la page Tarifs](/tarifs)." },
        ],
      },
      {
        id: "decompte",
        title: "Ce qui compte comme une carte publiée",
        blocks: [
          {
            list: [
              "**Compte** : chaque nouvelle annonce mise en ligne.",
              "**Un lot compte pour une** : 50 cartes vendues en une annonce, c'est une carte publiée.",
              "**Ne compte pas** : modifier un prix, mettre à jour une quantité, republier une annonce expirée, réviser le texte ou les photos.",
            ],
          },
          { p: "Le compteur repart de zéro le premier de chaque mois (heure de Paris). Tu suis où tu en es dans **Réglages › Forfait** ; si les notifications sont activées sur ton téléphone, tu es prévenu à 80 % puis à 100 %." },
        ],
      },
      {
        id: "scans",
        title: "Les scans",
        blocks: [
          { p: `Chaque photo lue automatiquement compte pour un scan, que la lecture réussisse ou non ; une panne de la lecture ne compte pas. Chaque forfait comprend environ deux scans par carte publiable, pour les cartes que tu gardes en stock et les photos reprises, et un pack de cartes ajoute ${formatCards(PACK_SCANS)} scans. Le compteur repart de zéro le premier du mois, comme celui des cartes.` },
          { p: "Une fois les scans du mois utilisés, une carte se recherche toujours à la main ; dans un lot scanné, elle est enregistrée avec sa photo, à identifier dans la revue. Pour éviter qu'un script ou une boucle s'emballe, un compte ne lit pas plus de 60 photos par minute." },
        ],
      },
      {
        id: "depassement",
        title: "Si tu dépasses",
        blocks: [
          { p: `On te prévient quand tu approches de la limite. Tu peux alors ajouter un pack de ${PACK} pour ${PACK_PRICE} (valable jusqu'à la fin du mois), ou passer au forfait supérieur. Tes annonces déjà en ligne ne sont jamais touchées.` },
          { p: "Une fois la limite atteinte, une nouvelle publication à l'unité attend le pack ou le forfait supérieur. Une mise en ligne planifiée qui a commencé sous la limite n'est jamais bloquée en cours de route : sur un forfait payant, elle va au bout et les packs nécessaires sont ajoutés à la fin ; sur le forfait gratuit, les cartes qui dépassent sont reportées au premier jour du mois suivant." },
        ],
      },
      {
        id: "changer",
        title: "Changer de forfait ou arrêter",
        blocks: [
          { p: "Sans engagement : tu changes de forfait ou tu reviens au forfait gratuit quand tu veux, dans **Réglages › Forfait**. Le changement prend effet tout de suite. Seul le propriétaire du compte peut le faire, et une boutique avec une équipe retire d'abord ses autres membres avant de passer à un forfait à un seul utilisateur. Si tu arrêtes, tes annonces restent en ligne sur eBay ; tu peux télécharger toutes tes données puis supprimer ton compte depuis **Compte › Vos données**." },
        ],
      },
      {
        id: "equipe",
        title: "Plusieurs utilisateurs",
        blocks: [
          { p: `Avec ${PLANS.filter((p) => p.features.includes("team")).map((p) => p.name).join(", ")}, invite les personnes de ton équipe depuis **Réglages › Équipe** : elles reçoivent un lien valable 7 jours, créent leur compte (ou se connectent) avec l'adresse invitée, puis rejoignent le tien. Chacune a sa propre connexion et travaille sur le même stock, les mêmes annonces et les mêmes ventes. Le propriétaire du compte peut retirer un membre à tout moment : ses sessions sont fermées.` },
        ],
      },
      {
        id: "support",
        title: "Support prioritaire",
        blocks: [
          { p: `Écris au support depuis **Réglages › Support**. Avec ${PLANS.filter((p) => p.features.includes("support")).map((p) => p.name).join(", ")}, tes demandes arrivent marquées prioritaires et passent en premier. Pour tous les forfaits, [la page Contact](/contact) mène aussi directement au fondateur.` },
        ],
      },
    ],
  },

  /* ——— Technique ——— */
  {
    slug: "community",
    group: "tech",
    title: "Installer la version Community",
    lead: "Dexlane est open-source. Sur ton serveur, sans limite de cartes, avec tes propres clés développeur eBay.",
    sections: [
      {
        id: "prerequis",
        title: "Prérequis",
        blocks: [
          {
            list: [
              "Node 22 ou plus et pnpm 11.",
              "PostgreSQL 15 ou plus (en local, ou `docker compose -f infra/docker/compose.yml up -d`).",
              "Une clé Anthropic pour la lecture des cartes (`ANTHROPIC_API_KEY`).",
              "Pour vendre en réel : un compte développeur eBay (gratuit).",
            ],
          },
          {
            note: `Le code est sous licence [AGPL-3.0](${GITHUB_URL}/blob/main/LICENSE) : tu peux l'installer, le modifier et l'utiliser librement. Si tu proposes ta version modifiée à d'autres en service en ligne, tu dois leur en donner le code source.`,
          },
        ],
      },
      {
        id: "installation",
        title: "Installation",
        blocks: [
          {
            label: "Terminal",
            code: `git clone ${GITHUB_URL}.git
cd dexlane
pnpm install
cp .env.example .env
# Dans .env : DATABASE_URL, DEXLANE_API_TOKEN, ANTHROPIC_API_KEY
pnpm db:migrate`,
          },
          { p: "`DEXLANE_API_TOKEN` est le jeton d'installation : au moins 24 caractères (`openssl rand -hex 24`). Il sert à créer le compte propriétaire à la première connexion, puis de clé de secours." },
          { label: "Lancer l'API et l'application", code: "pnpm api    # http://127.0.0.1:8787\npnpm web    # http://localhost:3000" },
          { p: "Ouvre l'application : l'assistant de démarrage te demande le jeton d'installation, ton adresse et ton mot de passe, puis t'aide à importer les séries du catalogue, créer tes emplacements et choisir ta stratégie de prix." },
          { note: "Sur un téléphone, utilise le build de production (`pnpm --filter @dexlane/web build` puis `start`), servi de préférence en HTTPS (reverse proxy ou VPN type Tailscale).", tone: "info" },
        ],
      },
      {
        id: "vercel",
        title: "Héberger sur Vercel",
        blocks: [
          { p: "Sans `DEXLANE_API_URL`, l'application web embarque l'API : un seul déploiement et une base PostgreSQL suffisent." },
          {
            steps: [
              "Crée un projet Vercel lié au dépôt, avec **Root Directory** `apps/web`. Les migrations s'appliquent avant chaque build de production.",
              "Ajoute une base Neon depuis l'onglet **Storage** : elle fournit `DATABASE_URL` et `DATABASE_URL_UNPOOLED`.",
              "Variables : `DEXLANE_API_TOKEN`, `ANTHROPIC_API_KEY`, `ENABLE_EXPERIMENTAL_COREPACK=1`, et `CRON_SECRET` (valeur aléatoire) pour les tâches de la nuit (cotes, canaux, catalogue).",
              "Photos : ajoute un stockage **Blob** public (`BLOB_READ_WRITE_TOKEN`). Sans lui, les images scannées ne sont pas conservées.",
              "E-mails (inscription, mot de passe oublié) : `RESEND_API_KEY` et `EMAIL_FROM`, une adresse d'un domaine vérifié chez Resend.",
              "Catalogue : la base démarre vide ; dans l'onglet Catalogue de l'application, « Charger la liste » puis synchronise tes séries. Les séries françaises s'importent ensuite toutes seules, en un à deux jours.",
            ],
          },
        ],
      },
      {
        id: "cles-ebay",
        title: "Tes clés développeur eBay",
        blocks: [
          {
            steps: [
              "Sur developer.ebay.com, crée une application (Application keys).",
              "Reporte l'App ID dans `EBAY_CLIENT_ID` et le Cert ID dans `EBAY_CLIENT_SECRET`.",
              "Dans « User tokens », crée un RuName dont l'adresse d'acceptation et de refus est `<adresse de ton application>/settings/channels/ebay`, et reporte-le dans `EBAY_RU_NAME`.",
              "`EBAY_ENV=sandbox` pour essayer avec le bac à sable, `production` pour vendre. Un compte connecté au bac à sable ne vaut pas pour la production.",
            ],
          },
          { p: "Sans ces trois clés, eBay reste en simulation. Ensuite, la connexion du compte et les réglages se font comme dans la version hébergée : voir [Connexion et réglages eBay](/docs/ebay)." },
        ],
      },
      {
        id: "variables",
        title: "Variables d'environnement",
        blocks: [
          {
            table: {
              head: ["Variable", "Rôle"],
              rows: [
                ["`DATABASE_URL`", "Base PostgreSQL de l'application."],
                ["`DEXLANE_API_TOKEN`", "Jeton d'installation (≥ 24 caractères) et clé de secours."],
                ["`ANTHROPIC_API_KEY`", "Lecture des cartes scannées ou photographiées."],
                ["`EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RU_NAME`, `EBAY_ENV`", "Connecteur eBay réel."],
                ["`RESEND_API_KEY`, `EMAIL_FROM`", "E-mails d'inscription et de mot de passe."],
                ["`BLOB_READ_WRITE_TOKEN`", "Stockage des photos (Vercel Blob)."],
                ["`CRON_SECRET`", "Protège les tâches planifiées."],
                ["`DEXLANE_PUBLIC_URL`", "Adresse publique utilisée dans les liens des e-mails."],
                ["`DEXLANE_PLANS`", "`off` : pas de forfaits ni de quota, toutes les fonctionnalités pour tous les comptes. Le compte d'installation n'a de toute façon aucune limite."],
                ["`SUPPORT_EMAIL`", "Adresse qui reçoit les demandes envoyées depuis Réglages › Support."],
              ],
            },
          },
          { p: `Toutes les options sont décrites dans le README et le fichier \`.env.example\` du [dépôt GitHub](${GITHUB_URL}).` },
        ],
      },
    ],
  },
  {
    slug: "agents",
    group: "tech",
    title: "Agents et serveur MCP",
    lead: "Branche tes agents IA sur ta boutique : ils lisent ton stock et agissent avec les mêmes règles que l'application.",
    sections: [
      {
        id: "brancher",
        title: "Brancher un agent",
        blocks: [
          {
            steps: [
              "Dans **Réglages › Agents (MCP)**, donne un nom à ton agent et crée un jeton. Il n'est affiché qu'une fois : copie-le.",
              "Dans ton outil d'agents, ajoute un serveur MCP distant (transport « Streamable HTTP ») à l'adresse `https://<ton domaine>/mcp`, avec l'en-tête `Authorization: Bearer dxl_…`.",
            ],
          },
          { p: "Un jeton n'ouvre que le serveur MCP de ton compte, jamais le reste de l'API. Il se révoque à tout moment ; seule son empreinte est conservée." },
        ],
      },
      {
        id: "outils",
        title: "Ce que peut faire un agent",
        blocks: [
          {
            list: [
              "**Lire** : vue d'ensemble de la boutique, stock et fiche d'une carte, journal des mouvements, ventes et statistiques, variations de cote, fournitures, planning des mises en ligne, catalogue, bonnes affaires et cartes suivies, offres vendables.",
              "**Agir** : fixer le prix d'une offre, planifier des mises en ligne, enregistrer une vente directe, suivre une carte, gérer les fournitures (commande, réception, inventaire, seuils).",
            ],
          },
          { p: "Pas de suppression ni d'annulation. Chaque outil passe par la même route que l'application (validations, synchronisation des canaux, alertes), et chaque action est enregistrée au nom de l'agent." },
        ],
      },
    ],
  },
  {
    slug: "faq",
    group: "tech",
    title: "Questions fréquentes",
    lead: "Les réponses courtes aux questions qu'on nous pose le plus.",
    sections: [
      {
        id: "questions",
        title: "Questions",
        blocks: [
          {
            faq: [
              { q: "Dexlane a-t-il accès à mon mot de passe eBay ?", a: "Non. Tu te connectes chez eBay, et eBay donne à Dexlane le droit de gérer tes annonces. Tu peux retirer cet accès à tout moment." },
              { q: "Dexlane prend-il une commission sur mes ventes ?", a: "Non, aucune. Tu paies ton forfait, c'est tout." },
              { q: "Une carte peut-elle être vendue deux fois ?", a: "Le stock réservé ne peut pas être revendu, et la quantité annoncée sur eBay est réalignée après chaque vente. Si une commande arrive malgré tout sans stock, elle est signalée tout de suite et l'annonce est mise en pause." },
              { q: "Mes photos de téléphone sont-elles assez bonnes ?", a: "Oui : la carte est repérée, redressée et recadrée avant la lecture. Cadre serré, sur un fond uni, sans reflet." },
              { q: "Quelles cartes Dexlane sait-il reconnaître ?", a: "Les cartes Pokémon du catalogue TCGdex, en français et en anglais. Le catalogue français complet s'importe tout seul, en un à deux jours après l'installation." },
              { q: "Et les autres plateformes ? Les autres jeux ?", a: "Aujourd'hui, Dexlane publie des cartes Pokémon sur eBay. CardTrader est en simulation, en attendant l'accès à son API. Dis-nous ce dont tu as besoin : c'est ce qui décide des priorités." },
              { q: "Je peux arrêter quand je veux ?", a: "Oui, sans préavis. Tes annonces restent en ligne sur eBay et tu peux exporter ton inventaire." },
            ],
          },
        ],
      },
    ],
  },
];

export const docPage = (slug: string) => DOC_PAGES.find((p) => p.slug === slug);

/** Page précédente et suivante dans l'ordre du sommaire. */
export function docNeighbours(slug: string): { previous: DocPage | null; next: DocPage | null } {
  const i = DOC_PAGES.findIndex((p) => p.slug === slug);
  return { previous: DOC_PAGES[i - 1] ?? null, next: DOC_PAGES[i + 1] ?? null };
}

export const DOCS_HELP_LINKS = { issues: GITHUB_ISSUES_URL };
