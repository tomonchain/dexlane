# Dexlane — règles de travail

Le README décrit l'application ; ce fichier dit comment y travailler.

## Tout passe par une issue GitHub

- Chaque changement part d'une issue de `tomonchain/dexlane`. Pas d'issue : en créer une avant de coder (modèles
  « Bug » et « Tâche »), avec l'étiquette du domaine (`go-live`, `billing`, `infra`, `legal`, `security`, `seo-geo`, `bug`).
- Les suivis d'ensemble sont les issues chapeau : #44 (go-live, v1.0) et #55 (SEO / GEO). Une nouvelle issue de ces
  domaines y est rattachée comme sous-issue.
- Le commit qui termine une issue la ferme : `Closes #n` dans son message. Un commit partiel la cite (`#n`) sans la fermer.
- Ce qui reste à faire, une idée ou un bug vu en passant : une issue, pas un TODO dans le code ni une liste dans le README.

## Livraison

- On travaille sur une branche `claude/**`. Un push y lance la CI (types, tests, parcours navigateur) sur le résultat
  fusionné avec `main` ; verte, elle fusionne dans `main` et Vercel déploie la production. Étiquette `hold` sur la pull
  request pour retenir une livraison.
- Les migrations (`infra/migrations`) s'appliquent au déploiement de production : jamais modifier une migration déjà
  appliquée, en ajouter une nouvelle. Préversions et production partagent la base tant que #51 n'est pas fait.

## Versions

- Chaque changement visible ajoute une ligne sous « Non publié » dans `CHANGELOG.md` (Ajouté, Modifié, Corrigé, Retiré),
  avec le numéro de l'issue.
- Publier une version : section `## [x.y.z] — date` dans le CHANGELOG et même version dans le `package.json` racine.
  La CI crée l'étiquette `vx.y.z` et la release GitHub une fois sur `main`. Versionnage sémantique ; 1.0.0 = lancement
  public avec la facturation.

## Code

- Textes de l'interface en français dans `t()`, traduction anglaise dans `apps/web/lib/i18n/en` (vérifié par
  `pnpm --filter @dexlane/web test`).
- Avant de pousser : `pnpm typecheck` et `pnpm test` (base de test : `TEST_DATABASE_URL`).
- `apps/web/AGENTS.md` : la version de Next.js utilisée a ses propres conventions, lire sa doc locale.
