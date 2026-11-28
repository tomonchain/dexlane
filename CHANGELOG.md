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
- Accord de contribution (`CLA.md`) : chaque auteur extérieur l'accepte une fois, sur sa première pull request, auprès
  du robot « Accord de contribution » ; les signatures sont gardées dans la branche `cla-signatures` (#106).
- Frais eBay : relus à chaque synchronisation et déduits de la marge (statistiques, vente, 30 derniers jours) ; la
  mention « Frais eBay non inclus » ne reste que pour les ventes dont les frais ne sont pas encore connus (migration 0041) (#95).
- Remboursements : une vente remise se rembourse (bouton « Rembourser ») ; un remboursement complet ou une annulation
  faits sur eBay sont repris à la synchronisation. Une vente remboursée ne compte plus (#96).
- Fuseau horaire choisi dans Compte (celui de l'appareil est proposé) ; celui du propriétaire sert à la régularité et aux
  récaps (#98).
- Statistiques : onglet « Résumé » par défaut, avec sélecteur de période (ce mois-ci, mois dernier, 90 jours,
  12 mois), chiffre d'affaires par devise, marge et sa couverture, cartes vendues, taux d'écoulement, délai médian de
  vente, temps gagné estimé, ventes par semaine et 10 meilleures ventes, dans le fuseau de l'utilisateur ; journal
  d'événements par compte (`account_events`, migration 0039) (#83).
- Cartes dormantes (en ligne depuis plus de 90 jours sans vente) : baisse de prix avec aperçu puis confirmation,
  regroupement en lot, retrait de la vente ; rappel sur l'accueil à partir de 10 cartes (#83).
- Parcours de démarrage : sept étapes détectées d'après les données, « Compte configuré à x % » sur l'accueil (masquable),
  page Démarrage dans le compte (#84).
- Récaps mensuels et annuels (`/recap`), générés par la tâche quotidienne et annoncés par un e-mail désactivable ;
  image à partager (publication ou story) générée sur le serveur, sans montant par défaut (#85).
- Niveau de la boutique d'après les ventes confirmées, succès, avantages de niveau, page Progression, notification
  groupée des succès, réglage « Afficher le niveau et les succès » ; attribution rétroactive au lancement (#86).
- Progression : carte vendeur dont le cadre change de matière à chaque niveau (Carton, Bois, Pierre, Fer, Bronze,
  Argent, Or, Platine, Diamant, Légende) ; les 14 succès deviennent des cartes numérotées, avec leur rareté, rangées
  dans un classeur (#92).
- Quota de scans : chaque photo lue par Claude compte, avec un plafond mensuel par forfait (50, 300, 1 500, 6 000 ;
  un pack ajoute 500 scans), 60 scans par minute au plus et le coût estimé noté par scan (migration 0038). Jauge dans
  Réglages › Forfait, plafonds sur `/tarifs` et dans la doc ; dans un lot, la carte hors quota reste à identifier à la
  main. Le compte d'installation n'a pas de plafond mensuel, mais reste soumis à la limite par minute (#50).
- Compte › Vos données : téléchargement de toutes ses données en JSON (sans mots de passe ni jetons) et suppression du
  compte, confirmée par le mot de passe et le mot « SUPPRIMER » ; un membre d'équipe ne supprime que son accès. Les
  journaux en ajout seul ne s'effacent qu'avec leur compte (migration 0037) (#49).
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
- Inscriptions sur invitation par défaut : une installation sert une boutique ; seules les personnes invitées dans
  l'équipe créent leur compte, et `/signup` le dit. La liste d'attente et son écran de Réglages quittent ce dépôt pour
  l'édition hébergée, qui branche ses propres routes par `apps/api/src/edition.ts` (#116).
- Inscriptions fermées tant que les e-mails et le paiement ne sont pas branchés : `/signup` devient une liste d'attente,
  les boutons du site y mènent, et l'API refuse les nouveaux comptes sauf invitation d'équipe ; `DEXLANE_SIGNUP=open`
  les rouvre. Liste visible des administrateurs dans Réglages (migration 0042) (#103).
- L'application tutoie partout, comme le site, les e-mails et les nouveaux écrans (#93).
- Niveau 1 : il s'obtient en terminant la configuration du compte, plus à la première vente ; une carte n'est rangée
  qu'à un emplacement précis (sans sous-emplacement) ; l'e-mail du récap est coupé pour le moment (migration 0040) (#92).
- Les commandes eBay gardent le pays de livraison (#86).
- En-tête du site : « Cotes » et « Guides » (dès le premier guide publié), section active mise en évidence ; menu
  repliable jusqu'à 1024 px de large (#81).
- En production, les adresses `*.vercel.app` redirigent vers `dexlane.app`, hors API, MCP et tâches planifiées (#56).
- `robots.txt` nomme les robots des moteurs génératifs et ferme `/lots` et `/join` (#58).
- Mentions légales : hébergeur renseigné ; descriptions des pages légales écrites (#48).
- Compte : le texte du mot de passe renvoie à « Mot de passe oublié ? » au lieu du jeton d'installation.

### Corrigé
- Invitation dans une équipe sans compte : la connexion propose de créer son compte, la vérification de l'adresse ramène
  à l'invitation, et l'assistant de démarrage ne s'ouvre plus par-dessus (#116).
- Photos d'une fiche : après une action, les boutons attendent que la fiche soit relue ; un clic ne vise plus une photo
  déjà remplacée (#110).
- Les liens « Voir les variations » (accueil, alertes de prix) ouvrent bien l'onglet Stock et cotes des statistiques (#83).
- Quota de scans : une lecture refusée par le modèle compte bien (elle est payée), des scans envoyés en même temps ne
  dépassent plus le plafond, et un scan refusé ne stocke plus sa photo (#89).
- Le catalogue français complet s'importe en un à deux jours au lieu de plusieurs semaines : la tâche d'import passe
  toutes les heures (#75).
- Une carte gradée s'annonce avec sa note même quand le modèle de titre utilise `{etat_nom}` (« Near Mint ») (#68).

### Retiré
- Redirections des anciennes adresses françaises (`/reglages`, `/ventes`, `/annonces`…), utiles seulement à l'outil
  personnel d'avant les comptes (#67).
- Code mort : mode « première connexion » de l'écran de connexion, traductions orphelines, exports inutilisés,
  dépendance `postgres` de `@dexlane/inventory` (#67).
- Le site public (landing, tarifs, docs, guides, séries et cotes publiques, colis, contact, pages légales, `llms.txt`,
  plan du site) quitte ce dépôt pour celui de l'édition hébergée. Une installation sert sa boutique : sans session,
  `/` mène à la connexion et `robots.txt` ferme l'instance ; ce que l'édition hébergée ajoute se règle dans
  `config/edition.ts` (#105).

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
