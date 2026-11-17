# dexlane — Pokémon Trading OS

Application personnelle de négoce de cartes Pokémon. Spécification : [`specs-pokemon-trading-automation.md`](specs-pokemon-trading-automation.md) (v1.1).

## État

**Sprint 1** terminé : catalogue, scan, stock, entrée en stock, recherche, API HTTP et application web (Scanner, Inventaire, Vrac, Rangement). **Sprint 2** entamé : prix et catégories faits ; la publication attend le choix du canal.

| Package | Contenu |
|---|---|
| `infra/migrations` | Schéma PostgreSQL complet (spec §7), contraintes d'intégrité, journal append-only, outbox |
| `packages/db` | Connexion postgres.js, helper de transaction, migrations |
| `packages/shared` | Erreurs métier, montants en centimes |
| `packages/catalog` | Synchronisation TCGdex (séries, cartes, variantes détaillées, cotations Cardmarket datées), recherche des 3 meilleurs candidats à partir d'une lecture OCR |
| `packages/scan` | Lecture de carte par Claude (vision + sortie structurée, repli serveur), identification photo → candidats catalogue, banc d'essai précision/coût |
| `packages/pricing` | Moteur de règles de prix (estimation, catégorie, plancher, motifs de revue), tarification des offres, file de revue, règles réglables |
| `packages/inventory` | Entrée d'une carte identifiée (offre et SKU attribués automatiquement), lots de vrac et extraction, emplacements hiérarchiques, lots d'acquisition, déplacement, correction d'inventaire auditée, recherche, import idempotent de commandes, allocation commande → positions, survente (Parcours F), picking par scan, emballage, confirmation de dépôt |
| `apps/api` | API HTTP (Hono) : scan, recherche catalogue, emplacements, entrée en stock, vrac, inventaire. Jeton propriétaire, validation stricte, clés d'idempotence |
| `apps/web` | Application web installable (Next.js), pensée pour le téléphone : scan photo → candidats → confirmation → rangement, recherche manuelle, inventaire et fiche de position (déplacer, corriger, valider), lots de vrac et extraction, emplacements (aide, création en série, arborescence) et lots d'acquisition, catalogue (import par série, détail d'une série avec prix et stock détenu), compte (mot de passe, thème) |

Pas encore commencés : `apps/worker`, connecteurs marketplaces (publication), fulfillment PDF, photos des exemplaires, étiquettes QR.

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

Prix : `GET /api/pricing/variants/{id}?condition=` (estimation avant entrée en stock), `GET /api/pricing/offers?status=REVIEW|ALL` (file de revue triée par enjeu), `POST /api/pricing/offers/{id}/price` (décision), `GET` / `PUT /api/pricing/settings` (règles), `POST /api/pricing/recompute`.

Autres routes : `GET /api/catalog/sets/{id}` (contenu importé d'une série : cartes, variantes, dernier prix tendance, exemplaires en stock), `POST /api/locations/batch`, `PATCH` et `DELETE /api/locations/{id}` (suppression réservée à un emplacement vide et jamais utilisé), `/api/auth/*` (mot de passe du propriétaire, réservé au serveur web).

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
- **Visuels** : les miniatures viennent directement de `assets.tcgdex.net`.

Déploiement en un seul service (Vercel) :

Sans `DEXLANE_API_URL`, le serveur Next embarque l'API : un seul déploiement suffit, plus une base PostgreSQL.

1. Projet Vercel lié au dépôt, **Root Directory** `apps/web` (le build installe tout le monorepo). `apps/web/vercel.json` applique les migrations avant `next build`.
2. Base : onglet **Storage** du projet → Neon (offre gratuite). L'intégration fournit `DATABASE_URL` (connexions poolées, utilisées par l'application) et `DATABASE_URL_UNPOOLED` (connexion directe, utilisée par les migrations).
3. Variables d'environnement : `DEXLANE_API_TOKEN` (≥ 24 caractères ; jeton d'installation et clé de secours du mot de passe), `ANTHROPIC_API_KEY` (scan), `ENABLE_EXPERIMENTAL_COREPACK=1` (pnpm de `packageManager`).
4. Catalogue : la base hébergée démarre vide. Onglet **Catalogue** de l'application : « Charger la liste », puis « Synchroniser » les séries possédées (rejouable, met à jour les cartes et ajoute les cotations du jour). La commande `pnpm --filter @dexlane/catalog sync` reste disponible depuis un poste.

