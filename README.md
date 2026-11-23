# dexlane — Pokémon Trading OS

Application personnelle de négoce de cartes Pokémon. Spécification : [`specs-pokemon-trading-automation.md`](specs-pokemon-trading-automation.md) (v1.1).

## État

**Page d'accueil** (`/`) : sans session, une page de présentation publique (ce que fait Dexlane, le parcours en quatre gestes, un bouton de connexion) ; avec une session, l'accueil « Aujourd'hui » — ce qui attend une action (lots à revoir, brouillons, cartes à tarifer, cartes prêtes non planifiées, mises en ligne du jour ou en échec, ventes à préparer ou à remettre, alertes de cote), chaque ligne menant droit à l'écran concerné, puis quatre chiffres. Le Stock est à `/stock`. La page publique n'est pas indexée par les moteurs (`robots: noindex`), et sur Vercel elle n'est visible de tous que si la protection des déploiements le permet (domaine personnalisé ou protection levée). L'accueil montre aussi l'activité récente (`GET /api/stats/activity`) : deux graphiques en bâtons sur 30 jours — chiffre d'affaires et nombre de ventes, un graphique par mesure plutôt que deux échelles sur le même —, les dernières ventes et les dernières mises en ligne. Une vente y compte à sa date d'enregistrement, pour le montant encaissé, hors annulations ; la marge de « En bref » reste calculée sur les ventes remises.

