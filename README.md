# dexlane — Pokémon Trading OS

Application personnelle de négoce de cartes Pokémon. Spécification : [`specs-pokemon-trading-automation.md`](specs-pokemon-trading-automation.md) (v1.1).

## État

**Sprint 1** en cours : modèle de stock, cœur transactionnel, catalogue.

| Package | Contenu |
|---|---|
| `infra/migrations` | Schéma PostgreSQL complet (spec §7), contraintes d'intégrité, journal append-only, outbox |
| `packages/db` | Connexion postgres.js, helper de transaction, migrations |
| `packages/shared` | Erreurs métier, montants en centimes |
| `packages/catalog` | Synchronisation TCGdex (séries, cartes, variantes détaillées, cotations Cardmarket datées), recherche des 3 meilleurs candidats à partir d'une lecture OCR |
| `packages/inventory` | Entrée en stock, déplacement, extraction du vrac, import idempotent de commandes, allocation commande → positions, survente (Parcours F), picking par scan, emballage, confirmation de dépôt |

Pas encore commencés : `apps/web`, `apps/api`, `apps/worker`, reconnaissance d'image (OCR/vision), pricing, connecteurs marketplaces, fulfillment PDF.

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

Les tests tournent contre un vrai PostgreSQL : la base de test de chaque package (`dexlane_<package>_test`) est créée si besoin puis **vidée** à chaque test. Par sécurité, le nom de base doit se terminer par `_test`.

## Garanties anti-double-vente

1. **Base** : `CHECK (reserved + inspection + quarantine <= on_hand)` sur chaque position — aucun chemin de code ne peut rendre le disponible négatif.
2. **Application** : allocation sous `SELECT … FOR UPDATE` des positions de l'offre, verrouillées dans un ordre stable.
3. **Idempotence** : unicité `(channel, external_id)` des commandes ; allocation d'une ligne déjà allouée = no-op.
4. **Survente** : commande marquée `oversold`, offre mise en pause, incident ouvert, événement urgent dans l'outbox.

Les compteurs de stock sont une projection du journal `inventory_movements` (append-only) ; un test vérifie qu'ils restent égaux au rejeu du journal.

## Catalogue et cotations — points d'attention

- **Variantes** : identifiants TCGdex partagés entre langues (unicité par carte). Une variante issue d'un placeholder TCGdex (`variantId: "generated"`, séries très récentes) ou déduite est marquée `incomplete` : à confirmer avant publication.
- **Cotations** : guide des prix Cardmarket relayé par TCGdex ; toutes langues et tous états confondus (`source_scope`). Reverse = champs `-holo`. Les valeurs nulles ou à 0 sont ignorées.
- **Ambiguïté** : quand plusieurs variantes partagent un produit Cardmarket (ex. Set de Base 1re édition / sans ombre), leurs cotations sont `variant_ambiguous` et ne doivent pas servir à publier sans revue.
- **Identification** : revue humaine obligatoire si score < 0,95, si deux candidats sont proches ou si le nom n'a pas été lu. Le choix de la variante est toujours confirmé par l'opérateur.
- **Droits** : les conditions de réutilisation des données TCGdex et du guide des prix Cardmarket restent à vérifier (spec §11, Sprint 0) avant usage commercial.
