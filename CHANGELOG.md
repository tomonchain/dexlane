# Journal des versions

Les versions suivent le [versionnage sémantique](https://semver.org/lang/fr/) : `MAJEUR.MINEUR.CORRECTIF`.
La version de l'application est celle du `package.json` racine. Elle s'affiche en bas de Réglages.

**Publier une version** : déplacer le contenu de « Non publié » sous un nouveau titre `## [x.y.z] — AAAA-MM-JJ`,
mettre la même version dans `package.json`, puis livrer. Une fois sur `main`, la CI crée l'étiquette `vx.y.z` et la
release GitHub avec les notes de cette section.

Chaque changement livré ajoute une ligne sous « Non publié », dans la bonne rubrique (Ajouté, Modifié, Corrigé,
Retiré), avec le numéro de l'issue qu'il traite.

## [Non publié]

### Ajouté
- Fiche publique d'une carte : cartes précédente et suivante illustrées, « D'autres cartes de ce Pokémon » (par numéro
  de Pokédex), « Illustrées aussi par… », stade, types, PV et illustrateur, variation de la cote sur 30 jours, liens
  vers Cardmarket et eBay, visuel de la carte en image de partage (#80).
- Catalogue : numéros de Pokédex, illustrateur, PV, types et stade des cartes (migration 0036) ; les séries déjà
  importées sont reprises par la tâche horaire (#80).
- Section Guides (`/guides`) : articles en Markdown dans `apps/web/content/guides`, sommaire, données structurées,
  flux RSS, plan du site ; brouillons visibles en préversion seulement (#63).
- Guides : image de bannière (en-tête `image` et `imageAlt`), affichée en haut de l'article et en vignette dans l'index,
  et reprise comme image de partage (#77).
- Code sous licence AGPL-3.0 (`LICENSE`), mentionnée sur l'accueil et dans la doc Community ; guides de contribution
  et de sécurité, code de conduite, modèle de pull request (#73).
- Données structurées JSON-LD sur le site public : éditeur, site, application et forfaits, FAQ, fil d'Ariane et articles de doc (#57).
- `/llms.txt` et `/llms-full.txt` : le site et toute la doc en Markdown pour les moteurs génératifs (#58).
- Mesure d'audience sans cookie (Vercel Web Analytics) sur le site public et les pages d'inscription (#59).
- Pages publiques des séries et des cartes (`/series`) : liste des cartes de chaque série, cote Cardmarket par variante
  avec son évolution sur six mois, plan du site dédié et adresses canoniques (#62).

### Modifié
- En-tête du site : « Cotes » et « Guides » (dès le premier guide publié), section active mise en évidence ; menu
  repliable jusqu'à 1024 px de large (#81).
- En production, les adresses `*.vercel.app` redirigent vers `dexlane.app`, hors API, MCP et tâches planifiées (#56).
- `robots.txt` nomme les robots des moteurs génératifs et ferme `/lots` et `/join` (#58).
- Mentions légales : hébergeur renseigné ; descriptions des pages légales écrites (#48).
- Compte : le texte du mot de passe renvoie à « Mot de passe oublié ? » au lieu du jeton d'installation.

### Corrigé
- Le catalogue français complet s'importe en un à deux jours au lieu de plusieurs semaines : la tâche d'import passe
  toutes les heures (#75).
- Une carte gradée s'annonce avec sa note même quand le modèle de titre utilise `{etat_nom}` (« Near Mint ») (#68).

### Retiré
- Redirections des anciennes adresses françaises (`/reglages`, `/ventes`, `/annonces`…), utiles seulement à l'outil
  personnel d'avant les comptes (#67).
- Code mort : mode « première connexion » de l'écran de connexion, traductions orphelines, exports inutilisés,
  dépendance `postgres` de `@dexlane/inventory` (#67).

## [0.9.0] — 2026-11-26

Première version numérotée : passage de l'outil personnel au service multi-comptes, sur `dexlane.app`. Version bêta,
sans facturation (Stripe à venir avec la 1.0).

### Ajouté
- Comptes : inscription avec vérification de l'adresse e-mail (BetterAuth), données cloisonnées par compte au niveau
  de Postgres (row-level security), onboarding après l'inscription. Les données existantes forment le compte
  d'installation.
- Forfaits : quota mensuel de cartes publiées, packs, équipes et invitations, support, lots de vente, cartes gradées
  et suggestions. La facturation n'est pas encore branchée.
- Connecteur eBay réel : connexion du compte, création des règles de vente, publication, quantités et import des
  commandes.
- Site public : page d'accueil, tarifs, documentation, contact, pages légales, page d'arrivée du flyer (`/colis`),
  `robots.txt`, `sitemap.xml`, images de partage.
- Domaine `dexlane.app`.

### Déjà en production avant la numérotation
- Scan des cartes par Claude (scanner à défilement ou téléphone), identification dans le catalogue, entrée en stock
  et rangement par emplacements.
- Catalogue français complet importé peu à peu, avec les cotes Cardmarket datées.
- Prix automatiques selon une stratégie, file de revue, alertes de cote.
- Stock unifié (cartes, fournitures, journal des mouvements), fournitures avec alertes de commande.
- Annonces : modèles de texte, photos mises en scène, calendrier et planning des mises en ligne.
- Ventes directes, préparation et remise, suivi des colis (La Poste, Mondial Relay), demandes d'avis, marge.
- Statistiques des ventes et des mises en vente, notifications push.
- Serveur MCP pour les agents.

[Non publié]: https://github.com/tomonchain/dexlane/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/tomonchain/dexlane/releases/tag/v0.9.0