À savoir : préversions et production partagent la même base tant qu'aucune base par branche n'est configurée — une préversion applique donc ses migrations à la base de production. L'application est protégée par le mot de passe du propriétaire, avec blocage temporaire après des essais infructueux répétés.

Tests de bout en bout (navigateur mobile → Next → API → PostgreSQL de test ; seule la lecture Claude est simulée) :

```sh
pnpm --filter @dexlane/web exec playwright install chromium   # une fois
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
- **Emplacement** : obligatoire et jamais créé implicitement — une faute de frappe renvoie `LOCATION_NOT_FOUND` au lieu de créer une boîte.
- **Correction d'inventaire** : saisie de la quantité comptée, pas d'un écart ; refusée sous les quantités réservées (cas du Parcours F).
- **Coût du vrac** : le coût unitaire est stocké en centimes entiers ; 1 000 cartes à 15 € donnent 2 c pièce (20 € reconstitués). Le coût exact reste celui du lot d'acquisition.

## Prix et catégories — points d'attention

- **Estimation** : dernière cotation importée pour la variante (tendance Cardmarket par défaut, repli sur les moyennes de ventes) × coefficient d'état. La source ne distingue ni la langue ni l'état : le coefficient est une approximation réglable.
- **Catégorie** : seuils indicatifs de la spécification (vrac < 1 €, lot < 5 €, à l'unité ≥ 15 €, premium ≥ 100 €). Entre 5 et 15 €, l'offre part en revue : la rentabilité à l'unité dépend des frais du canal, pas encore connus.
- **Jamais de prix silencieux** : cotation absente, trop ancienne (14 jours) ou partagée avec une autre variante, variante incomplète, prix sous le coût → pas de prix posé d'office, l'offre va dans « À revoir » avec son motif.
- **Pas de repricing automatique** : un prix décidé (par les règles à la première tarification, ou à la main) ne bouge plus. Si la suggestion s'en écarte de plus de 20 %, l'offre revient en revue. Un prix fixé à la main est audité.
- **Plancher** : 80 % du prix cible, sans descendre sous le coût moyen (majoré d'une marge minimale pour les ventes à l'unité).
- **Recalcul** : à chaque entrée en stock, après l'import d'une série (nouvelles cotations) et à chaque changement de règles. La file « À revoir » est triée par enjeu (quantité × prix).
- Les frais de canal, le mode d'expédition et le temps passé n'entrent pas encore dans le calcul (spec 4.3) : ils dépendent du canal retenu.

## Catalogue et cotations — points d'attention

- **Variantes** : identifiants TCGdex partagés entre langues (unicité par carte). Une variante issue d'un placeholder TCGdex (`variantId: "generated"`, séries très récentes) ou déduite est marquée `incomplete` : à confirmer avant publication.
- **Cotations** : guide des prix Cardmarket relayé par TCGdex ; toutes langues et tous états confondus (`source_scope`). Reverse = champs `-holo`. Les valeurs nulles ou à 0 sont ignorées.
- **Ambiguïté** : quand plusieurs variantes partagent un produit Cardmarket (ex. Set de Base 1re édition / sans ombre), leurs cotations sont `variant_ambiguous` et ne doivent pas servir à publier sans revue.
- **Identification** : revue humaine obligatoire si score < 0,95, si deux candidats sont proches ou si le nom n'a pas été lu. Le choix de la variante est toujours confirmé par l'opérateur.
- **Scan** : Claude transcrit seulement (nom, numéro, code d'extension, langue, indices de finition) ; le rapprochement avec le catalogue reste déterministe. Champ illisible → ignoré ; lisibilité partielle, note du modèle ou langue indéterminée → revue. Repli serveur activé (`fallbacks: "default"`) si le modèle décline une requête.
- **Droits** : les conditions de réutilisation des données TCGdex et du guide des prix Cardmarket restent à vérifier (spec §11, Sprint 0) avant usage commercial.
