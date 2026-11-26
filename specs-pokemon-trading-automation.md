> **Document historique.** Spécification de l'outil personnel d'origine (v1.1). Dexlane est depuis devenu un service
> multi-comptes avec forfaits (voir le README et le CHANGELOG) : les exclusions « SaaS » et « monétisation » ci-dessous
> ne s'appliquent plus. Le document reste la référence des parcours (« Parcours F », « spec §x ») cités dans le code.

# Spécifications produit et techniques — Pokémon Trading OS

**Version :** 1.1 — 16 novembre 2026  
**Statut :** spécification révisée (modèle de stock, survente, expédition, mesure du temps), à valider par un prototype  
**Cible :** application personnelle de négoce de cartes Pokémon, extensible à d'autres TCG  
**Langue :** français, devise de référence EUR, fuseau Europe/Paris  
**Priorité :** simplicité opérationnelle, fiabilité du stock, rentabilité réelle

## 1. Vision

Construire une application web mobile-first qui automatise le cycle de vente de cartes à collectionner :

**Scanner → identifier → stocker → classer → valoriser → publier → vendre → préparer → expédier → déstocker.**

Une V2 ajoutera un **Buy Engine** : collecte de prix autorisée, détection de sous-évaluations, simulation de marge et validation d'achats.

### Objectifs métier

- Gérer initialement **3 000 à 10 000 cartes**, surtout issues de boosters, avec beaucoup de communes.
- Limiter l'exploitation récurrente à **60 minutes de travail humain par jour maximum**, hors phase initiale d'inventaire, événements exceptionnels et développement logiciel.
- Éviter de cataloguer individuellement les cartes sans valeur économique suffisante.
- Vendre sur plusieurs plateformes **sans double vente** ; la base interne est la source de vérité.
- Tracer acquisition, marge, emplacement, commandes, expéditions et sortie de stock.
- Préparer chaque matin les documents des commandes à traiter ; limiter les clics et les erreurs.
- Permettre à terme une exploitation autonome, avec validations humaines sur les décisions risquées.

### Indicateurs de succès (pilote)

- 500 cartes représentatives passées dans le flux de scan et de tri.
- ≥ 98 % d'identifications exactes **après validation opérateur** ; mesurer séparément la précision automatique.
- 100 % des cartes publiées avec SKU et emplacement physique connus.
- 0 double vente sur 100 commandes de test, y compris tests de concurrence et synchronisation dégradée.
- ≥ 95 % des commandes payées préparables sans correction administrative manuelle.
- Sur un volume réaliste, temps médian de préparation et de traitement quotidien < 60 min ; mesurer séparément l'expédition physique.
- Coûts, marges et temps réel visibles par vente et par plateforme.

## 2. Périmètre et principes

### MVP / V1 — Sell Engine

**Inclus :**

1. Catalogue Pokémon et identification assistée par photo.
2. Inventaire, lots, états, quantités, emplacements et historique.
3. Classification automatique entre vrac, vente en lot, vente individuelle et revue humaine.
4. Référentiel de prix, prix cible et garde-fous de rentabilité.
5. Publication via au moins **une marketplace disposant d'une API vendeur autorisée** ; eBay et/ou CardTrader selon l'accès effectif.
6. Import des commandes et réservation immédiate du stock.
7. Génération des listes de préparation et des documents d'expédition.
8. Confirmation de la remise au transporteur, suivi et décrémentation du stock physique.
9. Dashboard, file d'erreurs, rapprochement et rapports quotidiens.

**Exclus du MVP :** achats automatiques, enchères autonomes, scraping non autorisé, ventes sur des plateformes sans intégration contractuellement permise, reconnaissance parfaite de l'état à partir d'une seule photo, grading PSA/BGS, comptabilité complète, logiciel multi-utilisateurs SaaS, automatisation d'une boutique physique.

### V2 — Buy Engine

- Collecter régulièrement les cotations et offres d'achat disponibles via sources autorisées.
- Estimer prix de revente, marge nette, rotation et risque.
- Identifier, classer et notifier les opportunités.
- Préparer une décision d'achat **soumise à confirmation humaine**.
- Enregistrer les acquisitions et alimenter automatiquement l'inventaire à réception.

### Principes non négociables

- **Stock d'abord :** aucune publication sans quantité disponible et emplacement connu pour une carte à l'unité.
- **Pas de vente fantôme :** réservation atomique à la commande, synchronisation multicanale, alerte en cas d'échec.
- **Pas de prix inventés :** chaque donnée de prix conserve sa source, son horodatage, la devise, le type de prix et la variante.
- **IA contrôlable :** score de confiance, validation manuelle des identifications incertaines et de l'état.
- **Pas d'actions opaques :** chaque modification importante est auditée et réversible par événement compensatoire.
- **API officielles ou permissions explicites :** pas de contournement de restrictions de plateformes.
- **Architecture modulaire :** ne pas coupler le cœur métier à une marketplace.

## 3. Utilisateurs et parcours

### Rôles

- **Owner/Admin (MVP) :** propriétaire du stock, valide les cartes ambiguës, supervise les commandes et autorise les achats.
- **Opérateur (post-MVP) :** peut scanner, ranger, préparer et expédier sans accéder aux finances ni aux achats.
- **Agent logiciel :** propose et exécute des tâches autorisées avec permissions limitées et journal d'audit.

### Parcours A — Importer une carte à valeur potentielle

1. L'utilisateur ouvre l'écran **Scanner** et capture recto ; verso facultatif ou exigé pour évaluer l'état.
2. Le moteur détecte les contours, lit le nom et le numéro/extension si visibles, puis génère des candidats du catalogue.
3. L'utilisateur confirme la bonne impression : extension, numéro, langue, variante holo/reverse/non holo/promo, édition et état.
4. Le moteur propose un prix de référence, une catégorie de vente et une quantité.
5. L'utilisateur assigne un emplacement (`BOX-03/ROW-12/SLOT-04`) et confirme l'entrée de stock.
6. Si la carte remplit les critères, l'application propose la publication ; sinon elle reste en stock ou en lot.

### Parcours B — Traitement rapide du vrac

