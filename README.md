# dexlane — Pokémon Trading OS

Application personnelle de négoce de cartes Pokémon. Spécification : [`specs-pokemon-trading-automation.md`](specs-pokemon-trading-automation.md) (v1.1).

## État

**Sprint 1** : côté serveur terminé (catalogue, scan, stock, entrée en stock, recherche, API HTTP). Reste l'interface (`apps/web`).

| Package | Contenu |
|---|---|
| `infra/migrations` | Schéma PostgreSQL complet (spec §7), contraintes d'intégrité, journal append-only, outbox |
| `packages/db` | Connexion postgres.js, helper de transaction, migrations |
| `packages/shared` | Erreurs métier, montants en centimes |
| `packages/catalog` | Synchronisation TCGdex (séries, cartes, variantes détaillées, cotations Cardmarket datées), recherche des 3 meilleurs candidats à partir d'une lecture OCR |
| `packages/scan` | Lecture de carte par Claude (vision + sortie structurée, repli serveur), identification photo → candidats catalogue, banc d'essai précision/coût |
| `packages/inventory` | Entrée d'une carte identifiée (offre et SKU attribués automatiquement), lots de vrac et extraction, emplacements hiérarchiques, lots d'acquisition, déplacement, correction d'inventaire auditée, recherche, import idempotent de commandes, allocation commande → positions, survente (Parcours F), picking par scan, emballage, confirmation de dépôt |
| `apps/api` | API HTTP (Hono) : scan, recherche catalogue, emplacements, entrée en stock, vrac, inventaire. Jeton propriétaire, validation stricte, clés d'idempotence |

Pas encore commencés : `apps/web`, `apps/worker`, pricing, connecteurs marketplaces, fulfillment PDF.

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
| `GET` / `POST /api/locations` | Emplacements (`BOX-03/ROW-12/SLOT-04` crée aussi ses parents) |
| `GET` / `POST /api/acquisition-lots` | Lots d'acquisition (provenance, coût) |
| `POST /api/inventory/receive` | Entrée d'une carte confirmée : variante, état, quantité, emplacement, coût |
| `POST /api/inventory/bulk` | Entrée d'un lot de vrac en une position |
| `POST /api/inventory/{id}/extract` | Sortie de cartes identifiées d'un lot de vrac |
| `GET /api/inventory?q=&set=&language=&condition=&kind=&lifecycle=&location=` | Recherche paginée |
| `GET /api/inventory/{id ou unit_sku}` | Fiche d'une position et historique des mouvements |
| `POST /api/inventory/{id}/move` · `/adjust` · `/activate` | Déplacement, correction après comptage (motif obligatoire), validation d'un brouillon |

Toutes les routes sauf `GET /api/health` exigent `Authorization: Bearer <DEXLANE_API_TOKEN>`. Les créations et corrections (`receive`, `bulk`, `extract`, `adjust`, `acquisition-lots`) exigent un en-tête `Idempotency-Key` : la clé est écrite dans la même transaction que la mutation, donc une requête rejouée (double appui, réseau mobile) renvoie la réponse d'origine avec `Idempotent-Replay: true` sans rien créer en double. Erreurs : `{ "error": { "code", "message", "details" } }` — 400 format, 404 introuvable, 409 état incompatible, 422 règle métier.

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

## Catalogue et cotations — points d'attention

- **Variantes** : identifiants TCGdex partagés entre langues (unicité par carte). Une variante issue d'un placeholder TCGdex (`variantId: "generated"`, séries très récentes) ou déduite est marquée `incomplete` : à confirmer avant publication.
- **Cotations** : guide des prix Cardmarket relayé par TCGdex ; toutes langues et tous états confondus (`source_scope`). Reverse = champs `-holo`. Les valeurs nulles ou à 0 sont ignorées.
- **Ambiguïté** : quand plusieurs variantes partagent un produit Cardmarket (ex. Set de Base 1re édition / sans ombre), leurs cotations sont `variant_ambiguous` et ne doivent pas servir à publier sans revue.
- **Identification** : revue humaine obligatoire si score < 0,95, si deux candidats sont proches ou si le nom n'a pas été lu. Le choix de la variante est toujours confirmé par l'opérateur.
- **Scan** : Claude transcrit seulement (nom, numéro, code d'extension, langue, indices de finition) ; le rapprochement avec le catalogue reste déterministe. Champ illisible → ignoré ; lisibilité partielle, note du modèle ou langue indéterminée → revue. Repli serveur activé (`fallbacks: "default"`) si le modèle décline une requête.
- **Droits** : les conditions de réutilisation des données TCGdex et du guide des prix Cardmarket restent à vérifier (spec §11, Sprint 0) avant usage commercial.
