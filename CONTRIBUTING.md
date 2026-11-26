# Contribuer à Dexlane

Merci de ton intérêt ! Dexlane est un outil open source (licence [AGPL-3.0](LICENSE)) pour les vendeurs de cartes
Pokémon : scan, stock, prix, publication eBay, ventes et envois. Ce guide dit comment proposer un changement.

## Tout part d'une issue

- **Un bug** : ouvre une issue avec le modèle « Bug » (ce qui se passe, ce qui était attendu, la version affichée en
  bas de Réglages).
- **Une idée, une amélioration** : ouvre une issue avec le modèle « Tâche », avant d'écrire du code. On se met d'accord
  sur le besoin et l'approche, et personne ne travaille pour rien.
- **Une faille de sécurité** : jamais en issue publique. Voir [SECURITY.md](SECURITY.md).
- Les grands chantiers sont suivis dans deux issues chapeau : le lancement de la 1.0 (#44) et le référencement (#55).

## Installer le projet

Prérequis : Node 22 ou plus, pnpm 11, PostgreSQL 15 ou plus (ou `docker compose -f infra/docker/compose.yml up -d`).

```sh
pnpm install
cp .env.example .env          # adapter DATABASE_URL et DEXLANE_API_TOKEN
pnpm db:migrate
pnpm api                      # dans un terminal
pnpm web                      # dans un autre : http://localhost:3000
```

Le [README](README.md) décrit l'application en détail, écran par écran.

## Proposer une pull request

1. Forke le dépôt et crée une branche depuis `main`.
2. Fais un changement par pull request, lié à son issue : `Closes #n` dans la description.
3. Avant de pousser :
   ```sh
   pnpm typecheck
   pnpm test                    # TEST_DATABASE_URL : une base jetable, recréée à chaque fichier de test
   pnpm e2e                     # parcours navigateur, si tu touches à l'interface
   ```
4. Ajoute une ligne sous « Non publié » dans [CHANGELOG.md](CHANGELOG.md) pour tout changement visible.
5. La CI vérifie la pull request (types, tests, parcours navigateur). Une personne du projet la relit, puis la fusionne.

## Conventions

- **Langue** : l'interface, les commentaires, les messages de commit et les issues sont en français. L'interface est
  traduite en anglais : tout texte affiché passe par `t()`, avec sa traduction dans `apps/web/lib/i18n/en`. La
  vérification fait partie de `pnpm test`.
- **Base de données** : on n'édite jamais une migration déjà livrée (`infra/migrations`), on en ajoute une nouvelle.
  Les données d'un vendeur sont cloisonnées par Postgres (row-level security) : une requête qui lit une table de
  compte en dehors de la portée d'un compte est un bug.
- **Argent** : en centimes entiers, jamais en nombres à virgule.
- **Tests** : un bug corrigé arrive avec le test qui l'aurait attrapé.

## Licence des contributions

En proposant une contribution, tu acceptes qu'elle soit publiée sous la licence du projet,
[AGPL-3.0](LICENSE).

## Code de conduite

Ce projet suit un [code de conduite](CODE_OF_CONDUCT.md) : sois respectueux et bienveillant.
