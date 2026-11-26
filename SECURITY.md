# Sécurité

Dexlane gère des stocks, des ventes et l'accès au compte eBay de ses utilisateurs : on prend les failles au sérieux.

## Signaler une faille

**N'ouvre pas d'issue publique.** Signale-la en privé par GitHub :
[Security › Report a vulnerability](https://github.com/tomonchain/dexlane/security/advisories/new).

Indique ce qui est touché (route, écran, version affichée en bas de Réglages), comment reproduire, et l'impact que tu
vois. On accuse réception sous 72 heures et on te tient au courant jusqu'à la correction. Merci de ne rien rendre
public avant que la correction soit déployée.

## Ce qui est concerné

- La version hébergée sur https://dexlane.app et le code de ce dépôt.
- En priorité : l'accès aux données d'un autre compte (cloisonnement), l'authentification et les sessions, les jetons
  (eBay, agents MCP, installation), l'exécution de code, l'exposition de secrets.

Ne teste pas sur les comptes d'autres personnes, et pas de déni de service : crée ton propre compte, ou utilise une
installation locale (voir [CONTRIBUTING.md](CONTRIBUTING.md)).