1. L'utilisateur sélectionne **Mode vrac**.
2. Il compte ou pèse un lot après calibration, puis indique extension/époque et type (communes, peu communes, holos, énergies, etc.).
3. Le système enregistre **un lot agrégé**, quantité et emplacement, sans prétendre connaître l'identité individuelle des cartes.
4. Le système estime le rachat du lot à partir d'une grille actualisée et permet de créer une annonce de lot ou un bon de cession.
5. L'utilisateur peut ensuite extraire des cartes du vrac en régularisant les quantités.

### Parcours C — Publier en un clic

1. L'utilisateur sélectionne un ensemble d'articles **éligibles**.
2. L'application vérifie identité, variante, état, photos réelles si exigées, stock, localisation, coûts, prix, politiques vendeur et éligibilité du canal.
3. Elle calcule prix net attendu et frais par canal ; affiche un aperçu et les éventuels blocages.
4. Après **Publier**, chaque adaptateur crée/met à jour l'annonce et enregistre son identifiant externe.
5. Une erreur sur un canal n'annule pas silencieusement les autres : chaque canal affiche un statut distinct et une action de reprise.

### Parcours D — Commande de la veille et expédition

1. Une vente payée est reçue par webhook ou synchronisation périodique.
2. Chaque ligne de commande (qui référence une `offer_sku`) est **allouée atomiquement** à une ou plusieurs positions de stock physiques (`order_allocations`) ; disponibilité publiée ailleurs ajustée au plus vite. Si l'allocation échoue → Parcours F.
3. Un job matinal (heure configurable, ex. 07:00 Europe/Paris) regroupe les commandes payées et non expédiées.
4. Le système génère liste de picking triée par emplacement, bordereaux et étiquettes de transport lorsque les données/services requis sont disponibles.
5. Les documents sont déposés dans une **file d'impression** ; impression automatique uniquement si un service local d'impression est installé et opérationnel. Sinon téléchargement PDF groupé.
6. L'utilisateur prélève les cartes et scanne le SKU/QR ou la commande pour éviter les erreurs de colis.
7. Les allocations passent à **préparées** puis **emballées**.
8. **Confirmation de dépôt** : l'utilisateur scanne (ou coche en lot) les colis déposés à La Poste / point relais. C'est le **mode nominal** : la majorité des envois de faible valeur partent en lettre non suivie, sans scan transporteur. Le premier scan transporteur, lorsqu'il existe, ne fait que confirmer ou dater le dépôt.
9. Après confirmation, les allocations passent à **expédiées** et le stock physique est décrémenté.
10. Le numéro de suivi, s'il existe, est transmis au canal ; sinon le canal est marqué expédié sans suivi. Les échecs sont réessayés et signalés.

**Important :** le stock *vendable* est diminué dès l'allocation ; la sortie du *stock physique* n'est comptabilisée qu'à la confirmation de dépôt. Les deux notions doivent rester distinctes.

### Parcours E — Annulation et retour

- Annulation avant dépôt : libération de la réservation, nouvelle disponibilité seulement si l'article est effectivement présent.
- Retour : statut **retour en inspection** ; aucun retour automatique en stock vendable avant contrôle de l'état.
- Colis perdu / litige / remboursement : événement spécifique, traçabilité financière, stock non réintroduit par erreur.

### Parcours F — Survente (allocation impossible)