**Assistant de démarrage** (`/bienvenue`) : à la première utilisation, six étapes — création du compte, mode de scan (scanner, téléphone ou fichiers), import des séries (sélection par bloc, barre d'avancement), emplacements, stratégie de prix, canaux de vente. Tout sauf le compte et le mode de scan peut être passé ; l'assistant se relance depuis Réglages.

**Organisation** : sept destinations — Accueil (`/`), Stock (`/stock`), Mises en ligne (`/mises-en-ligne`), Achats, Ventes, Statistiques, Réglages ; sur téléphone, cinq onglets (Accueil, Stock, Achats, Ventes, Stats) dans une barre flottante qui se réduit au défilement. « Ajouter des cartes » est en tête de l'Accueil et du Stock. Le Stock : une ligne par carte à vendre (offre), recherche et filtres (série, boîte, état, prix) derrière un bouton avec les filtres posés en puces, prix modifiable sur place, fiche latérale (photos agrandissables, recto et verso empilés, prix, cote, annonce, publication, positions), actions groupées sur la sélection (accepter les prix suggérés, valider les brouillons, déplacer, exporter en CSV, mettre en ligne).

**Sprint 1** terminé : catalogue, scan, stock, entrée en stock, recherche, API HTTP et application web (Scanner, Inventaire, Vrac, Rangement). **Sprint 2** entamé : prix et catégories faits ; la publication attend le choix du canal. **Sprint 3** entamé : ventes directes avec préparation et remise.

| Package | Contenu |
|---|---|
| `infra/migrations` | Schéma PostgreSQL complet (spec §7), contraintes d'intégrité, journal append-only, outbox |
| `packages/db` | Connexion postgres.js, helper de transaction, migrations |
| `packages/shared` | Erreurs métier, montants en centimes |
| `packages/catalog` | Synchronisation TCGdex (séries, cartes, variantes détaillées, cotations Cardmarket datées), recherche des 3 meilleurs candidats à partir d'une lecture OCR |
| `packages/scan` | Lecture de carte par Claude (vision + sortie structurée, repli serveur), identification photo → candidats catalogue, banc d'essai précision/coût |
| `packages/pricing` | Moteur de règles de prix (estimation, catégorie, plancher, motifs de revue), tarification des offres, file de revue, règles réglables. Statistiques : ce qui se vend (`salesInsights` : séries et taux d'écoulement, tranches de prix, états, raretés, canaux, jours de la semaine, délai de vente, cartes les plus vendues), valeur du stock, variations de cote des cartes détenues, seuils d'alerte |
| `packages/listings` | Annonces : modèle de titre et de description à variables, style des photos, offres vendables avec leur texte et leurs photos. Canaux de vente : interface de connecteur, mode simulation, publication, alignement des quantités, import des commandes |
| `packages/inventory` | Entrée d'une carte identifiée (offre et SKU attribués automatiquement), lots de vrac et extraction, emplacements hiérarchiques, lots d'acquisition, déplacement, correction d'inventaire auditée, recherche, import idempotent de commandes, allocation commande → positions, survente (Parcours F), picking par scan, emballage, confirmation de dépôt |
| `apps/api` | API HTTP (Hono) : scan, recherche catalogue, emplacements, entrée en stock, vrac, inventaire. Jeton propriétaire, validation stricte, clés d'idempotence |
| `apps/web` | Application web installable (Next.js), pensée pour le téléphone : scan photo → candidats → confirmation → rangement, recherche manuelle, inventaire et fiche de position (déplacer, corriger, valider), lots de vrac et extraction, emplacements (aide, création en série, arborescence) et lots d'acquisition, catalogue (import par série, détail d'une série avec prix et stock détenu), prix (file de revue, règles), ventes directes (saisie, préparation, remise, marge), scan en lot (images d'un scanner à défilement), photos des exemplaires, annonces (modèle, fond des photos, visuels composés, canaux), statistiques (chiffres clés, variations de prix, alertes), compte (mot de passe, thème) |

Pas encore commencés : `apps/worker`, connecteurs réels eBay et CardTrader (le socle et la simulation sont en place ; les connecteurs attendent les accès API), fulfillment PDF, étiquettes QR.

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

Mise en ligne planifiée : `GET /api/publications` (planning par jour, échecs récents), `POST /api/publications/plan` (`offerIds` facultatif, `channel`, `startOn`, `perDay`), `POST /api/publications/cancel`, `POST /api/publications/run` (publie ce qui est dû ; lancé chaque jour par la tâche planifiée). `POST /api/photos?kind=PROMO` dépose l'image de fin d'annonce, réglée par `promoPhotoId` dans les réglages d'annonce.

Stock à vendre : `GET /api/stock?q=&status=ALL|TO_PRICE|READY|LISTED|DRAFT&sort=recent|value|name&setId=&location=&condition=&minCents=&maxCents=` (filtres : série, boîte et ses sous-emplacements, état, fourchette de prix sur le prix fixé sinon suggéré), `GET /api/stock/facets` (séries, boîtes et états présents, pour les filtres) (une ligne par offre, compteurs par statut, valeur totale), `GET /api/stock/{offerId}` (annonce, photos, positions, estimation d'après les ventes). `POST /api/pricing/offers/{id}/price` accepte un prix sans catégorie : elle est déduite du palier de prix.

Statistiques : `GET /api/stats/dashboard`, `GET /api/stats/price-moves?alerts=true|false`, `GET` / `PUT /api/stats/alert-settings`, `POST /api/prices/refresh` (relève les cotes des cartes en stock, puis réévalue les offres).

Canaux : `GET /api/channels`, `PUT /api/channels/{ebay|cardtrader}` (`OFF`, `SIMULATION`, `LIVE`), `POST /api/channels/sync`, `POST /api/listings/offers/{id}/publish`, `POST /api/listings/{id}/end`, `POST /api/listings/{id}/simulate-order`.

Autres routes : `GET /api/catalog/sets/{id}` (contenu importé d'une série : cartes, variantes avec leur prix estimé d'après les ventes — `estimate` —, exemplaires en stock), `POST /api/locations/batch`, `PATCH` et `DELETE /api/locations/{id}` (suppression réservée à un emplacement vide et jamais utilisé), `/api/auth/*` (mot de passe du propriétaire, réservé au serveur web).

Toutes les routes sauf `GET /api/health` exigent `Authorization: Bearer <DEXLANE_API_TOKEN>`. Les créations et corrections (`receive`, `bulk`, `extract`, `adjust`, `acquisition-lots`) exigent un en-tête `Idempotency-Key` : la clé est écrite dans la même transaction que la mutation, donc une requête rejouée (double appui, réseau mobile) renvoie la réponse d'origine avec `Idempotent-Replay: true` sans rien créer en double. Erreurs : `{ "error": { "code", "message", "details" } }` — 400 format, 404 introuvable, 409 état incompatible, 422 règle métier.

Application web :

```sh
pnpm api                                   # dans un terminal
pnpm web                                   # dans un autre : http://localhost:3000 (dev)
pnpm --filter @dexlane/web build && pnpm --filter @dexlane/web start   # production
```

- **Connexion** : par mot de passe (10 caractères minimum). À la première connexion, l'écran demande `DEXLANE_API_TOKEN` comme jeton d'installation pour choisir le mot de passe ; le même jeton sert de clé de secours (« Mot de passe oublié ? »). Le mot de passe est stocké haché (scrypt) ; après 5 essais infructueux, la connexion est bloquée 30 s, puis le double à chaque nouvel échec, jusqu'à 15 min.
- **Session** : cookie `httpOnly` / `SameSite=Strict` signé par le serveur web, valable 30 jours ; il ne contient ni le mot de passe ni le jeton. Changer le mot de passe (page Compte) déconnecte les autres appareils. Le navigateur n'appelle jamais l'API directement : le serveur Next relaie `/api/*` avec son propre `DEXLANE_API_TOKEN` (lu dans le `.env` de la racine en développement ; `DEXLANE_API_URL` par défaut : API embarquée).
- **Sur le téléphone** : utiliser le build de production (`build` puis `start`). En `dev`, Next ne sert ses ressources qu'à `localhost` ; pour tester depuis une autre machine, lister ses hôtes dans `DEXLANE_DEV_ORIGINS=192.168.1.20,mon-pc.local`. Le serveur doit être joignable depuis le téléphone, de préférence en HTTPS (reverse proxy ou VPN type Tailscale) — le cookie n'est marqué `Secure` qu'en HTTPS. La photo passe par l'appareil photo natif (pas besoin de permission caméra dans le navigateur) puis est réduite à 2000 px avant envoi. « Ajouter à l'écran d'accueil » installe l'application.
- **Interface** : Tailwind CSS 4 et composants de type shadcn/ui sur primitives Radix (`apps/web/components/ui`), icônes Lucide, tiroirs mobiles vaul, palette de commandes cmdk (⌘K / Ctrl+K : pages et recherche de positions), notifications sonner, police Geist, thème clair / sombre / système. Barre latérale sur ordinateur, onglets en bas sur téléphone.
- **Garde-fous du scanner** : une carte n'est présélectionnée que si l'identification est sûre ; sinon l'opérateur choisit explicitement. L'état n'est jamais prérempli. Emplacement, coût et lot restent d'une carte à l'autre. Une même saisie renvoyée après une coupure réseau n'est pas enregistrée deux fois.
- **Lots scannés** (`/scanner/lot`) : un lot est une pile de cartes passée au scanner à défilement et rangée dans une boîte, dans l'ordre. On relie une fois le dossier où le scanner enregistre ses images (Chrome ou Edge) : chaque carte scannée arrive d'elle-même, est lue et prend son rang. En recto verso, deux fichiers par carte, dans l'ordre des noms ; un recto attend son verso, un fichier en cours d'écriture attend d'être complet, et les images déjà présentes à la liaison sont ignorées. Le lot vit côté serveur : fermer l'onglet ne perd ni les lectures ni les corrections, et relier à nouveau le dossier ne relit rien. La revue corrige carte, variante et état, ou écarte une carte ; l'entrée en stock se fait d'un bloc quand tout est décidé, pour que les codes `SI-…` suivent exactement la pile. Pour aller vite pendant la revue : la variante que le scan n'a pas pu lire (normale, reverse, holo) s'applique d'un clic à toutes les cartes concernées, et la correction d'une carte enchaîne sur la suivante à corriger. Une fois le lot en stock, ses visuels d'annonce se composent seuls et la mise en ligne de ses cartes se planifie depuis le même écran. Formats lus : JPEG, PNG, WebP (pas de PDF ni de TIFF). **Sans scanner**, le même lot s'alimente au téléphone : un bouton photographie le recto puis le verso de chaque carte (ou le recto seul), dans l'ordre des prises de vue ; le lot ouvert sur un autre appareil se met à jour tout seul, pour faire la revue sur l'ordinateur. Les photos de téléphone ne sont pas recadrées automatiquement : cadrer serré.
- **Annonces** (dans la fiche d'une carte du stock ; l'ancienne page `/annonces` mène aux mises en ligne): chaque offre vendable y a son titre et sa description, rendus à partir d'un modèle à variables (`{nom}`, `{numero}`, `{serie}`, `{variante}`, `{langue}`, `{etat}`, `{prix}`…). Le titre est limité à 80 caractères (limite eBay) et coupé au dernier mot ; une ligne dont les variables sont vides disparaît. L'onglet Photos règle la mise en scène des scans : fond (couleur, dégradé ou image personnelle), marge, rognage du liseré du scanner, coins arrondis, ombre, texte. Le visuel carré est composé dans le navigateur — l'aperçu est exactement le fichier enregistré — puis déposé dans le stockage ; recomposer remplace l'ancien.
- **Visuels** : les miniatures viennent directement de `assets.tcgdex.net`.

Déploiement en un seul service (Vercel) :

Sans `DEXLANE_API_URL`, le serveur Next embarque l'API : un seul déploiement suffit, plus une base PostgreSQL.

1. Projet Vercel lié au dépôt, **Root Directory** `apps/web` (le build installe tout le monorepo). `apps/web/vercel.json` applique les migrations avant `next build`.
2. Base : onglet **Storage** du projet → Neon (offre gratuite). L'intégration fournit `DATABASE_URL` (connexions poolées, utilisées par l'application) et `DATABASE_URL_UNPOOLED` (connexion directe, utilisée par les migrations).
3. Variables d'environnement : `DEXLANE_API_TOKEN` (≥ 24 caractères ; jeton d'installation et clé de secours du mot de passe), `ANTHROPIC_API_KEY` (scan), `ENABLE_EXPERIMENTAL_COREPACK=1` (pnpm de `packageManager`).
4. Tâche quotidienne : `apps/web/vercel.json` déclare un cron (`/cron/daily`, chaque nuit) qui relève les cotes des cartes en stock et synchronise les canaux. Elle exige la variable `CRON_SECRET` (valeur aléatoire), que Vercel présente à chaque appel ; sans elle, la route refuse tout.
5. Photos : onglet **Storage** → Blob (accès public), relié au projet ; l'intégration fournit `BLOB_READ_WRITE_TOKEN`. Sans cette variable, tout fonctionne mais les images scannées ne sont pas conservées.
6. Catalogue : la base hébergée démarre vide. Onglet **Catalogue** de l'application : « Charger la liste », puis « Synchroniser » les séries possédées (rejouable, met à jour les cartes et ajoute les cotations du jour). La commande `pnpm --filter @dexlane/catalog sync` reste disponible depuis un poste.

À savoir : préversions et production partagent la même base tant qu'aucune base par branche n'est configurée ; c'est pourquoi une préversion n'applique pas les migrations (voir « Intégration continue et déploiement »). L'application est protégée par le mot de passe du propriétaire, avec blocage temporaire après des essais infructueux répétés.

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

- **Trois modes par canal** : désactivé, simulation, réel. Le mode réel exige un connecteur configuré (`ChannelAdapter` passé à `createApp`) ; aucun n'est encore écrit, faute d'accès API. Le contrat suit le modèle d'eBay : une annonce par `offer_sku`, une quantité tenue à jour, des commandes qu'on vient chercher.
- **Simulation** : le canal accepte tout et n'envoie rien. « Simuler un achat » crée une commande par le même chemin qu'une vraie (import idempotent, réservation, envoi à préparer) : elle réserve réellement le stock, à annuler après essai. Quitter la simulation termine les annonces simulées.
- **Prête à publier** : une offre doit avoir un prix cible, au moins une photo de l'exemplaire et une variante confirmée ; sinon la publication est refusée avec la liste de ce qui manque.
- **Double vente entre canaux** : après toute écriture sur `/api/orders` ou `/api/inventory`, la quantité annoncée est réalignée sur le stock vendable (moins la marge `buffer`). À zéro, l'annonce passe en pause ; elle reprend au réassort. Un échec côté canal laisse l'annonce en `ERROR`, retentée à la synchronisation suivante.
- **Commandes de canal** : déjà conclues ailleurs, elles ne sont jamais refusées ; si le stock manque, elles partent en survente (Parcours F) au lieu d'échouer.
- **Mise en ligne planifiée** : depuis le Stock, des cartes sélectionnées (ou toutes les cartes prêtes, dans l'ordre d'entrée en stock) sont réparties sur des jours consécutifs, N par jour. La tâche quotidienne publie ce qui est dû — tôt le matin, heure de Paris pour le calendrier — et une publication impossible (prix ou photo manquante, stock épuisé, canal éteint) est marquée en échec avec son motif sans bloquer les autres. Replanifier une carte déplace sa date ; une carte déjà en ligne sur le canal est laissée de côté.
- **Visuel d'annonce composé d'office** : dès qu'une photo arrive (lot entré en stock, photo ajoutée après coup) et avant toute publication ou planification, le visuel « carte sur fond » est composé dans le navigateur s'il manque. Réglable dans Réglages → Modèle d'annonce et photos (`autoCompose`) ; désactivé, les photos partent telles quelles.
- **Image de fin d'annonce** : réglée une fois (Annonces → Photos), elle est ajoutée en dernière photo de chaque annonce publiée, après les photos de la carte.
- **Prix** : l'annonce garde le prix du moment de la publication ; un prix cible modifié ensuite est signalé, « Mettre à jour » le renvoie.

## Du scanner à l'envoi — le parcours sans intervention

1. **La pile passe au scanner.** Un lot en « pilote automatique » (option à la création du lot, activable ou coupable à tout moment) ne demande plus de revue : chaque carte reconnue sans doute entre en stock dans l'ordre du scan avec l'état du lot, reçoit son prix d'après les ventes réussies, voit sa photo d'annonce composée et part à la mise en ligne sur chaque canal actif — le jour même, ou étalée à N par jour sans déplacer ce qui est déjà planifié.
2. **Seules les exceptions attendent.** Une carte mal lue, sans variante sûre ou sans cote fiable reste « à vérifier » ou « à tarifer » sans bloquer les autres ; corrigée, elle suit toute seule. En recto verso, une carte attend son verso une minute au plus.
3. **Une fois par jour, les envois.** Ventes → « Préparer les envois » produit un seul document : la liste de prélèvement rangée par boîte (avec le rang de la carte dans sa pile scannée), puis un bon de livraison et un reçu par commande. Le papier se règle (rouleau thermique 80 ou 58 mm, étiquette 100 × 150 mm, A4), une feuille par page pour que l'imprimante coupe entre chaque. Les commandes imprimées sont marquées et ne reviennent pas le lendemain ; elles restent réimprimables.

Ce qui reste une action de votre part, et pourquoi :

- **Relier le dossier du scanner** à l'ouverture du lot : un navigateur ne lit un dossier qu'après un clic d'autorisation. Un petit programme installé sur le poste du scanner supprimerait ce clic ; il n'est pas écrit.
- **Cliquer « Imprimer »** : une page web ne peut pas imprimer seule. Le lien `/ventes/preparation?imprimer=1` ouvre directement la boîte d'impression ; Chrome lancé avec `--kiosk-printing` l'imprime alors sans confirmation.
- **La mise en ligne est simulée** tant que les connecteurs eBay et CardTrader ne sont pas branchés.
- Si l'onglet du lot est fermé avant la fin, ce qui est en file est publié par la tâche quotidienne.

## Fiche d'une carte

`/carte/{id}` regroupe tout ce qui concerne une carte du catalogue (par exemple « Dracaufeu, Set de Base 4, FR ») :
ses variantes avec leurs prix sur chaque plateforme et leur suivi, la courbe de prix par variante, chaque exemplaire en
stock regroupé par offre (variante × état) avec sa boîte, son rang dans la pile scannée, son coût et ses réservations,
les annonces en ligne, et les ventes. On y arrive depuis le nom de la carte dans la fiche du stock, la page Achats, le
catalogue, la fiche d'une position et l'accueil ; « Ouvrir dans le stock » mène à l'offre (`/stock?offre={offerId}`).
`GET /api/cards/{id}`.

## Achats — cartes suivies et bonnes affaires

- **Cartes suivies** (`/achats`) : une variante précise du catalogue, avec un prix cible d'achat facultatif. Pour chacune : estimation d'après les ventes réussies et annonce la moins chère sur Cardmarket, prix du marché TCGplayer (en dollars, marché américain, jamais converti ni mélangé aux cotes en euros), variation sur la fenêtre des alertes, courbe d'évolution, liens de recherche Cardmarket et eBay. Alertes : l'annonce la moins chère passe sous le prix cible, ou le prix bouge au-delà des seuils d'alerte du tableau de bord ; elles remontent en tête de liste et sur l'accueil. `GET`, `POST /api/watchlist`, `PATCH` et `DELETE /api/watchlist/{id}`.
- **Suivre une carte** : une seule saisie, résultats pendant la frappe — « dracaufeu », « dracaufeu 4/102 », « mew 151 », « fouinar ténèbres » : un nombre désigne le numéro, chaque autre mot doit se trouver dans le nom ou la série (ou être son code), sans tenir compte des accents ni des majuscules (`GET /api/catalog/search?q=`). Une ligne par variante avec son prix (« ≈ » s'il vient des annonces ou d'une cote partagée), suivie d'un clic ; la fenêtre reste ouverte pour en suivre plusieurs, le prix cible se règle ensuite dans la liste. Sans saisie, les 5 cartes les plus demandées du moment (`GET /api/purchases/trending`) : cartes de plus de 10 €, relevées depuis moins de 7 jours, vendues la veille sur Cardmarket et dont le prix de vente de la semaine dépasse le plus celui du mois (la demande va plus vite que l'offre), cote propre à la variante. Cardmarket ne publie ni nombre de recherches ni volume de ventes : c'est l'indice le plus proche avec ce que donne la source, et il change d'un jour à l'autre.
- **Bonnes affaires** : parmi les cartes des séries importées relevées depuis moins de 3 jours et cotées au moins 10 € (réglable : 10, 25, 50, 100 €), celles dont l'annonce la moins chère de Cardmarket est au moins 25 % sous le prix des ventes réussies (réglable), la plus grosse économie d'abord. Seules comptent des ventes régulières (semaine et mois renseignés) et des cotes propres à la variante. `GET /api/deals?minCents=&minDiscount=&freshDays=`.
- **Limite importante** : le guide des prix ne dit ni l'état ni la langue de l'annonce la moins chère ; une « affaire » peut être un exemplaire abîmé ou dans une autre langue. C'est une piste à vérifier sur l'annonce, pas un achat sûr. Les annonces eBay ne sont pas lues (pas d'accès à l'API).
- **Relevé quotidien** : les cartes en stock et les cartes suivies d'abord, puis les « grosses » cartes des séries importées (cote d'au moins 10 €), les plus anciennement relevées d'abord, jusqu'à 600 cartes par passage et dans la limite du temps d'exécution ; le reste passe au relevé suivant. Les communes à quelques centimes ne sont pas relevées.

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

