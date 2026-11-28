# dexlane — Pokémon Trading OS

Service en ligne de négoce de cartes Pokémon, sur https://dexlane.app : scan, stock, prix, publication eBay, ventes et envois, pour chaque vendeur dans son propre compte.

- Suivi du travail : les [issues GitHub](https://github.com/tomonchain/dexlane/issues) (go-live : #44). Règles de travail : [`CLAUDE.md`](CLAUDE.md).
- Versions : [`CHANGELOG.md`](CHANGELOG.md) ; la version déployée s'affiche en bas de Réglages.
- Licence : [AGPL-3.0](LICENSE). Contribuer : [`CONTRIBUTING.md`](CONTRIBUTING.md), avec l'[accord de contribution](CLA.md) ; signaler une faille : [`SECURITY.md`](SECURITY.md).
- Spécification d'origine (outil personnel, avant le passage multi-comptes ; ses numéros de section sont encore cités dans le code) : [`specs-pokemon-trading-automation.md`](specs-pokemon-trading-automation.md).

## État

**Page d'accueil** (`/`) : sans session, la connexion ; avec une session, l'accueil « Aujourd'hui » — ce qui attend une action (lots à revoir, brouillons, cartes à tarifer, cartes prêtes non planifiées, mises en ligne du jour ou en échec, ventes à préparer ou à remettre, alertes de cote), chaque ligne menant droit à l'écran concerné, puis quatre chiffres. Le Stock est à `/stock`. L'instance est fermée aux moteurs (`robots.txt`, `noindex`). En production, les adresses `*.vercel.app` redirigent vers l'adresse publique (`NEXT_PUBLIC_SITE_URL`). L'accueil montre aussi l'activité récente (`GET /api/stats/activity`) : deux graphiques en bâtons sur 30 jours — chiffre d'affaires et nombre de ventes, un graphique par mesure plutôt que deux échelles sur le même —, les dernières ventes et les dernières mises en ligne. Une vente y compte à sa date d'enregistrement, pour le montant encaissé, hors annulations ; la marge de « En bref » reste calculée sur les ventes remises.

**Actions des pages** : tous les boutons d'une page sont en haut à droite du contenu, dans son en-tête (`PageHeader`) ; les barres d'action (`ActionBar` : emballer, remettre, valider un lot, actions sur la sélection… ; `SaveBar` : modifications non enregistrées) s'y placent d'elles-mêmes (`lib/page-actions.ts`). Sur téléphone, elles passent sous le titre, alignées à droite.

**Édition hébergée** : dexlane.app est construite à partir de ce dépôt, avec en plus son site public (landing, tarifs, docs, guides, séries et cotes publiques), tenu dans un dépôt privé (#105). Ce que l'instance ajoute autour de l'application se règle dans `apps/web/config/edition.ts` : ici, pas de page d'accueil publique ni de pages légales. Les écrans de compte (connexion, inscription, mot de passe) ont leur mise en page et leurs textes dans `components/auth`, avec de vraies cartes du set 151 (images du catalogue TCGdex, `public/cards/`) ; les briques de la marque sont dans `components/brand.tsx`, les adresses (site, dépôt) dans `config/site.ts`. L'application a son propre layout racine (`app/(app)/`) : avec une session ouverte, `proxy.ts` sert son accueil (`app/(app)/home`) à l'adresse `/`.

**Comptes** : chaque vendeur a son compte (`accounts`, migration 0033) et ses propres données. Le cloisonnement est fait par Postgres : les 33 tables de données portent `account_id` et une règle de row-level security ; l'API exécute chaque requête dans une transaction ouverte pour le compte de la session (`withAccount` dans `@dexlane/db`, `apps/api/src/scope.ts`), sous le rôle `dexlane_tenant` qui ne peut pas contourner les règles. Le catalogue, les cotes du marché et les clés de notification du serveur restent communs.
- Utilisateurs et sessions : [BetterAuth](https://better-auth.com) (`apps/api/src/better-auth.ts`, tables `auth_*`), servi par l'API sous `/api/auth/*` et relayé tel quel par le serveur web, cookies compris. Il tient les mots de passe, la session (cookie httpOnly), la vérification de l'adresse, le mot de passe oublié, la limitation des tentatives et l'administration (plugin `admin` : rôles, bannissement, « se connecter en tant que »). Chaque utilisateur porte son compte (`accountId`) ; un navigateur ne choisit jamais son compte, c'est sa session qui le dit.
- Inscription : `/signup` → e-mail de vérification → le lien confirme l'adresse, ouvre la session et l'assistant de démarrage. Mot de passe oublié : `/forgot-password` → e-mail → `/reset-password?token=…`. Les réponses ne disent jamais si une adresse est déjà inscrite.
- Inscriptions sur invitation par défaut (#116) : une installation sert une boutique. Tant que `DEXLANE_SIGNUP` ≠ `open`, l'API refuse la création de compte (`403 SIGNUP_CLOSED`), sauf pour une adresse invitée dans l'équipe (Réglages › Équipe), et `/signup` le dit. La personne invitée suit le lien reçu, crée son compte depuis la connexion (« Créer un compte »), et la vérification de son adresse la ramène à l'invitation. `DEXLANE_SIGNUP=open` ouvre les inscriptions à tous (chaque inscription crée son compte) ; le réglage est lu au build : le changer demande un redéploiement. L'édition hébergée y ajoute sa liste d'attente et son administration par `apps/api/src/edition.ts` et `apps/web/config/edition.ts` (la table `waitlist`, migration 0042, reste dans les migrations).
- Propriétaire de l'installation : créé à la première connexion avec le jeton d'installation (`DEXLANE_API_TOKEN`), qui reste la clé de secours pour remplacer son adresse et son mot de passe (`POST /auth` côté web, `POST /api/setup/owner` côté API). Il est administrateur et son compte est le compte d'installation, qui garde les données existantes.
- E-mails : Resend, avec `RESEND_API_KEY` et `EMAIL_FROM` (adresse d'un domaine vérifié chez Resend). Sans eux, les e-mails sont écrits dans la console en développement ; en production, l'inscription échoue (`EMAIL_NOT_CONFIGURED`). Adresse publique des liens : `DEXLANE_PUBLIC_URL` ou `NEXT_PUBLIC_SITE_URL`, sinon celle du déploiement Vercel. Secret des cookies : `BETTER_AUTH_SECRET`, sinon dérivé de `DEXLANE_API_TOKEN`.
- API (jeton du serveur) : sans session navigateur, l'en-tête `X-Dexlane-Account` désigne le compte (scripts, tâches) ; sans lui, c'est le compte d'installation. `GET /api/accounts/active` liste les comptes pour la tâche quotidienne, qui tourne pour chacun. Un jeton d'agent (MCP) n'ouvre que le compte qui l'a créé.
- Onboarding (`/welcome`, ouvert tant qu'il n'est pas terminé ou passé) : boutique (nom et coordonnées des bons et reçus), mode de scan, emplacements, envois et stratégie de prix. Le propriétaire d'une installation neuve commence par créer son compte et a en plus l'étape d'import des séries dans le catalogue commun. Chaque étape se passe et se retrouve dans Réglages.
- Scans (#50) : chaque photo envoyée à Claude réserve une ligne de `scan_usage` avant l'appel (rendue si le service est en panne) et y note son coût estimé. Plafond mensuel `scansPerMonth` du forfait (`packages/shared/src/plans.ts`, plus `OVERAGE_PACK.scans` par pack) et `SCANS_PER_MINUTE` pour tous les comptes : `SCAN_QUOTA_EXCEEDED` (402) et `SCAN_RATE_LIMITED` (429). Dans un lot, la carte refusée est enregistrée avec sa photo, à identifier à la main. Suivi de la dépense : `select account_id, month, count(*), sum(cost_usd) from scan_usage group by 1, 2`.
- Données du compte (Compte › Vos données) : `GET /api/account/export` renvoie toutes les lignes du compte en JSON, table par table, sans secrets (mots de passe, jetons, clés). `POST /api/account/delete` (mot de passe et `confirm: "SUPPRIMER"`) efface le compte du propriétaire en une transaction — données, journaux en ajout seul, utilisateurs, puis photos du stockage — ou, pour un membre d'équipe, son seul utilisateur. Le compte d'installation ne se supprime pas. Les tables sont lues dans le schéma : une nouvelle table portant `account_id` est exportée et effacée sans code en plus.
- Pas encore : dashboard d'administration, facturation Stripe (#45).

**Forfaits** (`packages/shared/src/plans.ts`, la règle ; migration 0035) : chaque compte a son forfait (`accounts.plan`) — Découverte (gratuit, 20 cartes par mois), Solo, Pro, Boutique. Le compte d'installation n'a jamais de limite (forfait « community ») ; `DEXLANE_PLANS=off` coupe les forfaits pour toute l'installation (version Community auto-hébergée).
- Quota : une **carte publiée** est une offre mise en ligne pour la première fois sur un canal (`publication_usage`, une ligne par offre et par canal). Une révision (prix, texte, quantité), une remise en ligne ou une annonce simulée ne compte pas ; un lot compte pour une carte. Le mois est celui de Paris. Au-delà de la limite (forfait + packs du mois, `quota_packs`), une publication isolée est refusée (402 `QUOTA_EXCEEDED`). Une mise en ligne planifiée commencée sous la limite va au bout : sur un forfait payant, des packs ajoutés automatiquement couvrent le dépassement ; sur le forfait gratuit, les cartes qui dépassent sont reportées au premier jour du mois suivant. Alertes sur le téléphone à 80 % puis 100 % (`quota_alerts`, une fois par mois).
- Fonctionnalités (403 `FEATURE_NOT_IN_PLAN`, avec le forfait qui les ouvre) : publication en masse (planifier plusieurs cartes d'un coup, pilote automatique) dès Solo ; synchronisation des prix et du stock dès Solo — sans elle, une annonce dont le stock tombe à zéro passe quand même à zéro (jamais de double vente), le reste attend « Mettre à jour » ; suggestions de titre et de prix (`GET /api/stock/:offerId/suggestions`, `PUT /api/stock/:offerId/title`) dès Pro ; équipe et support prioritaire en Boutique.
- Changement de forfait et packs : `PUT /api/account/plan`, `POST /api/account/packs`, réservés au propriétaire du compte (le premier utilisateur inscrit). Sans facturation branchée, ils prennent effet tout de suite et restent dans le journal (`audit_events` : `plan_changed`, `quota_pack_added`), d'où ils seront facturés.
- Équipe (`/settings/team`) : invitation par e-mail (`account_invitations`, jeton haché, 7 jours) ; la personne s'inscrit ou se connecte avec l'adresse invitée et rejoint le compte (`/join?token=…`). Le propriétaire retire un membre : il repart sur un compte vide, sessions fermées.
- Support (`/settings/support`, `support_requests`) : les demandes partent à `SUPPORT_EMAIL` s'il est défini ; celles du forfait Boutique sont marquées prioritaires.

**Lots** (`/lots`, `packages/inventory/src/lots.ts`) : des cartes du stock vendues ensemble. Un lot est une offre `kind = 'LOT'` (rattachée à la variante de sa carte la plus chère, avec son propre titre), avec une position unique : il se publie, se vend, se prélève et s'expédie comme une carte. Ses cartes quittent leur position (mouvement `LOT_PACK`) et y reviennent si le lot, pas encore vendu, est défait (`LOT_UNPACK`). Les vues par carte (stock, prix, fiche) ne montrent pas les lots.

**Cartes gradées** : société, note et numéro de certificat sur un exemplaire unique (`PUT /api/stock/:offerId/grading`). Sur eBay : état « Gradée » (`LIKE_NEW`, condition 2750) et descripteurs 27501 (société), 27502 (note), 27503 (certificat) ; la note remplace l'état dans le titre (« PSA 10 ») sauf si le modèle utilise `{gradation}`. Identifiants de valeurs d'après la taxonomie eBay des cartes à collectionner, à vérifier dans le bac à sable.

**Organisation** : sept destinations — Accueil (`/`), Stock (`/stock`), Mises en ligne (`/listings`), Achats (`/buying`), Ventes (`/sales`), Statistiques (`/stats`), Réglages (`/settings`) ; les adresses sont en anglais (`/add`, `/card/:id`, `/catalog`, `/inventory`, `/locations`, `/pricing`, `/scanner/batch`, `/settings/shipping`…). Sur téléphone, cinq onglets (Accueil, Stock, Mises en ligne, Ventes, Plus) dans une barre flottante qui se réduit au défilement. « Ajouter des cartes » est en tête de l'Accueil et du Stock. Le Stock : une ligne par carte à vendre (offre), recherche et filtres (série, boîte, état, prix) derrière un bouton avec les filtres posés en puces, prix modifiable sur place, fiche latérale (photos agrandissables, recto et verso empilés, prix, cote, annonce, publication, positions), actions groupées sur la sélection (accepter les prix suggérés, valider les brouillons, déplacer, exporter en CSV, mettre en ligne).

| Package | Contenu |
|---|---|
| `infra/migrations` | Schéma PostgreSQL complet (spec §7), contraintes d'intégrité, journal append-only, outbox |
| `packages/db` | Connexion postgres.js, helper de transaction, migrations |
| `packages/shared` | Erreurs métier, montants en centimes, règles des forfaits (quotas, fonctionnalités, packs) |
| `packages/catalog` | Synchronisation TCGdex (séries, cartes, variantes détaillées, cotations Cardmarket datées), recherche des 3 meilleurs candidats à partir d'une lecture OCR |
| `packages/scan` | Lecture de carte par Claude (vision + sortie structurée, repli serveur), identification photo → candidats catalogue, banc d'essai précision/coût |
| `packages/insights` | Journal d'événements des comptes, statistiques de vente et cartes dormantes, parcours de démarrage, récaps et image de partage, niveau et succès |
| `packages/pricing` | Moteur de règles de prix (estimation, catégorie, plancher, motifs de revue), tarification des offres, file de revue, règles réglables. Statistiques : ce qui se vend (`salesInsights` : séries et taux d'écoulement, tranches de prix, états, raretés, canaux, jours de la semaine, délai de vente, cartes les plus vendues), valeur du stock, variations de cote des cartes détenues, seuils d'alerte |
| `packages/listings` | Annonces : modèle de titre et de description à variables, style des photos, offres vendables avec leur texte et leurs photos. Canaux de vente : interface de connecteur, mode simulation, connecteur eBay (OAuth, API Inventory, Account et Fulfillment), publication, alignement des quantités, import des commandes |
| `packages/inventory` | Entrée d'une carte identifiée (offre et SKU attribués automatiquement), lots de vrac et extraction, emplacements hiérarchiques, lots d'acquisition, déplacement, correction d'inventaire auditée, recherche, import idempotent de commandes, allocation commande → positions, survente (Parcours F), picking par scan, emballage, confirmation de dépôt |
| `apps/api` | API HTTP (Hono) : scan, recherche catalogue, emplacements, entrée en stock, vrac, inventaire. Comptes et sessions (BetterAuth), données cloisonnées par compte (row-level security), jetons d'agents, validation stricte, clés d'idempotence |
| `apps/web` | Application web installable (Next.js), pensée pour le téléphone : scan photo → candidats → confirmation → rangement, recherche manuelle, inventaire et fiche de position (déplacer, corriger, valider), lots de vrac et extraction, emplacements (aide, création en série, arborescence) et lots d'acquisition, catalogue (import par série, détail d'une série avec prix et stock détenu), prix (file de revue, règles), ventes directes (saisie, préparation, remise, marge), scan en lot (images d'un scanner à défilement), photos des exemplaires, annonces (modèle, fond des photos, visuels composés, canaux), statistiques (chiffres clés, variations de prix, alertes), compte (mot de passe, thème) |

Pas encore commencés : `apps/worker`, connecteur réel CardTrader (la simulation est en place ; le connecteur attend l'accès API), fulfillment PDF, étiquettes QR. Le connecteur eBay est écrit et testé contre des réponses simulées ; reste à le valider dans le bac à sable eBay.

## Prérequis

- Node ≥ 22, pnpm 11
- PostgreSQL ≥ 15 (local ou `docker compose -f infra/docker/compose.yml up -d`)

## Démarrage

```sh
pnpm install
cp .env.example .env              # adapter DATABASE_URL
DATABASE_URL=… pnpm db:migrate
pnpm test                         # utilise TEST_DATABASE_URL (défaut : postgres://localhost:5432/dexlane_test)
pnpm typecheck
```

Catalogue :

```sh
pnpm --filter @dexlane/catalog sync --lang fr --list-only          # métadonnées de toutes les séries
pnpm --filter @dexlane/catalog sync --lang fr --set swsh3 --set sv01 # cartes, variantes, cotations
```

API :

```sh
# .env : DATABASE_URL, DEXLANE_API_TOKEN (≥ 24 caractères, ex. `openssl rand -hex 24`), ANTHROPIC_API_KEY pour le scan
pnpm api                                   # http://127.0.0.1:8787 — écoute locale uniquement par défaut (HOST, PORT)
```

| Route | Rôle |
|---|---|
| `POST /api/scans` | Photo (corps brut `image/jpeg`… ou multipart `image`) → lecture, 3 candidats, score, variante suggérée, motifs de revue |
| `GET /api/catalog/cards?name=&number=&set=&language=` | Recherche manuelle quand le scan ne suffit pas |
| `GET /api/catalog/sets` · `POST /api/catalog/sets/refresh` · `POST /api/catalog/sets/{id}/sync` | Séries connues et état de synchronisation ; rechargement de la liste ; import d'une série depuis TCGdex |
| `GET` / `POST /api/locations` | Emplacements (`BOX-03/ROW-12/SLOT-04` crée aussi ses parents) |
| `GET` / `POST /api/acquisition-lots` | Lots d'acquisition (provenance, coût) |
| `POST /api/inventory/receive` | Entrée d'une carte confirmée : variante, état, quantité, emplacement, coût |
| `POST /api/inventory/bulk` | Entrée d'un lot de vrac en une position |
| `POST /api/inventory/{id}/extract` | Sortie de cartes identifiées d'un lot de vrac |
| `GET /api/inventory?q=&set=&language=&condition=&kind=&lifecycle=&location=` | Recherche paginée |
| `GET /api/inventory/summary` | Chiffres clés : cartes en stock, vendables, réservées, brouillons, valeur au coût |
| `GET /api/inventory/{id ou unit_sku}` | Fiche d'une position et historique des mouvements |
| `POST /api/inventory/{id}/move` · `/adjust` · `/activate` | Déplacement, correction après comptage (motif obligatoire), validation d'un brouillon |

Ventes : `GET /api/offers/sellable?q=`, `GET` / `POST /api/orders` (vente directe, clé d'idempotence), `GET /api/orders/{id}`, `POST /api/orders/{id}/pick` · `/pack` · `/handover` · `/cancel`.

Prix : `GET /api/pricing/variants/{id}?condition=` (estimation avant entrée en stock), `GET /api/pricing/offers?status=REVIEW|ALL` (file de revue triée par enjeu), `POST /api/pricing/offers/{id}/price` (décision), `GET` / `PUT /api/pricing/settings` (règles), `POST /api/pricing/recompute`.

Photos : `POST /api/scans` conserve l'image lue et renvoie `photo: { id, url }` ; `POST /api/photos?kind=SCAN_FRONT|SCAN_BACK` dépose une image sans lecture (verso) ; `receive` et `extract` acceptent `photoIds` pour rattacher les photos à la position créée ; la fiche d'une position les renvoie dans `photos`.

Photos après coup : `POST /api/stock/{offerId}/photos?kind=SCAN_FRONT|SCAN_BACK` ajoute une photo à une carte déjà en stock (entrée sans scan, ou photo à refaire) ; `DELETE /api/photos/{id}` la retire, avec le visuel d'annonce qui en était tiré.

Annonces : `GET` / `PUT /api/listings/settings` (modèle de titre et de description, style des photos), `GET /api/listings/offers?q=` (offres vendables, texte rendu, photos), `POST /api/photos?kind=LISTING&source={scan}` (visuel composé à partir d'un scan, remplace le précédent), `POST /api/photos?kind=BACKGROUND` (fond personnel), `GET /api/photos/{id}/content` (contenu servi sur la même origine).

Lots scannés : `GET` / `POST /api/scan-batches`, `GET` / `PATCH /api/scan-batches/{id}`, `POST /api/scan-batches/{id}/items?position=&fileName=` (image d'une carte à son rang ; un rang déjà enregistré est renvoyé sans relecture), `POST /api/scan-items/{id}/back` (verso), `PATCH /api/scan-items/{id}` (carte, variante, état, mise à l'écart), `POST /api/scan-batches/{id}/receive` (entrée en stock dans l'ordre, tout ou rien), `POST /api/scan-batches/{id}/autopilot` (pilote automatique : entre en stock les cartes complètes, pose leur prix, les met en file de mise en ligne ; rejouable).

Frais d'envoi : `GET` / `PUT /api/shipping-costs` (affranchissement habituel par mode, sleeve, top-loader, enveloppe).

Préparation des envois : `GET /api/orders/preparation` (commandes à préparer avec prélèvements, en-tête du vendeur, papier), `POST /api/orders/preparation/printed` (`orderIds` : bons imprimés).

Mise en ligne planifiée : `GET /api/publications` (planning par jour, échecs récents), `POST /api/publications/plan` (`offerIds` facultatif, `channel`, `startOn`, `perDay`), `POST /api/publications/cancel`, `POST /api/publications/run` (publie ce qui est dû ; lancé chaque jour par la tâche planifiée). Calendrier : `GET /api/publications/calendar?from&to` (93 jours au plus : par jour, les prévues par canal, les publiées et les échecs), `GET /api/publications/day/:date` (le détail carte par carte, publications à la main comprises), `PATCH /api/publications/:id` (`plannedOn` : déplace une mise en ligne prévue, ou replanifie un échec ; pas de date passée). `POST /api/photos?kind=PROMO` dépose l'image de fin d'annonce, réglée par `promoPhotoId` dans les réglages d'annonce.

Stock à vendre : `GET /api/stock?q=&status=ALL|TO_PRICE|READY|LISTED|DRAFT&sort=recent|value|name&setId=&location=&condition=&minCents=&maxCents=` (filtres : série, boîte et ses sous-emplacements, état, fourchette de prix sur le prix fixé sinon suggéré), `GET /api/stock/facets` (séries, boîtes et états présents, pour les filtres) (une ligne par offre, compteurs par statut, valeur totale), `GET /api/stock/{offerId}` (annonce, photos, positions, estimation d'après les ventes). `POST /api/pricing/offers/{id}/price` accepte un prix sans catégorie : elle est déduite du palier de prix.

Statistiques : `GET /api/stats/dashboard`, `GET /api/stats/price-moves?alerts=true|false`, `GET` / `PUT /api/stats/alert-settings`, `POST /api/prices/refresh` (relève les cotes des cartes en stock, puis réévalue les offres).

Canaux : `GET /api/channels`, `PUT /api/channels/{ebay|cardtrader}` (`OFF`, `SIMULATION`, `LIVE`), `POST /api/channels/sync`, eBay : `GET`/`DELETE /api/channels/ebay/connection`, `POST /api/channels/ebay/connect` et `/connect/complete`, `GET /api/channels/ebay/options` et `/shipping-services`, `PUT /api/channels/ebay/settings`, `POST /api/channels/ebay/defaults`, `POST /api/listings/offers/{id}/publish`, `POST /api/listings/{id}/end`, `POST /api/listings/{id}/simulate-order`.

Autres routes : `GET /api/catalog/sets/{id}` (contenu importé d'une série : cartes, variantes avec leur prix estimé d'après les ventes — `estimate` —, exemplaires en stock), `POST /api/locations/batch`, `PATCH` et `DELETE /api/locations/{id}` (suppression réservée à un emplacement vide et jamais utilisé), `/api/auth/*` (mot de passe du propriétaire, réservé au serveur web).

Toutes les routes sauf `GET /api/health` exigent `Authorization: Bearer <DEXLANE_API_TOKEN>`. Les créations et corrections (`receive`, `bulk`, `extract`, `adjust`, `acquisition-lots`) exigent un en-tête `Idempotency-Key` : la clé est écrite dans la même transaction que la mutation, donc une requête rejouée (double appui, réseau mobile) renvoie la réponse d'origine avec `Idempotent-Replay: true` sans rien créer en double. Erreurs : `{ "error": { "code", "message", "details" } }` — 400 format, 404 introuvable, 409 état incompatible, 422 règle métier.

Application web :

```sh
pnpm api                                   # dans un terminal
pnpm web                                   # dans un autre : http://localhost:3000 (dev)
pnpm --filter @dexlane/web build && pnpm --filter @dexlane/web start   # production
```

- **Connexion** : adresse e-mail et mot de passe (BetterAuth), inscription avec vérification de l'adresse, « Mot de passe oublié » par e-mail, tentatives limitées en production. Sur une installation neuve, le premier compte (compte d'installation, administrateur) se crée avec `DEXLANE_API_TOKEN`, qui reste sa clé de secours.
- **Session** : cookie `httpOnly` de BetterAuth, posé par l'API et relayé par le serveur web ; la session désigne le compte, jamais le navigateur. Changer le mot de passe (page Compte) déconnecte les autres appareils. Le navigateur n'appelle jamais l'API directement : le serveur Next relaie `/api/*` avec son propre `DEXLANE_API_TOKEN` (lu dans le `.env` de la racine en développement ; `DEXLANE_API_URL` par défaut : API embarquée).
- **Sur le téléphone** : utiliser le build de production (`build` puis `start`). En `dev`, Next ne sert ses ressources qu'à `localhost` ; pour tester depuis une autre machine, lister ses hôtes dans `DEXLANE_DEV_ORIGINS=192.168.1.20,mon-pc.local`. Le serveur doit être joignable depuis le téléphone, de préférence en HTTPS (reverse proxy ou VPN type Tailscale) — le cookie n'est marqué `Secure` qu'en HTTPS. La photo passe par l'appareil photo natif (pas besoin de permission caméra dans le navigateur) puis est réduite à 2000 px avant envoi. « Ajouter à l'écran d'accueil » installe l'application.
- **Interface** : Tailwind CSS 4 et composants de type shadcn/ui sur primitives Radix (`apps/web/components/ui`), icônes Lucide, tiroirs mobiles vaul, palette de commandes cmdk (⌘K / Ctrl+K : pages et recherche de positions), notifications sonner, police Geist, thème clair / sombre / système. Barre latérale sur ordinateur, onglets en bas sur téléphone.
- **Garde-fous du scanner** : une carte n'est présélectionnée que si l'identification est sûre ; sinon l'opérateur choisit explicitement. L'état n'est jamais prérempli. Emplacement, coût et lot restent d'une carte à l'autre. Une même saisie renvoyée après une coupure réseau n'est pas enregistrée deux fois.
- **Lots scannés** (`/scanner/batch`) : un lot est une pile de cartes passée au scanner à défilement et rangée dans une boîte, dans l'ordre. On relie une fois le dossier où le scanner enregistre ses images (Chrome ou Edge) : chaque carte scannée arrive d'elle-même, est lue et prend son rang. En recto verso, deux fichiers par carte, dans l'ordre des noms ; un recto attend son verso, un fichier en cours d'écriture attend d'être complet, et les images déjà présentes à la liaison sont ignorées. Le lot vit côté serveur : fermer l'onglet ne perd ni les lectures ni les corrections, et relier à nouveau le dossier ne relit rien. La revue corrige carte, variante et état, ou écarte une carte ; l'entrée en stock se fait d'un bloc quand tout est décidé, pour que les codes `SI-…` suivent exactement la pile. Pour aller vite pendant la revue : la variante que le scan n'a pas pu lire (normale, reverse, holo) s'applique d'un clic à toutes les cartes concernées, et la correction d'une carte enchaîne sur la suivante à corriger. Une fois le lot en stock, ses visuels d'annonce se composent seuls et la mise en ligne de ses cartes se planifie depuis le même écran. Formats lus : JPEG, PNG, WebP (pas de PDF ni de TIFF). **Sans scanner**, le même lot s'alimente au téléphone : un bouton photographie le recto puis le verso de chaque carte (ou le recto seul), dans l'ordre des prises de vue ; le lot ouvert sur un autre appareil se met à jour tout seul, pour faire la revue sur l'ordinateur. Les photos de téléphone ne sont pas recadrées automatiquement : cadrer serré.
- **Annonces** (dans la fiche d'une carte du stock) : chaque offre vendable y a son titre et sa description, rendus à partir d'un modèle à variables (`{nom}`, `{numero}`, `{serie}`, `{variante}`, `{langue}`, `{etat}`, `{prix}`…). Le titre est limité à 80 caractères (limite eBay) et coupé au dernier mot ; une ligne dont les variables sont vides disparaît. L'onglet Photos règle la mise en scène des scans : fond (couleur, dégradé ou image personnelle), marge, rognage du liseré du scanner, coins arrondis, ombre, texte. Le visuel carré est composé dans le navigateur — l'aperçu est exactement le fichier enregistré — puis déposé dans le stockage ; recomposer remplace l'ancien.
- **Visuels** : les miniatures viennent directement de `assets.tcgdex.net`.

Déploiement en un seul service (Vercel) :

Sans `DEXLANE_API_URL`, le serveur Next embarque l'API : un seul déploiement suffit, plus une base PostgreSQL.

1. Projet Vercel lié au dépôt, **Root Directory** `apps/web` (le build installe tout le monorepo). `apps/web/vercel.json` applique les migrations avant `next build`.
2. Base : onglet **Storage** du projet → Neon (offre gratuite). L'intégration fournit `DATABASE_URL` (connexions poolées, utilisées par l'application) et `DATABASE_URL_UNPOOLED` (connexion directe, utilisée par les migrations).
3. Variables d'environnement : `DEXLANE_API_TOKEN` (≥ 24 caractères ; jeton d'installation et clé de secours du compte d'installation), `BETTER_AUTH_SECRET` (signature des sessions ; sinon dérivé du jeton), `RESEND_API_KEY` et `EMAIL_FROM` (e-mails), `NEXT_PUBLIC_SITE_URL` et `DEXLANE_PUBLIC_URL` (adresse publique), `ANTHROPIC_API_KEY` (scan), `ENABLE_EXPERIMENTAL_COREPACK=1` (pnpm de `packageManager`). Les secrets en type *Sensitive*.
4. Tâche quotidienne : `apps/web/vercel.json` déclare un cron (`/cron/daily`, chaque nuit) qui relève les cotes des cartes en stock et synchronise les canaux. Elle exige la variable `CRON_SECRET` (valeur aléatoire), que Vercel présente à chaque appel ; sans elle, la route refuse tout.
5. Photos : onglet **Storage** → Blob (accès public), relié au projet ; l'intégration fournit `BLOB_READ_WRITE_TOKEN`. Sans cette variable, tout fonctionne mais les images scannées ne sont pas conservées.
6. Catalogue : la base hébergée démarre vide. Onglet **Catalogue** de l'application : « Charger la liste », puis « Synchroniser » les séries possédées (rejouable, met à jour les cartes et ajoute les cotations du jour). La commande `pnpm --filter @dexlane/catalog sync` reste disponible depuis un poste.
7. Domaine : `dexlane.app` est le domaine de production du projet (`www.dexlane.app` y redirige en 308). Ses serveurs de noms sont ceux de Vercel (`ns1`/`ns2.vercel-dns.com`) : les enregistrements DNS (e-mail, vérifications Google/Bing) se gèrent dans Vercel › Domains. `NEXT_PUBLIC_SITE_URL` et `DEXLANE_PUBLIC_URL` valent `https://dexlane.app` en production.

À savoir : préversions et production partagent la même base tant qu'aucune base par branche n'est configurée ; c'est pourquoi une préversion n'applique pas les migrations (voir « Intégration continue et déploiement »).

Intégration continue et déploiement :

- **CI** (`.github/workflows/ci.yml`, GitHub Actions) : deux tâches en parallèle contre un PostgreSQL jetable — types et tests unitaires d'un côté, build de production et parcours navigateur de l'autre (traces conservées 7 jours en cas d'échec). Installation figée (`--frozen-lockfile`), droits en lecture seule sauf pour les tâches de fusion, exécution précédente annulée par un nouveau push.
- **Livraison automatique** : un push sur une branche de travail `claude/**` est vérifié *fusionné avec `main`* ; si tout est vert, la tâche « Livraison » ouvre la pull request au besoin et la fusionne (uniquement le commit vérifié), puis Vercel déploie la production depuis `main`. Aucune étape manuelle. Pour retenir un changement, poser l'étiquette `hold` sur sa pull request avant la fin de la CI. L'ouverture automatique d'une pull request demande, une fois, Settings → Actions → General → « Allow GitHub Actions to create and approve pull requests ».
- **Suivre une livraison** : onglet Actions du dépôt (exécution « CI », tâche « Livraison »), puis onglet Deployments du projet Vercel. Un échec de la CI ne fusionne rien : la production reste sur la version précédente.
- **Autres pull requests** : vérifiées par la même CI, fusion manuelle. Chaque branche poussée reçoit une prévisualisation Vercel.
- **Migrations** : appliquées par le build de production seulement. Une prévisualisation partage par défaut la base de production et ne doit pas en changer le schéma ; avec une base par prévisualisation (branche Neon), poser `MIGRATE_ON_PREVIEW=1`. Conséquence : une prévisualisation dont le code attend une migration non encore appliquée peut échouer tant que la branche n'est pas fusionnée.
- **Dépendances** : Dependabot propose une fois par mois les mises à jour, regroupées. Les mineures et correctives se fusionnent seules une fois la CI verte ; les versions majeures attendent une relecture.

Tests de bout en bout (navigateur mobile → Next → API → PostgreSQL de test ; seule la lecture Claude est simulée) :

```sh
pnpm --filter @dexlane/web exec playwright install chromium   # une fois (ou PLAYWRIGHT_CHROMIUM_PATH=/chemin/vers/chromium)
TEST_DATABASE_URL=… pnpm e2e
```

Banc d'essai du scan (spec Sprint 0 — nécessite `ANTHROPIC_API_KEY` ou `ant auth login`) :

```sh
# Vos photos : un dossier avec les images (jpg/png/webp, < 5 Mo) et labels.csv
#   file,set_id,local_number,language
#   IMG_0001.jpg,swsh3,136,fr
pnpm --filter @dexlane/scan bench --dir ~/photos-test --out results.csv

# Sans photos : visuels officiels TCGdex des cartes synchronisées (résultats optimistes)
pnpm --filter @dexlane/scan bench --catalog-sample 20 --set swsh3

# Options : --model claude-opus-5-5 --effort low|medium|high --concurrency 3
```

Indicateur clé : `silentErrors`, les cartes acceptées sans revue alors qu'elles sont fausses. Il doit rester à 0.

Les tests tournent contre un vrai PostgreSQL : la base de test de chaque package (`dexlane_<package>_test`) est créée si besoin puis **vidée** à chaque test. Par sécurité, le nom de base doit se terminer par `_test`.

## Stock — cartes, fournitures, mouvements

- **Un seul écran `/stock`, trois rubriques** (onglets) : **Cartes** (une ligne par carte à vendre, comme avant), **Fournitures** (`?section=supplies`) et **Mouvements** (`?section=movements`). L'ancienne adresse `/fournitures` y mène.
- **Photos d'un exemplaire** : un emplacement recto et un emplacement verso, dans la fiche du stock et sur la page d'une carte (par offre) ; chacun s'ajoute, se remplace ou se retire, et une photo est recadrée au format carte comme au scanner.
- **Catalogue français complet** : toutes les heures (`/cron/catalog`, deuxième tâche planifiée de `vercel.json`), les séries françaises encore absentes s'importent pendant quatre minutes (5 à 10 séries par passage : le catalogue complet en un à deux jours ; ensuite, un passage sans rien à faire s'arrête aussitôt), les plus récentes d'abord (`POST /api/catalog/import/next`, rang de la série dans la liste TCGdex) ; la liste des séries est relue si elle est incomplète ou vieille d'une semaine. Une série sans carte en français n'est retentée qu'une semaine plus tard. Le catalogue affiche la progression (`GET /api/catalog/import`) et « Tout importer maintenant » enchaîne les lots tant que la page reste ouverte. Les cotes ne sont relevées ensuite que pour les cartes détenues ou suivies.
- **Catalogue** : logo et symbole de chaque série (TCGdex, avec repli sur le logo anglais), code d'extension en regard du nom.
- **Code d'extension** (colonne « Extension » des cartes, recherche, filtres) : le code usuel de la série, déduit de son identifiant et de la langue de la carte — en français SL01, SL03.5, EB03, EV03.5, ME02.5, NB01 ; en anglais SM01, SWSH03, SV03.5 (fonction SQL `set_code`) ; une série hors de ce schéma prend son abréviation officielle, ou son identifiant. Corrigeable par série dans le catalogue (`PUT /api/catalog/sets/:id/code`). La recherche tolère les écritures « me 2.5 », « ME02.5 », « me2,5 ».
- **Fournitures** : liste filtrable (tout, à commander, commandées) et recherche (nom, référence, emplacement) ; fiche à droite (tiroir sur téléphone) avec quantité, jauge, jours de stock au rythme des 30 derniers jours, seuil, prix d'achat unitaire, valeur, emplacement (les mêmes emplacements que les cartes), commande habituelle, lien fournisseur et derniers mouvements. Gestes : entrée (avec note), inventaire (le compté remplace le calculé), commandé, modifier, retirer. En-tête : articles, unités et valeur du stock de fournitures.
- **Coût dans la marge** : dès qu'une fourniture décomptée automatiquement a un prix d'achat, le coût des fournitures d'une vente se calcule d'après le stock (chaque fourniture pour les modes d'envoi qui l'utilisent ; sans prix, elle compte 0), à la place des montants de Réglages › Frais d'envoi, qui l'affichent alors en lecture. Estimé avant la remise, figé à la remise. `GET /api/shipping-costs` renvoie `stock` (détail, par carte, par envoi selon le mode).
- **Décompte automatique à la remise d'un envoi** (dans la transaction de la remise) : « par carte » sort `perUse × cartes`, « par envoi » sort `perUse` une fois, pour les modes d'envoi cochés ; « manuelle » ne bouge qu'à l'entrée ou à l'inventaire. Jamais sous zéro, jamais bloquant.
- **Alerte** : au seuil ou en dessous, une notification part aussitôt (préférence « Fournitures »), une fois par passage sous le seuil, réarmée quand le stock remonte ; « Commandé » la fait taire jusqu'à l'entrée. Rappel dans le résumé du matin, tâche sur l'accueil, pastille sur l'onglet Fournitures.
- **Mouvements** : le journal de tout ce qui entre (entrées, retours, réceptions), sort (ventes expédiées, fournitures utilisées, pertes), est corrigé ou déplacé, cartes et fournitures ensemble, jour par jour ; filtres par rubrique et par type, résumé des 30 derniers jours, pages par curseur. Les réservations et prélèvements d'une vente en cours n'y figurent pas, sa sortie si. Les actions d'un agent portent son nom. La fiche d'une carte et celle d'une fourniture montrent leurs derniers mouvements.
- API : `GET/POST /api/supplies`, `GET/PATCH/DELETE /api/supplies/:id`, `POST /api/supplies/:id/receive`, `/count`, `/ordered` ; `GET /api/stock-movements?category=CARD|SUPPLY&kind=IN|OUT|ADJUST|MOVE&offerId=&supplyId=&before=&limit=&days=`.

## Catalogue public (API)

Le catalogue commun et ses cotes, lisibles sans session (`packages/catalog/src/public.ts`, routes `GET /api/public/catalog/*`). Le site de l'édition hébergée s'en sert pour ses pages de séries et de cotes.

- **Détails des cartes** (migration 0036) : numéros de Pokédex (`dex_ids`), illustrateur, PV, types et stade, repris de TCGdex. Les séries importées avant n'en ont pas : la tâche horaire du catalogue les reprend une à une après les séries manquantes (`catalog_sets.details_synced_at`).
- **Données** : le catalogue commun et les cotes seulement (`packages/catalog/src/public.ts`, routes `GET /api/public/catalog/*`). Ces requêtes ne joignent jamais une table de compte : la connexion du serveur n'étant pas cloisonnée, elles additionneraient le stock de tous les vendeurs.
- **Source des cotes** : la cote tendance Cardmarket telle que TCGdex la publie dans son API (`pricing.cardmarket`), citée sous chaque tableau.

## Agents — serveur MCP

- **Adresse** : `https://dexlane.app/mcp`, transport « Streamable HTTP » sans session (chaque `POST` porte un message JSON-RPC, réponse JSON), en-tête `Authorization: Bearer dxl_…`. Compatible avec tout client MCP qui accepte un serveur HTTP distant et un en-tête d'autorisation.
- **Jetons** : Réglages › Agents (MCP). Un jeton par agent, montré une seule fois, révocable ; seule son empreinte (SHA-256) est gardée (`agent_tokens`). Un jeton d'agent n'ouvre que `/mcp`, jamais le reste de l'API.
- **Outils** : lecture (vue d'ensemble, stock, fiche d'une offre, journal des mouvements, ventes, statistiques, variations de cote, fournitures, planning, catalogue, bonnes affaires, cartes suivies, offres vendables) et actions (prix d'une offre, planification des mises en ligne, vente directe idempotente, suivi d'une carte, commande, réception, inventaire et seuils des fournitures). Pas de suppression ni d'annulation.
- Chaque outil rappelle la même route de l'API que l'application (validations, règles, synchronisation des canaux, alertes) ; le journal d'audit enregistre `agent:<nom>`. Code : `apps/api/src/mcp.ts`, `agents.ts` ; relais public `apps/web/app/mcp/route.ts`.

## Garanties anti-double-vente

1. **Base** : `CHECK (reserved + inspection + quarantine <= on_hand)` sur chaque position — aucun chemin de code ne peut rendre le disponible négatif.
2. **Application** : allocation sous `SELECT … FOR UPDATE` des positions de l'offre, verrouillées dans un ordre stable.
3. **Idempotence** : unicité `(channel, external_id)` des commandes ; allocation d'une ligne déjà allouée = no-op.
4. **Survente** : commande marquée `oversold`, offre mise en pause, incident ouvert, événement urgent dans l'outbox.

Les compteurs de stock sont une projection du journal `inventory_movements` (append-only) ; un test vérifie qu'ils restent égaux au rejeu du journal.

## Entrée en stock — points d'attention

- **Offre** : une seule offre interchangeable par (variante, état), créée à la première entrée ; chaque entrée crée une nouvelle position (`unit_sku` `SI-000123`, un QR par position). Un exemplaire `unique` reçoit sa propre offre (`…-U000123`).
- **`offer_sku`** : `OF-<série>-<numéro>-<langue>-<variante>-<état>`, ex. `OF-BASE1-004-FR-H1-NM` ; suffixe `-2`, `-3`… si deux variantes produisent le même code. Format à valider contre les contraintes de SKU du canal retenu (Sprint 0).
- **Non vendable tant que non validé** : une position `draft` ne compte pas dans le disponible ; une commande dessus part en survente. Une nouvelle offre naît `DRAFT` / `REVIEW` (prix et catégorie : Sprint 2).
- **Photos** : l'image d'un scan est déposée dans le stockage d'objets pendant la lecture, puis rattachée à la position (et à son offre) à l'entrée en stock. Les fichiers sont publics mais à une adresse non devinable, pour qu'une marketplace puisse les télécharger. Une photo déjà rattachée ne change jamais de position ; un échec du stockage ne bloque ni le scan ni l'entrée en stock.
- **Emplacement** : obligatoire et jamais créé implicitement — une faute de frappe renvoie `LOCATION_NOT_FOUND` au lieu de créer une boîte.
- **Correction d'inventaire** : saisie de la quantité comptée, pas d'un écart ; refusée sous les quantités réservées (cas du Parcours F).
- **Coût du vrac** : le coût unitaire est stocké en centimes entiers ; 1 000 cartes à 15 € donnent 2 c pièce (20 € reconstitués). Le coût exact reste celui du lot d'acquisition.

## Prix automatiques — l'algorithme

1. **Estimation d'après les ventes réussies** (état « comme neuf ») : le guide des prix Cardmarket, relayé par TCGdex, donne la moyenne des ventes réalisées sur 30 jours, 7 jours et la veille. Les ventes du mois donnent la base (le plus de ventes, donc le plus stable), celles de la semaine la direction : l'estimation est à mi-chemin, sans s'écarter de plus de 20 % du mois — une vente atypique dans une semaine calme ne déplace pas le prix. La veille repose sur trop peu de ventes pour compter : elle est affichée, pas utilisée. Seul le dernier relevé compte : une moyenne que la source ne rapporte plus (plus de vente sur la période) est ignorée. **Fiabilité** : « fiable » si semaine et mois sont à moins de 20 % l'un de l'autre, « prix en mouvement » au-delà, « peu de ventes » si une seule période est renseignée. Sans aucune vente récente, la tendance des annonces puis l'annonce la moins chère servent de repère, et l'écran le dit (« ≈ », « Aucune vente récente »).
2. **Stratégie** : « Équilibré » (par défaut) se place à l'estimation ; « Vendre vite » à la plus basse des moyennes semaine/mois (au plus 15 % sous l'estimation), aligné sur l'annonce la moins chère sans brader de plus de 10 % ; « Marge maximale » à la plus haute (au plus 15 % au-dessus).
3. **État** : le prix est ramené à l'état de l'exemplaire par un coefficient (EX 80 %, GD 65 %…), puis arrondi à l'euro à partir de 10 €.
4. **Jamais sous le prix d'achat** : si ce prix est inférieur au coût moyen (plus la marge minimale pour une vente à l'unité), il est tenu au coût et l'offre porte le motif `HELD_AT_COST` — elle se vendra plus lentement. Un prix posé par les règles qui passe sous le coût (nouveaux exemplaires plus chers) est recalculé ; un prix décidé à la main est seulement signalé.

L'estimation, sa fiabilité et le détail des moyennes sont conservés sur l'offre (`offers.sales_estimate`) et affichés partout où un prix se décide : saisie d'une carte, stock (colonne « Ventes » et fiche), catalogue, page Prix.

**Limites de la source** : ce sont des moyennes, sans le nombre de ventes, toutes langues et tous états confondus (l'état est corrigé par le coefficient ci-dessous, la langue ne l'est pas). Les ventes réussies eBay, propres à une langue et à un état, ne sont pas branchées : eBay ne les expose que par son API Marketplace Insights, réservée aux développeurs approuvés. Ce n'est pas une optimisation statistique : c'est une règle explicable, à affiner quand les ventes de la boutique donneront des délais réels. Les cartes entre 5 et 15 € sont tarifées d'office comme les autres ; seuls un doute sur la cote (absente, périmée, partagée entre variantes) ou sur la variante laissent une carte sans prix.

## Statistiques et alertes de prix — points d'attention

- **Évolution du prix d'une carte** : la fiche d'une carte du stock trace ses relevés (`GET /api/pricing/variants/{id}/history?days=30|90|365`) — ventes réussies sur 7 et 30 jours, annonce la moins chère ; la tendance des annonces ne prend leur place que si rien ne s'est vendu sur la période. Un seul axe en euros, survol ou flèches du clavier pour lire un relevé, tableau des valeurs sous le graphique. L'historique commence au premier relevé de la carte : il s'étoffe d'un point par jour pour les cartes en stock, grâce à la tâche quotidienne.

- **Cote suivie** : la tendance Cardmarket (`LISTED_TREND`) fournie par TCGdex, datée par la source. Un relevé n'est ajouté que si la source a publié une nouvelle date : relancer le relevé ne crée pas de doublon.
- **Variation** : dernier relevé comparé au relevé le plus récent d'au moins N jours plus tôt (7 par défaut). Une carte sans relevé assez ancien n'apparaît pas encore : l'historique se construit au fil des relevés quotidiens.
- **Alerte** : variation d'au moins X % *et* d'au moins Y € (15 % et 1 € par défaut), pour ne pas signaler une carte passée de 0,10 € à 0,15 €. Tri par enjeu : écart × exemplaires détenus. Les alertes se consultent dans l'application ; rien n'est envoyé par courriel ou notification.
- **Le prix décidé ne bouge pas tout seul** : une cote qui s'éloigne du prix cible devient un motif de revue dans Prix, comme avant.
- **Ventes** : une vente compte dans le mois où elle a été remise ; marge = encaissé − coût des cartes − affranchissement (les frais de canal ne sont pas encore connus).

## Canaux de vente — points d'attention

- **Trois modes par canal** : désactivé, simulation, réel. Le mode réel exige un connecteur prêt (`ChannelAdapter`) : celui d'eBay se crée d'après l'environnement, CardTrader n'en a pas encore. Le contrat suit le modèle d'eBay : une annonce par `offer_sku`, une quantité tenue à jour, des commandes qu'on vient chercher.
- **Simulation** : le canal accepte tout et n'envoie rien. « Simuler un achat » crée une commande par le même chemin qu'une vraie (import idempotent, réservation, envoi à préparer) : elle réserve réellement le stock, à annuler après essai. Quitter la simulation termine les annonces simulées.
- **Prête à publier** : une offre doit avoir un prix cible, au moins une photo de l'exemplaire et une variante confirmée ; sinon la publication est refusée avec la liste de ce qui manque.
- **Double vente entre canaux** : après toute écriture sur `/api/orders` ou `/api/inventory`, la quantité annoncée est réalignée sur le stock vendable (moins la marge `buffer`). À zéro, l'annonce passe en pause ; elle reprend au réassort. Un échec côté canal laisse l'annonce en `ERROR`, retentée à la synchronisation suivante.
- **Commandes de canal** : déjà conclues ailleurs, elles ne sont jamais refusées ; si le stock manque, elles partent en survente (Parcours F) au lieu d'échouer.
- **Mise en ligne planifiée** : depuis le Stock, des cartes sélectionnées (ou toutes les cartes prêtes, dans l'ordre d'entrée en stock) sont réparties sur des jours consécutifs, N par jour. La tâche quotidienne publie ce qui est dû — tôt le matin, heure de Paris pour le calendrier — et une publication impossible (prix ou photo manquante, stock épuisé, canal éteint) est marquée en échec avec son motif sans bloquer les autres. Replanifier une carte déplace sa date ; une carte déjà en ligne sur le canal est laissée de côté.
- **Visuel d'annonce composé d'office** : dès qu'une photo arrive (lot entré en stock, photo ajoutée après coup) et avant toute publication ou planification, le visuel « carte sur fond » est composé dans le navigateur s'il manque. Réglable dans Réglages → Modèle d'annonce et photos (`autoCompose`) ; désactivé, les photos partent telles quelles.
- **Image de fin d'annonce** : réglée une fois (Annonces → Photos), elle est ajoutée en dernière photo de chaque annonce publiée, après les photos de la carte.
- **Prix** : l'annonce garde le prix du moment de la publication ; un prix cible modifié ensuite est signalé, « Mettre à jour » le renvoie.

## eBay — le connecteur réel

- **Clés** : `EBAY_CLIENT_ID` (App ID), `EBAY_CLIENT_SECRET` (Cert ID), `EBAY_RU_NAME` (RuName de « User tokens »), `EBAY_ENV` (`sandbox` par défaut, `production` pour vendre). Sans les trois premières, eBay reste en simulation. Le RuName a pour adresse d'acceptation et de refus `<application>/settings/channels/ebay`.
- **Connexion du compte** (Réglages › Canaux de vente) : le propriétaire autorise Dexlane sur eBay (OAuth). Le jeton de renouvellement (18 mois) est gardé dans `channel_accounts` ; les jetons d'accès (2 h) sont renouvelés d'office. Il ne sert à rien sans le secret de l'application, qui reste dans l'environnement. Un compte connecté au bac à sable ne vaut pas pour la production.
- **Avant de publier** : site eBay (eBay.fr par défaut ; sites en euros seulement), règles d'envoi, de paiement et de retour, lieu d'expédition. On les choisit parmi celles du compte, ou Dexlane les crée (service d'envoi lu sur eBay, frais de port, délai, retours 14/30/60 jours, code postal et ville). Le mode réel reste grisé tant que ce n'est pas fait.
- **Publication** (API Inventory) : un objet par `offer_sku` (état « Non gradée » et descripteur d'état de la carte, texte, photos, quantité), une offre à prix fixe dans la catégorie 183454 (cartes à l'unité), puis la mise en ligne. Republier révise l'annonce en ligne. Les caractéristiques (Jeu, Langue, Finition, Personnage, Numéro…) sont lues dans la taxonomie eBay du site, gardées une semaine, et remplies avec la valeur exacte proposée par eBay ; une caractéristique obligatoire impossible à remplir bloque la publication avec son nom.
- **États** : eBay n'a que quatre niveaux pour une carte non gradée. MT et NM → *Near mint or better* ; EX → *Lightly played (Excellent)* ; GD et LP → *Moderately played (Very good)* ; PL et PO → *Heavily played (Poor)*. Entre deux niveaux, on prend le plus prudent.
- **Quantités** : alignées par `bulk_update_price_quantity`. Une annonce close par eBay à zéro stock est remise en ligne au réassort (nouveau numéro d'annonce).
- **Commandes** (API Fulfillment) : les commandes payées, non annulées, non expédiées, modifiées depuis la dernière synchronisation (deux jours de recouvrement, un mois la première fois). Seules les lignes publiées par Dexlane (avec une référence d'offre) comptent. Nom et adresse de livraison, date limite d'expédition et mode d'envoi (déduit du service choisi par l'acheteur) sont repris. Une commande qui ne passe pas n'empêche pas les autres, et la synchronisation est retentée.
- **Erreurs** : le message d'eBay est rapporté tel quel (« eBay : … »).

## Du scanner à l'envoi — le parcours sans intervention

1. **La pile passe au scanner.** Un lot en « pilote automatique » (option à la création du lot, activable ou coupable à tout moment) ne demande plus de revue : chaque carte reconnue sans doute entre en stock dans l'ordre du scan avec l'état du lot, reçoit son prix d'après les ventes réussies, voit sa photo d'annonce composée et part à la mise en ligne sur chaque canal actif — le jour même, ou étalée à N par jour sans déplacer ce qui est déjà planifié.
2. **Seules les exceptions attendent.** Une carte mal lue, sans variante sûre ou sans cote fiable reste « à vérifier » ou « à tarifer » sans bloquer les autres ; corrigée, elle suit toute seule. En recto verso, une carte attend son verso une minute au plus.
3. **Une fois par jour, les envois.** Ventes → « Préparer les envois » produit un seul document : la liste de prélèvement rangée par boîte (avec le rang de la carte dans sa pile scannée), puis un bon de livraison et un reçu par commande. Le papier se règle (rouleau thermique 80 ou 58 mm, étiquette 100 × 150 mm, A4), une feuille par page pour que l'imprimante coupe entre chaque. Les commandes imprimées sont marquées et ne reviennent pas le lendemain ; elles restent réimprimables.

Ce qui reste une action de votre part, et pourquoi :

- **Relier le dossier du scanner** à l'ouverture du lot : un navigateur ne lit un dossier qu'après un clic d'autorisation. Un petit programme installé sur le poste du scanner supprimerait ce clic ; il n'est pas écrit.
- **Cliquer « Imprimer »** : une page web ne peut pas imprimer seule. Le lien `/sales/preparation?print=1` ouvre directement la boîte d'impression ; Chrome lancé avec `--kiosk-printing` l'imprime alors sans confirmation.
- **La mise en ligne est simulée** tant qu'un canal n'est pas passé en réel (eBay : clés configurées, compte connecté, règles de vente choisies).
- Si l'onglet du lot est fermé avant la fin, ce qui est en file est publié par la tâche quotidienne.

## Fiche d'une carte

`/card/{id}` regroupe tout ce qui concerne une carte du catalogue (par exemple « Dracaufeu, Set de Base 4, FR ») :
ses variantes avec leurs prix sur chaque plateforme et leur suivi, la courbe de prix par variante, chaque exemplaire en
stock regroupé par offre (variante × état) avec sa boîte, son rang dans la pile scannée, son coût et ses réservations,
les annonces en ligne, et les ventes. On y arrive depuis le nom de la carte dans la fiche du stock, la page Achats, le
catalogue, la fiche d'une position et l'accueil ; « Ouvrir dans le stock » mène à l'offre (`/stock?offer={offerId}`).
`GET /api/cards/{id}`.

## Achats — cartes suivies et bonnes affaires

- **Cartes suivies** (`/buying`) : une variante précise du catalogue, avec un prix cible d'achat facultatif. Pour chacune : estimation d'après les ventes réussies et annonce la moins chère sur Cardmarket, prix du marché TCGplayer (en dollars, marché américain, jamais converti ni mélangé aux cotes en euros), variation sur la fenêtre des alertes, courbe d'évolution, liens de recherche Cardmarket et eBay. Alertes : l'annonce la moins chère passe sous le prix cible, ou le prix bouge au-delà des seuils d'alerte du tableau de bord ; elles remontent en tête de liste et sur l'accueil. `GET`, `POST /api/watchlist`, `PATCH` et `DELETE /api/watchlist/{id}`.
- **Suivre une carte** : une seule saisie, résultats pendant la frappe — « dracaufeu », « dracaufeu 4/102 », « mew 151 », « fouinar ténèbres » : un nombre désigne le numéro, chaque autre mot doit se trouver dans le nom ou la série (ou être son code), sans tenir compte des accents ni des majuscules (`GET /api/catalog/search?q=`). Une ligne par variante avec son prix (« ≈ » s'il vient des annonces ou d'une cote partagée), suivie d'un clic ; la fenêtre reste ouverte pour en suivre plusieurs, le prix cible se règle ensuite dans la liste. Sans saisie, les 5 cartes les plus demandées du moment (`GET /api/purchases/trending`) : cartes de plus de 10 €, relevées depuis moins de 7 jours, vendues la veille sur Cardmarket et dont le prix de vente de la semaine dépasse le plus celui du mois (la demande va plus vite que l'offre), cote propre à la variante. Cardmarket ne publie ni nombre de recherches ni volume de ventes : c'est l'indice le plus proche avec ce que donne la source, et il change d'un jour à l'autre.
- **Bonnes affaires** : parmi les cartes des séries importées relevées depuis moins de 3 jours et cotées au moins 10 € (réglable : 10, 25, 50, 100 €), celles dont l'annonce la moins chère de Cardmarket est au moins 25 % sous le prix des ventes réussies (réglable), la plus grosse économie d'abord. Seules comptent des ventes régulières (semaine et mois renseignés) et des cotes propres à la variante. `GET /api/deals?minCents=&minDiscount=&freshDays=`.
- **Limite importante** : le guide des prix ne dit ni l'état ni la langue de l'annonce la moins chère ; une « affaire » peut être un exemplaire abîmé ou dans une autre langue. C'est une piste à vérifier sur l'annonce, pas un achat sûr. Les annonces eBay ne sont pas lues (pas d'accès à l'API).
- **Relevé quotidien** : les cartes en stock et les cartes suivies d'abord, puis les « grosses » cartes des séries importées (cote d'au moins 10 €), les plus anciennement relevées d'abord, jusqu'à 600 cartes par passage et dans la limite du temps d'exécution ; le reste passe au relevé suivant. Les communes à quelques centimes ne sont pas relevées.

## Livraison et demandes d'avis

- **Transporteur** : déduit du numéro de suivi à la remise (La Poste / Colissimo : 13 caractères ou format international ; Mondial Relay : 8 à 12 chiffres), modifiable à la remise et dans la vente. La liste des ventes montre l'état (déposée, en route, livrée), le numéro et le transporteur ; la vente, le dernier événement et le lien de suivi public.
- **Suivi automatique** chaque matin (tâche quotidienne, `POST /api/shipments/tracking/refresh`), pour les envois en route depuis moins de 45 jours : API « Suivi v2 » de La Poste (`LAPOSTE_OKAPI_KEY`, clé gratuite sur developer.laposte.fr ; codes DI1 livré, DI2 retourné) et service web Mondial Relay `WSI2_TracingColisDetaille` (`MONDIAL_RELAY_ENSEIGNE`, `MONDIAL_RELAY_PRIVATE_KEY` ; STAT 82 livré). Variables d'environnement du déploiement, jamais en base. Sans identifiants : lien de suivi et « Marquer comme livrée ». Une remise en main propre est livrée sur-le-champ. `GET /api/shipments/tracking` dit quels transporteurs sont reliés.
- **Avis à demander** : 24 h après la livraison, la vente passe dans l'onglet « Avis à demander » (`GET /api/orders?review=DUE`), une tâche apparaît sur l'accueil et une notification part une seule fois (préférence « Avis à demander », `POST /api/sales/reviews/remind`, lancé par la tâche quotidienne). La vente propose un message prêt à copier (modèle dans Réglages › Boutique, avec {acheteur} et {boutique}) et « Avis demandé » (`POST /api/orders/:id/review`). Le rappel est envoyé par Dexlane à vous, pas à l'acheteur.
- API : `PATCH /api/orders/:id/tracking`, `POST /api/orders/:id/delivered`.

## Ventes directes — points d'attention

- **Même cycle qu'une commande de marketplace** : une vente saisie à la main (canal `direct`, numéro `V-000123`) crée une commande, alloue les positions, puis suit prélèvement → emballage → remise. Le connecteur de marketplace n'aura qu'à importer des commandes dans ce même circuit.
- **Réservation immédiate, jamais de survente** : la vente et l'allocation sont dans une seule transaction ; si le stock disponible ne suffit pas, rien n'est créé.
- **Prélèvement vérifié** : on saisit le code lu sur la pochette (`SI-000123` ou simplement `123`). Le code d'une autre carte est refusé ; une autre position de la même offre est acceptée et réaffectée.
- **Remise** : lettre non suivie et remise en main propre se confirment sans numéro ; lettre et colis suivis l'exigent. C'est la confirmation de remise qui sort les cartes du stock physique.
- **Annulation** : possible jusqu'à la remise, avec motif ; les cartes redeviennent disponibles. Après la remise, c'est un retour (pas encore géré).
- **Marge** : encaissé (port facturé compris) − coût d'acquisition des cartes − affranchissement − fournitures. Réglages → Frais d'envoi fixe l'affranchissement habituel par mode (prérempli à la remise) et le prix d'un sleeve, d'un top-loader (par carte) et d'une enveloppe (par envoi postal, pas pour une remise en main propre). Avant la remise, la marge est une estimation avec ces tarifs ; à la remise, affranchissement et fournitures sont figés sur l'envoi (`shipments.supplies_cost_cents`) : changer ses tarifs ne réécrit pas les ventes passées. Les ventes remises avant cette règle comptent 0 € de fournitures. Dans la fiche d'une carte du stock, la marge est celle de la carte : prix − coût − sleeve − top-loader ; l'envoi se compte sur la vente. Ni frais de canal, ni TVA, ni temps passé ne sont comptés.

## Prix et catégories — points d'attention

- **Estimation** : estimation d'après les ventes réussies du dernier relevé (repli sur la tendance des annonces sans vente récente) × coefficient d'état. La source ne distingue ni la langue ni l'état : le coefficient est une approximation réglable.
- **Arrondi** : à partir de 10 €, les prix calculés (suggestion, plancher) sont arrondis à l'euro (612,37 € → 612 €) ; seuil et pas réglables. Un prix saisi à la main est gardé tel quel.
- **Catégorie** : seuils indicatifs de la spécification (vrac < 1 €, lot < 5 €, à l'unité ≥ 15 €, premium ≥ 100 €). Entre 5 et 15 €, l'offre part en revue : la rentabilité à l'unité dépend des frais du canal, pas encore connus.
- **Jamais de prix silencieux** : cotation absente, trop ancienne (14 jours) ou partagée avec une autre variante, variante incomplète, prix sous le coût → pas de prix posé d'office, l'offre va dans « À revoir » avec son motif.
- **Pas de repricing automatique** : un prix décidé (par les règles à la première tarification, ou à la main) ne bouge plus. Si la suggestion s'en écarte de plus de 20 %, l'offre revient en revue. Un prix fixé à la main est audité.
- **Plancher** : 80 % du prix cible, sans descendre sous le coût moyen (majoré d'une marge minimale pour les ventes à l'unité).
- **Recalcul** : à chaque entrée en stock, après l'import d'une série (nouvelles cotations) et à chaque changement de règles. La file « À revoir » est triée par enjeu (quantité × prix).
- Les frais de canal, le mode d'expédition et le temps passé n'entrent pas encore dans le calcul (spec 4.3) : ils dépendent du canal retenu.

## Catalogue et cotations — points d'attention

- **Impressions anglaises** : TCGdex rattache aux fiches des autres langues des impressions qui n'existent qu'en anglais (Set de Base « sans ombre » / Shadowless, tirage britannique « Copyright 1999-2000 »). Elles sont écartées des catalogues non anglais ; la 1re édition, qui existe aussi en français, reste, mais sa cote est celle de l'impression anglaise : elle est marquée partagée (jamais tarifée ni publiée sans revue) et sans prix TCGplayer. Pour suivre ou vendre un Charizard Shadowless, importer la série en anglais.
- **Images des cartes** : celles de TCGdex, dans la langue de la carte. TCGdex ne les a pas toutes dans toutes les langues : une carte importée sans image reçoit l'adresse de l'image anglaise de la même carte (même série, même numéro), et l'écran essaie l'image anglaise si l'image dans la langue de la carte ne se charge pas, avant un emplacement vide.

- **Blocs** : « Actualiser la liste » rattache chaque série à son bloc (Wizards, Soleil et Lune, Épée et Bouclier…), y compris les séries non importées ; le catalogue se regroupe et se filtre par bloc. Si la source ne répond pas pour les blocs, la liste des séries reste utilisable.
- **Variantes** : identifiants TCGdex partagés entre langues (unicité par carte). Une variante issue d'un placeholder TCGdex (`variantId: "generated"`, séries très récentes) ou déduite est marquée `incomplete` : à confirmer avant publication.
- **Cotations** : guide des prix Cardmarket relayé par TCGdex ; toutes langues et tous états confondus (`source_scope`). Reverse = champs `-holo`. Les valeurs nulles ou à 0 sont ignorées.
- **Ambiguïté** : quand plusieurs variantes partagent un produit Cardmarket (ex. Set de Base 1re édition / sans ombre), leurs cotations sont `variant_ambiguous` et ne doivent pas servir à publier sans revue.
- **Identification** : revue humaine obligatoire si score < 0,95, si deux candidats sont proches ou si le nom n'a pas été lu. Le choix de la variante est toujours confirmé par l'opérateur.
- **Scan** : Claude transcrit seulement (nom, numéro, code d'extension, langue, indices de finition) ; le rapprochement avec le catalogue reste déterministe. Champ illisible → ignoré ; lisibilité partielle, note du modèle ou langue indéterminée → revue. Repli serveur activé (`fallbacks: "default"`) si le modèle décline une requête.
- **Droits** : les conditions de réutilisation des données TCGdex et du guide des prix Cardmarket restent à vérifier (spec §11, Sprint 0) avant usage commercial.

## Statistiques, démarrage, récaps et progression

Le paquet `packages/insights` (#83 à #86) ; toutes les valeurs réglables sont dans `packages/insights/src/config/progression.ts`
(temps gagné par annonce, délai des cartes dormantes et de confirmation des ventes, seuils et noms des niveaux, avantages,
étapes du démarrage, succès). Tout est privé au compte : pas de profil public, pas de classement.

- **Journal d'événements** (`account_events`, migration 0039) : eBay connecté, carte ajoutée, rangement, annonce publiée
  ou en échec, vente payée, annulée, remboursée ou retournée, bordereau imprimé (et, quand le parrainage existera, filleul
  qualifié et remise à 100 %). Chaque événement a une clé de déduplication unique dans le compte : rejoué ou reconstruit,
  il ne compte qu'une fois. `rebuildJournal` le reconstruit d'après l'historique des tables métier (au lancement, puis
  chaque nuit pour rattraper un oubli). Les commandes de l'acheteur fictif de la simulation (« SIM-… ») ne comptent nulle part.
- **Statistiques › Résumé** (`GET /api/insights/stats?period=this_month|last_month|90d|12m`) : chiffre d'affaires par
  devise (sans conversion, hors port, ventes annulées, remboursées ou retournées exclues), marge sur les lignes au prix
  d'achat connu (coût saisi, ou lot d'acquisition), frais de la marketplace déduits quand ils sont connus, avec sa
  couverture — une vente eBay dont les frais ne sont pas encore synchronisés est signalée (« Frais eBay non inclus ») —,
  cartes vendues (un lot compte pour 1), écoulement, délai médian entre mise en ligne et vente, temps gagné estimé,
  ventes par semaine ISO et 10 meilleures ventes, découpés dans le fuseau de l'utilisateur (`user_preferences.timezone`,
  choisi dans Compte, Europe/Paris par défaut ; celui du propriétaire sert à la tâche quotidienne). Sans donnée : « — ».
- **Frais et remboursements des commandes** (migration 0041) : à chaque synchronisation, eBay est relu pour les commandes
  modifiées, remises comprises. Les frais de la commande (`totalMarketplaceFee`) sont répartis sur ses lignes
  (`order_lines.fee_allocated_cents`, `orders.fees_synced_at`) et déduits de la marge (statistiques, vente, 30 derniers
  jours). Une commande annulée sur eBay avant la remise est annulée dans Dexlane (cartes remises en vente) ; un
  remboursement complet après la remise la marque remboursée (`orders.refunded_at`, événement `sale_refunded`) : elle
  ne compte plus. Une vente remise se rembourse aussi à la main (`POST /api/orders/:id/refund`, bouton « Rembourser »).
- **Cartes dormantes** (`/api/insights/dormant`, `/preview`, `/reprice`, `/lot`, `/withdraw`) : en ligne depuis plus
  de 90 jours, encore en stock, sans vente depuis la mise en ligne. Baisse de prix en deux temps (aperçu, puis
  `confirm: true`), regroupement en lot, retrait de la vente. Rappel sur l'accueil à partir de 10 cartes.
- **Démarrage** (`/api/insights/onboarding`, page `/getting-started`) : sept étapes détectées d'après les données. Le bloc
  de l'accueil se masque (préférence de l'utilisateur) et reste accessible depuis Compte. Une carte est rangée quand elle
  est à un emplacement précis : un emplacement sans sous-emplacement.
- **Récaps** (`/recap`, `/recap/AAAA-MM`, `/recap/AAAA`) : générés par la tâche quotidienne le 1er du mois (et le
  1er janvier pour l'année), seulement si le compte a publié ou vendu. L'e-mail qui les annonce est coupé pour le moment
  (`recapEmailEnabled`) ; réactivé, il n'annonce que les récaps de moins de 7 jours, se désactive dans Compte ou par le
  lien signé de chaque e-mail (`/email/unsubscribe`), et rien ne part sans service d'e-mail. L'image à
  partager (`/recap/…/image?format=post|story&revenue=0|1&shop=0|1`, 1080 × 1350 ou 1080 × 1920) est rendue par
  `next/og` avec la police Geist embarquée, sans service externe, et n'est conservée nulle part. Par défaut : aucun
  montant, aucun nom de boutique, aucune image de carte.
- **Niveau et succès** (`/api/insights/progress`, page `/progress`) : chaque compte a sa carte vendeur, dont le cadre
  change de matière à chaque niveau (Carton, Bois, Pierre, Fer, Bronze, Argent, Or, Platine, Diamant, Légende) ; les
  14 succès sont des cartes numérotées avec leur rareté (commune à secrète), rangées dans un classeur. Le niveau 1
  s'obtient en terminant la configuration du compte ; ensuite, le niveau ne dépend que des ventes confirmées
  (`sale_confirmations` : une ligne de commande d'annonce restée 14 jours sans annulation, retour ni remboursement,
  écrite une fois). Il ne descend jamais ; une annonce publiée ne donne aucun point ; aucune série quotidienne. Succès
  uniques par compte (`account_achievements`), jamais retirés sauf fraude (`revokeAchievement`, action d'administration).
  Avantages appliqués une fois (`account_perks`) : accès anticipé (`account_progress.beta`) au niveau 3, cartes de bonus
  aux niveaux 5 et 7 par le quota (point d'extension `PerkHooks` de l'API ; rien en Community). La progression est
  réévaluée après chaque publication, vente ou mouvement de stock, et chaque nuit. Notification groupée dans
  l'application, jamais d'e-mail. Réglage par utilisateur « Afficher le niveau et les succès ».
- **Attribution rétroactive** : la migration 0039 marque les comptes existants ; leur première évaluation (tâche
  quotidienne, ou `pnpm --filter @dexlane/insights retro`) attribue leur historique sans notification, puis un message
  unique résume les succès déjà débloqués.
- Données fictives pour essayer ces écrans : `DATABASE_URL=… tsx packages/insights/test/demo-seed.ts` sur une base vide.

## Statistiques, mises en ligne et réglages

- **Statistiques** (`/stats`) : l'onglet Ventes montre ce qui se vend sur 30 jours, 90 jours ou 12 mois — chiffre d'affaires et cartes vendues comparés à la période précédente, prix moyen, délai médian entre l'entrée en stock et la vente, part du stock écoulée, puis le détail par série (vendues, restantes, écoulement), tranche de prix, état, rareté, canal et jour de la semaine, et les cartes les plus vendues. Quelques phrases « À retenir » résument la période. Le bloc « Mises en vente et ventes » compare les cartes mises en vente et les cartes vendues (rapport vendues ÷ mises en vente, évolution, douze mois côte à côte) : « équilibré » entre 80 et 125 %, « en croissance » quand les deux flux progressent d'au moins 5 % ; une carte compte comme mise en vente à sa première mise en ligne, ou le jour de sa vente si elle part en direct sans être passée en ligne. Une vente compte à sa date d'enregistrement, hors ventes annulées. `GET /api/stats/sales?days=90`. L'onglet Stock et cotes (`?view=prices`) garde la valeur du stock et les variations de cote.
- **Mises en ligne** (`/listings`) : un calendrier du mois (prévues par canal, publiées, échecs ; un jour s'ouvre carte par carte pour déplacer, annuler, replanifier ou publier tout de suite), la vue en liste jour par jour, et les cartes prêtes qui restent à planifier.
- **Actions groupées du stock** : `POST /api/stock/bulk` avec `{ action: "ACCEPT_PRICE" | "ACTIVATE" | "MOVE", offerIds, locationCode? }` ; renvoie le nombre d'offres ou de positions réellement modifiées (celles que l'action ne concerne pas sont laissées telles quelles).
- **Réglages** : Boutique et documents (en-tête des bons et reçus, papier de l'imprimante), Saisie des cartes (scanner, appareil photo ou fichiers), Alertes de prix, Frais d'envoi, et l'export du stock complet en CSV.
- **Langue** : l'interface existe en français et en anglais (Compte › Langue de l'interface, ou en bas de la page de connexion). Le choix est gardé dans un cookie sur l'appareil ; à défaut, la langue du navigateur décide. Le français est la langue source : chaque texte passe par `t()` / `tn()` (`apps/web/lib/i18n.ts`) et sa traduction vit dans `apps/web/lib/i18n/en/`. `pnpm --filter @dexlane/web test` (lancé en CI) échoue si un texte n'a pas sa traduction ; `pnpm --filter @dexlane/web i18n --untranslated` repère le français resté hors de `t()`. Montants, nombres et dates suivent la langue choisie ; les annonces publiées gardent leur propre modèle.
- **Mobile** : pas de barre d'en-tête, la recherche et les réglages sont deux icônes en haut à droite ; aucun écran ne défile de côté (onglets qui passent à la ligne, filtres du stock dans un tiroir).
- **Logo sur les photos** : dans Réglages › Modèle d'annonce et photos › Photos, « Logo et signature » ajoute le logo de la boutique (PNG transparent conseillé) dans le coin choisi des visuels d'annonce, avec à côté la mention « powered by » et le logo Dexlane complet (désactivable). Le logo est une photo `kind=LOGO` (`POST /api/photos?kind=LOGO`) ; le style des photos porte `logoPhotoId`, `brandPosition` et `poweredBy`. Les visuels déjà composés se mettent à jour avec « Recomposer ».
- **Cache des écrans** (`apps/web/lib/cache.ts`) : les données déjà chargées restent en mémoire, et sur l'appareil (localStorage, dans un budget de quelques mégaoctets, une semaine au plus, effacé à la déconnexion ou à l'expiration de la session). En revenant sur un écran, elles s'affichent tout de suite au lieu du squelette, puis l'écran les recharge en arrière-plan et les remplace. Pour les listes filtrées ou recherchées, la liste précédente reste affichée pendant le chargement. Sur téléphone et tablette, les barres de défilement sont masquées.
- **Coupures de la base** : une erreur de connexion à PostgreSQL (délai dépassé, connexion coupée, serveur qui redémarre) est rendue en `503 DATABASE_UNAVAILABLE` ; une lecture (`GET`) est retentée deux fois avant de l'être. Les écritures ne sont jamais rejouées automatiquement.
- **Notifications sur le téléphone** (Réglages › Notifications) : chaque appareil s'abonne (Web Push, service worker `public/sw.js`) ; sur iPhone, après ajout de l'application à l'écran d'accueil. Chaque matin, après la tâche quotidienne, un résumé part seulement s'il y a du nouveau : ventes arrivées d'eBay ou de CardTrader, cartes suivies passées sous leur prix cible (une seule fois par carte), mises en ligne en échec. Les types de notification se choisissent. Les clés de signature (VAPID) sont créées au premier besoin et gardées en base. `GET /api/notifications`, `POST /api/notifications/subscriptions`, `/subscriptions/remove`, `/test`, `/digest`.
- **Photos « scannées »** : une photo de carte prise au téléphone (écran d'ajout, lots photographiés) est traitée dans le navigateur avec OpenCV (`apps/web/lib/card-scan.ts`) : la carte est repérée, redressée (perspective corrigée) et recadrée au format 63 × 88 avant la lecture et l'enregistrement. Si elle n'est pas repérée avec assez de certitude, la photo d'origine part telle quelle. OpenCV (environ 4 Mo compressés) n'est chargé que sur les écrans de photo, en tâche de fond.