Cas : une commande arrive pour une `offer_sku` dont `available_to_sell` est déjà à 0 (vente simultanée sur deux canaux, synchronisation en retard, erreur d'inventaire).

1. La commande est importée normalement mais marquée `OVERSOLD` ; événement `StockReservationFailed`.
2. **Immédiatement** : l'`offer_sku` passe à quantité 0 sur tous les canaux (pause), alerte urgente (e-mail + dashboard).
3. Le système propose, dans l'ordre :
   1. **Substitution** par une position de stock équivalente non encore allouée (même `offer_sku`, autre emplacement) — impossible par définition si `available_to_sell = 0`, mais utile en cas de stock « en inspection » libérable ou d'écart d'inventaire corrigé par un scan ;
   2. **Vérification physique** : tâche « retrouver l'exemplaire » à l'emplacement attendu ; si trouvé, correction d'inventaire tracée puis allocation ;
   3. **Annulation** sur le canal concerné avec le motif prévu par la plateforme (rupture de stock), message type à l'acheteur, remboursement géré par le canal.
4. La décision est humaine au MVP ; délai cible : traitement le jour même.
5. Chaque survente est enregistrée (`oversell_incidents`) avec la cause identifiée, pour mesurer le critère « 0 double vente ».

**Prévention** (configurable par catégorie) :

- Exemplaires uniques `PREMIUM` : option « canal unique » — publiés sur un seul canal à la fois.
- Positions interchangeables : option de **tampon** — publier `available_to_sell − n` sur les canaux secondaires.
- Si un canal ne peut pas être synchronisé depuis plus de X minutes : mise en pause des offres partagées sur les autres canaux (ou alerte, selon configuration).

**Coût à connaître avant le Go :** pénalités d'annulation pour rupture de stock propres à chaque canal (p. ex. impact sur le niveau vendeur eBay) ; à documenter au Sprint 0.

## 4. Modules fonctionnels

### 4.1. Catalogue et reconnaissance

**Exigences :**

- Catalogue maître Pokémon multilingue (FR prioritaire), avec correspondance vers identifiants de marketplaces.
- Identification à partir de l'image + OCR du nom, numéro local et extension ; top 3 candidats et score de confiance.
- Distinction explicite entre **carte de catalogue** et **exemplaire physique** : deux cartes identiques peuvent avoir des états, coûts et emplacements différents.
- Variantes : langue, holo/reverse/non holo, version promo, édition, tampons, erreurs d'impression si documentées.
- **Langue** : propriété de l'impression. Une carte FR et sa version EN sont deux `catalog_cards` distinctes (numérotation et extension pouvant différer). La langue n'est donc jamais ressaisie au niveau du stock.
- État manuel requis pour les cartes vendues individuellement, selon une **échelle interne unique** (proposée : `MT`, `NM`, `EX`, `GD`, `LP`, `PL`, `PO`, alignée sur Cardmarket), traduite vers chaque canal par la table `condition_mappings` (voir 4.4) ; photographies du recto et verso des cartes de forte valeur.
- Si score inférieur au seuil configurable (ex. 0,95), validation obligatoire ; aucune classification erronée silencieuse.
- Mode lot/vrac ne tente pas de scanner toutes les communes.

**Données externes possibles :** TCGdex pour catalogue, variantes, visuels et certaines cotations ; vérifier licences, couverture, actualité et modalités d'usage avant production.

### 4.2. Inventaire et emplacements

#### Modèle à trois niveaux

| Niveau | Entité | Rôle | Exemple |
|---|---|---|---|
| Ce qui existe | `catalog_cards` / `card_variants` | Impression de référence | Dracaufeu 4/102, FR, holo, 1re éd. |
| Ce qu'on vend | `offers` (`offer_sku`) | Unité **vendable et publiable** : variante + état (+ exemplaire précis si unique) | `OF-BS1-004-FR-H1-NM` |
| Ce qu'on possède | `stock_items` (`unit_sku`) | **Position physique** homogène : même offre, même emplacement, même lot d'acquisition, même coût unitaire | `SI-000123` en `BOX-03/ROW-12/SLOT-04`, qté 3 |

- **`offer_sku`** : identifiant envoyé aux marketplaces (p. ex. SKU d'inventaire eBay). Une offre agrège une ou plusieurs positions de stock.
- **`unit_sku`** : identifiant immuable imprimé en QR sur l'étui/la position ; c'est ce qu'on scanne au picking.
- **Types de positions** (`stock_items.kind`) :
  - `UNIQUE` : un exemplaire individualisé (forte valeur, photos réelles) ; `on_hand ∈ {0,1}` ; son offre ne référence qu'elle.
  - `FUNGIBLE` : N exemplaires interchangeables d'une même variante et d'un même état ; photos de catalogue acceptées si le canal l'autorise.
  - `BULK` : lot agrégé sans identité individuelle ; référence un `bulk_descriptor` (extension/époque, type, rareté) au lieu d'une variante. Les lots de vrac sont donc des positions de stock comme les autres et passent par le même journal de mouvements.
- **Extraction depuis le vrac** : mouvement `BULK_EXTRACT` (−n sur la position `BULK`) couplé à un `RECEIVE` (+1 sur une nouvelle position `UNIQUE`/`FUNGIBLE`) dans la même transaction ; le coût unitaire est réalloué depuis le lot.

#### Quantités

Les états ne sont **pas** portés par la position de stock (une position de 4 cartes peut en avoir 1 réservée et 3 disponibles). Ils sont portés par :

- les **compteurs** de la position : `on_hand` (physiquement présent), `inspection` (retour en contrôle, non vendable), `quarantine` (introuvable, litige, doute) ;
- les **allocations** de commande (`order_allocations.status` : `RESERVED`, `PICKED`, `PACKED`, `SHIPPED`, `RELEASED`).

```text
reserved          = Σ allocations RESERVED|PICKED|PACKED de la position
available_to_sell = on_hand − inspection − quarantine − reserved      (jamais < 0)
offre.available   = Σ available_to_sell des positions de l'offre
```

- `stock_items.lifecycle` se limite à : `DRAFT` (non validé, non publiable), `ACTIVE`, `ARCHIVED` (épuisée/sortie).
- Les sorties définitives sont des mouvements typés : `SHIP_OUT`, `LOST`, `DISPOSED`, `BULK_SOLD`.

#### Mouvements et emplacements

- Hiérarchie d'emplacement : pièce → meuble → boîte → rangée → position.
- Mouvements append-only : `RECEIVE`, `MOVE`, `ALLOCATE`, `RELEASE`, `PICK`, `SHIP_OUT`, `RETURN_IN`, `INSPECT_OK`, `INSPECT_KO`, `QUARANTINE`, `BULK_EXTRACT`, `ADJUST`, `LOST`, `DISPOSED`. Les compteurs de `stock_items` sont une projection de ces mouvements, mise à jour dans la même transaction.
- Réconciliation par scan physique et inventaire tournant ; journal de différences.
- Liaison des acquisitions à la provenance, au coût unitaire alloué et au lot initial.

#### Allocation commande → stock

- Une ligne de commande référence une `offer_sku`, jamais directement une position.
- À l'import, l'allocation choisit les positions selon une stratégie configurable : par défaut **minimiser le nombre d'emplacements à visiter**, puis FIFO sur la date d'acquisition.
- L'allocation est réalisée sous verrou (`SELECT … FOR UPDATE` sur les positions de l'offre) ; elle réussit entièrement ou pas du tout pour une ligne.
- Au picking, le scan d'un `unit_sku` d'une **autre position de la même offre** est accepté et réaffecte l'allocation (permet de prendre la carte la plus accessible) ; le scan d'une autre offre est refusé.

### 4.3. Catégorisation et pricing

- Moteur de règles configurable, pas une décision opaque du LLM.
- Exemple initial de catégories : `BULK`, `LOT`, `SINGLE`, `PREMIUM`, `REVIEW`.
- Le seuil de vente individuelle n'est **pas un montant fixe** : il est calculé **par canal** comme le prix minimal pour lequel

  ```text
  marge_contributive(prix, canal, mode_expédition) ≥ marge_plancher + temps_unitaire × taux_horaire_cible
  ```

  avec les frais du canal, le mode d'expédition retenu (voir 4.5), l'emballage et le temps humain mesuré (voir 4.6). Une carte n'est `SINGLE` que si au moins un canal dépasse ce seuil.
- Seuils **indicatifs de départ**, à remplacer après le Sprint 0 par le calcul ci-dessus :
  - < 1 € : vrac ;
  - 1–5 € : lot ou rachat ;
  - 5–15 € : zone grise — probablement non rentable à l'unité sur un canal à commission élevée avec envoi suivi ; rentabilité à démontrer par canal ;
  - ≥ 15 € : vente individuelle prioritaire ;
  - ≥ 100 € : `PREMIUM` — exemplaire `UNIQUE`, photos/validation renforcées et expédition suivie/assurée.
- Prix recommandé = fonction des références disponibles **comparables** (édition, langue, état, variante), du coût d'acquisition et des frais effectifs du canal.
- Garde-fous : prix plancher, marge contributive plancher, écart maximum à la référence, prix non publiable si donnée absente ou trop ancienne.
- Afficher séparément **prix affiché**, **prix réellement vendu** (quand disponible) et **prix estimé** ; ne jamais assimiler une annonce active à une transaction conclue.
- Repricing automatique désactivé au MVP ; revue des prix dans une file priorisée.

### 4.4. Connecteurs marketplaces

Interface commune `MarketplaceAdapter` :

- `validateListing(item, channel)`
- `createOrUpdateListing(item, price, quantity)`
- `pauseOrEndListing(externalId)`
- `setAvailableQuantity(externalId, qty)`
- `pullOrders(cursor)` et/ou `handleWebhook(event)`
- `acknowledgeShipment(order, tracking)`
- `getFees(context)` si supporté, sinon barème configuré et daté
- `healthCheck()`

**Stratégie initiale :**

- **eBay :** publication via Sell Inventory API, synchronisation via Fulfillment API ; OAuth et politiques vendeur prérequises.
- **CardTrader :** étudier et tester son API documentée d'achat/vente, ses droits et les conditions commerciales avant de choisir le premier canal.
- **Cardmarket :** importer des données de prix/catalogue publiées officiellement selon leurs conditions ; ne pas compter sur une API de publication pour un nouveau compte, les candidatures à l'API étant fermées.
- **Vinted et autres :** pas d'automatisation non autorisée ; prévoir un export manuel/import CSV uniquement si conforme aux conditions applicables.

Chaque annonce porte sur une **offre** (`offer_sku`), pas sur une position de stock, et conserve `channel`, `external_listing_id`, `status`, `price`, `quantity_sent`, `quantity_confirmed`, `sync_at`, `error_code`. La quantité publiée est `offre.available` moins l'éventuel tampon du canal (voir Parcours F).

**Correspondance des états** : table `condition_mappings (channel, internal_condition, external_code, external_label, valid_from)`. Les échelles diffèrent selon les plateformes (p. ex. Cardmarket NM/EX/GD/LP/PL/PO ; eBay utilise ses propres descripteurs d'état pour les cartes non gradées, moins nombreux). Règles :

- un état interne sans correspondance sur un canal bloque la publication sur ce canal (`validateListing`) ;
- lorsque deux états internes tombent dans la même catégorie externe, on publie la catégorie **la plus prudente** ;
- la table est versionnée et vérifiée contre la documentation de chaque API au Sprint 0.

### 4.5. Commandes, documents et expéditions

- Déduplication par `(channel, external_order_id)`.
- Import uniquement des commandes dont l'état et le paiement autorisent la préparation.
- Prise en charge de commandes multi-lignes et multi-colis.
- Tableau **À préparer aujourd'hui** trié selon échéance d'expédition puis emplacement.
- **Modes d'expédition** (configurables, choisis par règle selon valeur de commande et service payé par l'acheteur) :

  | Mode | Usage indicatif | Suivi | Confirmation de dépôt | Documents |
  |---|---|---|---|---|
  | `LETTER_UNTRACKED` | Faible valeur (seuil configurable, p. ex. < 20 €) | Non | Scan manuel au dépôt | Adresse imprimée + timbre/affranchissement |
  | `LETTER_TRACKED` | Valeur intermédiaire | Oui | Scan manuel, confirmé par le transporteur | Étiquette ou numéro à saisir |
  | `PARCEL_TRACKED` | Forte valeur / multi-cartes | Oui, assurance si requise | Scan manuel, confirmé par le transporteur | Étiquette agrégateur |

- Règle de sécurité : en envoi non suivi, un litige « non reçu » est en pratique perdu ; le seuil `LETTER_UNTRACKED` doit rester sous la perte acceptable et respecter les exigences de suivi de chaque canal.
- Étiquettes via intégration transporteur/agrégateur (p. ex. Sendcloud) **pour les modes suivis** ; vérifier au Sprint 0 quels modes (notamment lettres) chaque fournisseur couvre réellement. Pour les lettres non suivies, génération locale d'étiquettes d'adresse (planche A4 ou A6).
- Vérifier tarif et service choisi par l'acheteur.
- Bon de picking (SKU, miniature, emplacement, quantité, identifiant commande, QR).
- Bon de livraison et facture **uniquement si nécessaire et conforme aux obligations applicables** ; ne pas créer de justificatifs contradictoires avec ceux de la marketplace ou du logiciel comptable.
- Impression A6 (étiquette), A4 (documents) ; **print agent local** ou PDF de secours.
- Réédition contrôlée et historisation des PDF ; pas de double achat d'étiquette lors d'un retry.
- Tracking, statut de dépôt, litiges, retours et remboursements.

### 4.6. Dashboard et automatisations

- Cartes à identifier, à valider, à publier ; annonces actives et erreurs de synchro.
- Commandes à préparer, en retard, en litige, en retour.
- CA, frais par canal, coût d'achat, marge contributive, coûts d'expédition, bénéfice estimé, trésorerie immobilisée.
- Volume vendu, délai moyen de vente, temps par opération, rendement €/heure.
- **Mesure du temps humain** (indispensable au critère des 60 min/jour) :
  - chaque écran opérationnel (scan, rangement, publication, picking, emballage, dépôt, revue des prix, traitement des exceptions) ouvre automatiquement une **session de travail** (`work_sessions`) : activité, début, fin, nombre d'éléments traités ;
  - fermeture automatique après inactivité (p. ex. 3 min, temps d'inactivité exclu) ; correction manuelle possible ;
  - le trajet et l'attente au bureau de poste sont saisis à part (`PHYSICAL_SHIPPING`), conformément au critère de succès ;
  - le dashboard affiche le temps quotidien par activité, le temps unitaire médian (min/carte scannée, min/commande) et alimente le `temps_unitaire` du calcul de seuil (4.3).
- Rapport quotidien et rapport hebdomadaire par e-mail (configurable).
- Alertes urgentes : double vente potentielle, désynchronisation de stock, commande proche de l'échéance, API déconnectée.
- Option future : remontées dans Airth / messages WhatsApp pour décisions importantes ; aucun couplage obligatoire au MVP.

## 5. Buy Engine (V2)

### 5.1. Sources

- Sources disposant d'une API ou d'un accès contractuellement autorisé : marketplaces, flux officiels de prix, partenaires professionnels.
- Snapshots réguliers des annonces et cotations ; source, date, état, langue, devise, livraison et qualité des données.
- Historique interne **des transactions réellement réalisées** ; ne jamais simuler un historique public inaccessible.
- Limites de taux, quotas, droits d'utilisation et politique de rétention respectés.

### 5.2. Pipeline de sourcing

`Collect → Normalize → Match exact card/variant/condition → Estimate resell price → Compute all-in costs → Score liquidity/risk → Rank → Human approve → Purchase outside/through authorized API → Receive → Inventory`

**Score d'opportunité (proposition)** :

- 35 % : marge nette estimée / capital immobilisé ;
- 25 % : probabilité et délai de revente ;
- 20 % : confiance dans la correspondance carte/état/prix ;
- 10 % : risque vendeur/retour/contrefaçon ;
- 10 % : adéquation au budget et concentration du stock.

Les poids sont configurables et initialement à calibrer sur des ventes réelles.

### 5.3. Économie unitaire

```text
coût_acquis = prix_achat + transport_entrant + frais_achat + allocation_frais_lot
produit_net_canal = prix_vente + frais_port_facturés_acheteur
                    - frais_marketplace - frais_paiement
                    - transport_sortant - emballage - provisions_retours
marge_contributive = produit_net_canal - coût_acquis
rendement_capital = marge_contributive / coût_acquis
rendement_heure = marge_contributive / temps_humain_estimé
```

La **marge après charges et impôts** est un calcul distinct, dépendant du statut juridique/fiscal configuré et validé. Ne pas présenter la marge contributive comme bénéfice net.

### 5.4. Règles de sûreté achat

- Validation humaine obligatoire avant tout achat en V2.
- Budget journalier et mensuel, plafond par carte/vendeur/édition, marge et liquidité minimales.
- Refus des annonces avec édition, langue ou état incertains.
- Refus ou revue approfondie des cartes contrefaites possibles et offres anormalement bon marché.
- Journal complet des propositions, approbations, dépenses et résultats.
- Achat automatique **hors périmètre V2 initial** ; n'envisager qu'une V3 sur fournisseurs/API explicitement autorisés.

## 6. Architecture cible

### 6.1. Choix techniques recommandés

- **Frontend :** Next.js/React + TypeScript, PWA responsive smartphone/desktop.
- **Backend :** TypeScript (API REST, services métiers, intégrations) en **monolithe modulaire**, pas de microservices prématurés.
- **Base :** PostgreSQL, transactions ACID pour stock et commandes.
- **Stockage médias :** objet S3-compatible (photos, documents) avec accès privé et URLs signées.
- **Jobs :** file persistante (PostgreSQL ou Redis + BullMQ), retries, dead-letter queue.
- **Scan :** pipeline image/OCR + matching catalogue ; modèle de vision externe éventuel derrière une interface substituable.
- **Authentification :** owner unique au MVP ; extension vers RBAC et 2FA.
- **Impression :** service local facultatif (CUPS / spooler) recevant des jobs authentifiés ; PDF toujours disponible.
- **Observabilité :** journaux structurés, traces des jobs, tableaux d'erreurs, alertes.
- **Déploiement :** Docker Compose sur serveur ou PaaS ; environnements `dev`, `staging`, `production`.

### 6.2. Modules applicatifs

```text
apps/
  web/                  # PWA, dashboard, scanner, picking
  api/                  # HTTP API et webhooks
  worker/               # jobs et planifications
packages/
  domain/               # règles de stock, commandes, prix
  catalog/              # catalogues et identification
  inventory/            # unités, lots, mouvements, emplacements
  marketplaces/         # interface + connecteurs eBay/CardTrader
  pricing/              # cotations et prix recommandés
  fulfillment/          # picking, labels, impression, tracking
  sourcing/             # V2 Buy Engine
  shared/               # schémas, erreurs et événements
infra/
  migrations/
  docker/
  monitoring/
```

### 6.3. Événements métiers

- `CardIdentified`, `InventoryReceived`, `InventoryMoved`
- `ListingRequested`, `ListingPublished`, `ListingSyncFailed`
- `OrderImported`, `StockReserved`, `StockReservationFailed`, `OversellResolved`
- `PickConfirmed`, `PackagePacked`, `ParcelHandedOver` (confirmation manuelle), `CarrierScanReceived` (si suivi), `ShipmentConfirmed`
- `ReturnReceived`, `InventoryReinstated`, `SaleClosed`
- `PriceSnapshotUpdated`, `OpportunityDetected`, `PurchaseApproved` (V2)

Utiliser une **outbox transactionnelle** pour publier les événements importants après commit et garantir la reprise après panne.

## 7. Modèle de données minimal

| Entité | Champs structurants |
|---|---|
| `catalog_cards` | `id`, `set_id`, `local_number`, `name`, `language`, `rarity`, `image_url`, `external_ids` — la langue est portée ici et nulle part ailleurs |
| `card_variants` | `id`, `catalog_card_id`, `finish`, `edition`, `promo`, `stamp`, `attributes` |
| `bulk_descriptors` | `id`, `set_id` ou `era`, `card_type`, `rarity_band`, `language`, `label` |
| `acquisition_lots` | `id`, `source_type`, `seller_ref`, `purchase_date`, `total_cost`, `shipping_cost`, `provenance_docs` |
| `offers` | `id`, `offer_sku`, `variant_id`, `condition`, `is_unique`, `photos`, `category`, `target_price`, `floor_price`, `status` |
| `stock_items` | `id`, `unit_sku`, `kind` (`UNIQUE`/`FUNGIBLE`/`BULK`), `offer_id` (null si `BULK`), `bulk_descriptor_id` (si `BULK`), `location_id`, `acquisition_lot_id`, `unit_cost`, `on_hand`, `reserved` (projection de Σ allocations actives, maintenue dans la même transaction), `inspection`, `quarantine`, `lifecycle`, `version` |
| `locations` | `id`, `parent_id`, `code`, `description` |
| `inventory_movements` | `id`, `stock_item_id`, `movement_type`, `qty_delta`, `bucket` (`on_hand`/`inspection`/`quarantine`), `order_allocation_id`, `correlation_id`, `actor`, `reason`, `created_at` |
| `condition_mappings` | `id`, `channel`, `internal_condition`, `external_code`, `external_label`, `valid_from` |
| `price_snapshots` | `id`, `variant_id`, `condition`, `source`, `quote_type`, `currency`, `amount`, `observed_at`, `source_scope` (p. ex. agrégat toutes langues si la source ne distingue pas) |
| `listings` | `id`, `offer_id`, `channel`, `external_id`, `price`, `status`, `quantity_sent`, `quantity_confirmed`, `buffer`, `last_synced_at`, `error_code` |
| `orders` | `id`, `channel`, `external_id`, `payment_status`, `fulfillment_status`, `oversold`, `gross`, `currency`, `ordered_at`, `ship_by` |
| `order_lines` | `id`, `order_id`, `offer_id`, `external_line_id`, `qty`, `unit_price`, `fee_allocated` |
| `order_allocations` | `id`, `order_line_id`, `stock_item_id`, `qty`, `status` (`RESERVED`/`PICKED`/`PACKED`/`SHIPPED`/`RELEASED`), `created_at`, `updated_at` |
| `oversell_incidents` | `id`, `order_id`, `offer_id`, `cause`, `resolution` (`SUBSTITUTED`/`FOUND`/`CANCELLED`), `resolved_at`, `penalty_note` |
| `shipments` | `id`, `order_id`, `mode` (`LETTER_UNTRACKED`/`LETTER_TRACKED`/`PARCEL_TRACKED`), `carrier`, `service`, `tracking` (nullable), `label_asset_id`, `postage_cost`, `handover_confirmed_at`, `handover_confirmed_by`, `first_carrier_scan_at`, `status` |
| `work_sessions` | `id`, `actor`, `activity`, `started_at`, `ended_at`, `idle_excluded_s`, `items_processed`, `manual_correction` |
| `print_jobs` | `id`, `batch_id`, `asset_id`, `printer`, `status`, `attempts`, `printed_at` |
| `external_sync_jobs` | `id`, `channel`, `entity_type`, `idempotency_key`, `state`, `error`, `next_retry_at` |
| `audit_events` | `id`, `actor`, `action`, `entity`, `entity_id`, `before`, `after`, `at` |
| `opportunities` (V2) | `id`, `source`, `offer_url`, `variant_id`, `buy_price_all_in`, `expected_net_sale`, `score`, `status` |
| `purchase_decisions` (V2) | `id`, `opportunity_id`, `approved_by`, `amount`, `status`, `decision_at` |

**Contraintes :**

- Unicité sur `(channel, external_order_id)`, `unit_sku` et `offer_sku`.
- Unicité `(channel, external_listing_id)` lorsqu'un identifiant externe existe ; une seule annonce active par `(channel, offer_id)`.
- Contraintes `CHECK` : compteurs ≥ 0 et `reserved + inspection + quarantine ≤ on_hand` — la base garantit elle-même `available_to_sell ≥ 0`, même en cas de bug applicatif.
- Ne jamais rendre `available_to_sell` négatif : vérifié dans la transaction d'allocation sous verrou des positions concernées ; `version` pour la concurrence optimiste des autres mises à jour.
- `kind = UNIQUE` ⇒ `on_hand ≤ 1` et l'offre (`is_unique = true`) ne référence qu'une position ; `kind = BULK` ⇒ `offer_id IS NULL` et `bulk_descriptor_id IS NOT NULL`.
- Toute position d'une offre partage la même variante et le même état ; emplacement, lot et coût peuvent différer.
- Les coûts et montants sont stockés en décimaux ou centimes entiers, jamais en flottants binaires.
- Pas de suppression destructrice d'un achat ou mouvement de stock validé ; correction tracée.

## 8. Contrat API interne — proposition

```http
POST   /api/scans                       # image → candidats + score
POST   /api/inventory/receive           # confirmer l'entrée de stock
GET    /api/inventory                   # recherche / filtres / emplacement
POST   /api/inventory/{id}/move         # changement d'emplacement
POST   /api/inventory/{id}/adjust       # correction auditée
GET    /api/pricing/{variantId}         # références et recommandations
POST   /api/listings/preview            # validation + simulation frais
POST   /api/listings/publish            # publier les éléments éligibles
POST   /api/webhooks/{channel}          # événements signés
GET    /api/orders?status=paid          # file des commandes
POST   /api/orders/{id}/allocate        # allocation idempotente offre → positions
POST   /api/orders/{id}/oversell/resolve # substitution / retrouvé / annulation
POST   /api/picking/batches             # préparation groupée
POST   /api/orders/{id}/pick            # scan / confirmation picking
POST   /api/shipments/handover          # confirmation de dépôt groupée (scan des colis)
POST   /api/work-sessions               # ouverture/fermeture/correction de session de travail
GET    /api/print-jobs                  # impression / PDF
POST   /api/print-jobs/{id}/retry       # nouvelle tentative contrôlée
GET    /api/dashboard                   # KPI / alertes
GET    /api/opportunities               # V2
POST   /api/opportunities/{id}/approve  # V2, action humaine
```

Toutes les mutations sensibles utilisent authentification, permissions, clé d'idempotence, validation stricte des données et audit.

## 9. Jobs planifiés

| Job | Fréquence initiale | Comportement |
|---|---|---|
| `sync_catalog` | Hebdomadaire / à chaque nouvelle série | Mettre à jour nouveautés et correspondances |
| `sync_prices` | Quotidien | Importer cotations licites et dater les snapshots |
| `poll_orders` | Toutes les 5–15 min si pas de webhook | Récupérer commandes, dédupliquer, réserver |
| `reconcile_listings` | Toutes les 15–60 min | Comparer quantités internes/externes ; corriger ou alerter |
| `morning_fulfillment` | 07:00 Europe/Paris | Générer picking + documents de commandes éligibles |
| `print_dispatch` | Après génération | Envoyer au spooler local s'il est disponible |
| `shipment_tracking` | Plusieurs fois/jour | Mettre à jour suivi, signaler anomalies |
| `daily_digest` | Chaque matin | Résumé ventes, actions, erreurs et temps estimé |
| `sourcing_scan` (V2) | Quotidien, selon quotas | Rechercher et classer les opportunités |

**Règles :** jobs rejouables et idempotents ; aucune duplication d'achat, de commande ou d'étiquette ; gestion UTC interne et affichage Europe/Paris ; seuil d'alerte si source externe indisponible.

## 10. UX : écrans essentiels

1. **Accueil / Aujourd'hui :** commandes à préparer, erreurs, opportunités, profit et temps estimé.
2. **Scanner :** prise de photo, candidats, validation, état, quantité, emplacement.
3. **Inventaire :** filtres série/langue/état/prix/localisation, mouvements et bulk.
4. **Fiche carte :** photos, provenance, coûts, cotations datées, annonces, historique.
5. **Publications :** aperçu par canal, validations manquantes, publier, synchronisation.
6. **Commandes :** file de picking, scan de vérification, impression, tracking et retours.
7. **Finance :** marge par carte/lot/plateforme, capital immobilisé, rendement horaire.
8. **Paramètres :** canaux OAuth, règles de prix, transporteurs, imprimantes, seuils et horaires.
9. **Buy Engine (V2) :** opportunités classées, raisons du score, approbation, budget.

L'application doit être utilisable d'une main sur smartphone pour scanner/ranger et sur ordinateur pour les commandes et impressions.

## 11. Sécurité, conformité et fiabilité

### Sécurité et données

- OAuth pour les comptes marketplaces ; jetons chiffrés au repos, rotation, permissions minimales.
- Webhooks vérifiés (signature/secret si disponibles), protection contre rejeu, rate limiting.
- Photos privées par défaut ; ne pas exposer les documents ou adresses des acheteurs publiquement.
- Historique des accès, sauvegardes PostgreSQL quotidiennes, tests de restauration et politique de rétention.
- Gestion des données personnelles conforme RGPD : finalités, accès, export et suppression selon obligations légales de conservation.
- Aucun agent IA ne détient des permissions financières illimitées.

### Légal et fiscal — à valider avant activité commerciale

- **Ne pas confondre** liquidation ponctuelle d'une collection personnelle et achat-revente professionnel régulier.
- Pour la revente professionnelle de biens d'occasion en France, anticiper les obligations de **déclaration préalable et registre des objets mobiliers** ; conserver provenance et informations requises dans un module ou un outil conforme. La spécification de ce registre doit être validée juridiquement, notamment pour les exigences d'inaltérabilité et de conservation.
- Prévoir facturation et traitement de TVA selon le statut effectif ; la **TVA sur marge** peut s'appliquer à certaines acquisitions de biens d'occasion, mais ne doit pas être calculée à partir d'une règle universelle présumée.
- Conserver les conditions commerciales, droits de réutilisation des données/catalogues et règles d'API propres à chaque plateforme.
- Inclure les garanties et obligations consommateur applicables à un vendeur professionnel.

### Cas d'échec obligatoirement traités

- Même carte achetée simultanément sur deux plateformes.
- Vente reçue pendant une panne de synchronisation.
- Order webhook délivré plusieurs fois / dans le désordre.
- Impression déclenchée deux fois après redémarrage.
- Étiquette créée mais réponse API perdue.
- Carte introuvable au picking.
- Commande annulée pendant la préparation.
- Colis perdu ou retourné dans un état différent.
- Catalogue incomplet ou identification incertaine.
- Prix de référence périmé, en devise étrangère ou pour une autre variante.

## 12. Critères d'acceptation par epic

### Epic 1 — Inventaire

- [ ] Scanner 100 cartes de test et enregistrer leurs métadonnées, leur quantité et emplacement.
- [ ] Afficher les 3 meilleures correspondances et permettre la correction manuelle.
- [ ] Empêcher la mise en vente d'une carte non validée ou sans emplacement.
- [ ] Enregistrer un lot de 1 000 communes sans 1 000 scans.
- [ ] Extraire 5 cartes d'un lot de vrac vers des positions individuelles ; quantités et coûts cohérents dans le journal de mouvements.
- [ ] Une offre à 3 positions (emplacements différents) affiche une quantité vendable égale à la somme des disponibles.
- [ ] Rechercher un SKU et afficher son emplacement en < 2 secondes sur un catalogue de 10 000 unités en conditions nominales.

### Epic 2 — Publication

- [ ] Prévisualiser titre, catégorie, état, photos, prix, frais et marge avant envoi.
- [ ] Publier 20 articles sur une marketplace de test autorisée et récupérer leurs IDs.
- [ ] Relancer sans doublon une publication interrompue.
- [ ] Modifier la quantité publiée après réservation de stock.

### Epic 3 — Vente et logistique

- [ ] Importer une commande payée et allouer atomiquement les positions.
- [ ] Recevoir deux fois le même événement sans créer deux commandes.
- [ ] Deux commandes concurrentes sur la dernière unité d'une offre : une seule allocation réussit, l'autre déclenche le Parcours F (pause multicanale + alerte en < 1 min).
- [ ] Confirmer en lot le dépôt de 10 lettres non suivies sans aucun numéro de suivi.
- [ ] Générer un PDF de picking + documents transport des commandes éligibles de la veille.
- [ ] Préparer par scan et empêcher le picking du mauvais SKU.
- [ ] Confirmer le dépôt : sortir les unités du stock physique et envoyer le tracking.
- [ ] Annulation et retour ne réintroduisent aucun article sans justification.

### Epic 4 — Buy Engine (V2)

- [ ] Importer des annonces depuis une source explicitement autorisée.
- [ ] Exclure les faux matchs de langue, série, variante et état.
- [ ] Calculer coût d'achat complet, marge contributive et incertitude.
- [ ] Proposer une liste quotidienne d'opportunités explicables.
- [ ] Interdire un achat sans approbation humaine et contrôle de budget.
- [ ] Mesurer après vente la marge réalisée vs marge estimée.

## 13. Roadmap de réalisation

### Sprint 0 — Vérifications / spike intégrations

**À faire avant tout développement lourd :**

- Créer un compte vendeur test et vérifier l'accès effectif à l'API retenue.
- Tester une création d'annonce, une commande et une mise à jour de quantité en environnement sandbox ou avec un article de test réel.
- Vérifier les droits du catalogue et des prix.
- Photographier 100 cartes variées et mesurer l'identification automatique, les erreurs de variantes et le coût par scan.
- Choisir modes d'expédition, fournisseur d'étiquettes et imprimante ; vérifier quels modes (lettre suivie/non suivie) chaque fournisseur et chaque canal acceptent.
- Relever le barème réel de frais de chaque canal candidat et calculer le **seuil de rentabilité unitaire** (4.3) par mode d'expédition.
- Documenter les correspondances d'état par canal (`condition_mappings`) et les pénalités d'annulation pour rupture de stock.

**Go/No-go :** il existe au moins un canal permettant un cycle de vente complet **dans des conditions autorisées** et un scanner dont les erreurs sont gérables.

### Sprint 1 — Catalogue, scan et stock

Catalogue, reconnaissance, confirmation, SKU, lots de vrac, emplacements, inventaire, mouvements, recherche.

### Sprint 2 — Prix et publication

Cotations datées, règles de classification, prix plancher, aperçu des annonces, premier adaptateur marketplace, logs et retries.

### Sprint 3 — Commandes et logistique

Commandes, réservations, picking par emplacement, PDF, agent d'impression facultatif, expédition, tracking, retours simples.

### Sprint 4 — Qualité et exploitation

Réconciliation multicanale, tests de concurrence, dashboard finance, alertes, sauvegarde/restauration, données de démonstration et documentation d'installation.

### V2 — Sourcing

Moteur de prix, collecte autorisée, normalisation, scoring, budget, validation d'achat, suivi des marges réelles.

## 14. Stratégie de test commercial

**Pilote sur stock personnel :**

1. Sélectionner 100 cartes différentes + un lot de communes.
2. Mesurer le temps de scan, les corrections et le temps de rangement.
3. Publier 20–50 cartes rentables sur le canal intégré.
4. Traiter 20 commandes de test/réelles (selon disponibilité), mesurer temps par colis et exceptions.
5. Établir le coût complet par vente : frais, consommables, retours, temps humain.
6. Décider ensuite si l'automatisation apporte assez de valeur pour reprendre un stock externe.

**Décision V2 si :** fiabilité démontrée, marge contributive positive, temps opérationnel sous contrôle, et sources d'acquisition légales/techniquement accessibles.

## 15. Risques et décisions ouvertes

| Risque / décision | Réponse proposée |
|---|---|
| Accès API impossible pour une marketplace | Livrer d'abord le connecteur réellement autorisé, sans solution de contournement |
| Mauvaise identification d'une variante | Confirmation, score de confiance, photos réelles |
| Données de prix trompeuses | Source/type/horodatage visibles ; liquidité distincte |
| Trop de temps sur les cartes à faible valeur | Inventaire agrégé, lots, rachat professionnel |
| Double vente sur plusieurs canaux | Réservation atomique, sync prioritaire, pause/alerte si canal hors ligne |
| Impression automatique impossible sans ordinateur local | PDF groupé puis agent local optionnel |
| Automatisation des achats trop risquée | Approbation et plafonds obligatoires |
| Coûts de développement disproportionnés | Spike API avant build, monolithe modulaire, MVP par étapes |
| Réglementation française | Audit juridique/fiscal avant premier achat-revente professionnel |

### Décisions de conception proposées (à modifier si besoin)

- Marché initial : **France + Union européenne**, prix en EUR.
- Langues des cartes : **FR en priorité**, puis EN.
- Premier utilisateur : **owner unique**.
- Premier type de stock : **cartes à l'unité + lots agrégés**.
- Premier canal : **eBay ou CardTrader après vérification de l'accès réel**.
- Cardmarket : **référence de prix**, pas dépendance de publication MVP.
- Sources de prix : **TCGdex + guide officiel Cardmarket** selon droits et données disponibles.
- Réconciliation : au moins toutes les 15 minutes ; plus fréquent si API/webhooks le permettent.
- Impression du matin : **07:00**, configurable, avec plan B PDF.
- Décision d'achat : **validation humaine** au moins jusqu'à la V3.
- Monétisation SaaS : **hors scope** tant que l'outil n'a pas prouvé sa rentabilité sur le stock personnel.

## 16. Historique des révisions

| Version | Date | Changements |
|---|---|---|
| 1.0 | 16/11/2026 | Spécification initiale |
| 1.1 | 16/11/2026 | Modèle de stock à trois niveaux (catalogue / offre / position) ; états portés par compteurs et allocations ; vrac unifié dans `stock_items` ; annonces par offre ; allocation commande → positions ; langue portée par le catalogue uniquement ; Parcours F (survente) ; modes d'expédition et confirmation de dépôt manuelle comme mode nominal ; `condition_mappings` ; seuils de vente calculés par canal ; mesure du temps (`work_sessions`) |

## 17. Références officielles à vérifier lors de l'implémentation

- TCGdex — API et modèle de carte : https://tcgdex.dev/fr/reference/card
- eBay — Inventory API : https://developer.ebay.com/develop/api/sell/inventory_api
- eBay — Fulfillment API : https://developer.ebay.com/develop/api/sell/fulfillment_api
- CardTrader — API développeurs : https://www.cardtrader.com/en-US/docs/api
- Cardmarket — politique d'accès API : https://help.cardmarket.com/en/cardmarket-api
- Cardmarket — téléchargement de catalogues / prix : https://news.cardmarket.com/fr/Spoils/were-making-the-price-guide-and-product-catalogue-available-for-download
- Sendcloud — Shipping API : https://www.sendcloud.com/api/
- Service Public — vente professionnelle de biens d'occasion : https://entreprendre.service-public.gouv.fr/vosdroits/F39552
- DGE — déclaration et registre des revendeurs d'objets mobiliers : https://www.entreprises.gouv.fr/la-dge/publications/demarrer-la-vente-de-biens-doccasion-tout-savoir-sur-la-declaration-pour
- BOFiP — régime de TVA sur marge : https://bofip.impots.gouv.fr/bofip/13268-PGP.html

---

**Critère de réussite final :** un propriétaire scanne et range ses cartes, clique pour publier sur les canaux disponibles, récupère chaque matin les commandes déjà documentées, prépare les colis en quelques gestes, confirme leur dépôt et consulte ses marges ; le logiciel gère le reste et remonte seulement les exceptions et décisions importantes.