## Statistiques, mises en ligne et réglages

- **Statistiques** (`/statistiques`) : l'onglet Ventes montre ce qui se vend sur 30 jours, 90 jours ou 12 mois — chiffre d'affaires et cartes vendues comparés à la période précédente, prix moyen, délai médian entre l'entrée en stock et la vente, part du stock écoulée, puis le détail par série (vendues, restantes, écoulement), tranche de prix, état, rareté, canal et jour de la semaine, et les cartes les plus vendues. Quelques phrases « À retenir » résument la période. Une vente compte à sa date d'enregistrement, hors ventes annulées. `GET /api/stats/sales?days=90`. L'onglet Stock et cotes (`?vue=cotes`) garde la valeur du stock et les variations de cote.
- **Mises en ligne** (`/mises-en-ligne`) : le planning jour par jour et canal par canal, la publication du jour, les échecs, et les cartes prêtes qui restent à planifier.
- **Actions groupées du stock** : `POST /api/stock/bulk` avec `{ action: "ACCEPT_PRICE" | "ACTIVATE" | "MOVE", offerIds, locationCode? }` ; renvoie le nombre d'offres ou de positions réellement modifiées (celles que l'action ne concerne pas sont laissées telles quelles).
- **Réglages** : Boutique et documents (en-tête des bons et reçus, papier de l'imprimante), Saisie des cartes (scanner, appareil photo ou fichiers), Alertes de prix, Frais d'envoi, et l'export du stock complet en CSV.

