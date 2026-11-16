# dexlane — Pokémon Trading OS

Application personnelle de négoce de cartes Pokémon. Spécification : [`specs-pokemon-trading-automation.md`](specs-pokemon-trading-automation.md) (v1.1).

## État

Socle du **Sprint 1** : modèle de stock et cœur transactionnel.

| Package | Contenu |
|---|---|
| `infra/migrations` | Schéma PostgreSQL complet (spec §7), contraintes d'intégrité, journal append-only, outbox |
| `packages/db` | Connexion postgres.js, helper de transaction, migrations |
| `packages/shared` | Erreurs métier, montants en centimes |
| `packages/inventory` | Entrée en stock, déplacement, extraction du vrac, import idempotent de commandes, allocation commande → positions, survente (Parcours F), picking par scan, emballage, confirmation de dépôt |

Pas encore commencés : `apps/web`, `apps/api`, `apps/worker`, catalogue/scan, pricing, connecteurs marketplaces, fulfillment PDF.

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

Les tests tournent contre un vrai PostgreSQL : la base de test est créée si besoin puis **vidée** à chaque test. Par sécurité, son nom doit se terminer par `_test`.

## Garanties anti-double-vente

1. **Base** : `CHECK (reserved + inspection + quarantine <= on_hand)` sur chaque position — aucun chemin de code ne peut rendre le disponible négatif.
2. **Application** : allocation sous `SELECT … FOR UPDATE` des positions de l'offre, verrouillées dans un ordre stable.
3. **Idempotence** : unicité `(channel, external_id)` des commandes ; allocation d'une ligne déjà allouée = no-op.
4. **Survente** : commande marquée `oversold`, offre mise en pause, incident ouvert, événement urgent dans l'outbox.

Les compteurs de stock sont une projection du journal `inventory_movements` (append-only) ; un test vérifie qu'ils restent égaux au rejeu du journal.
