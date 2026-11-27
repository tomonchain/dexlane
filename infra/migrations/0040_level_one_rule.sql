-- Niveau 1 (Carton) : il s'obtient en terminant la configuration du compte, plus à la première vente confirmée (#92).
--
-- Le niveau ne descend jamais ; seule exception, cette correction unique, juste après le lancement : un compte passé au
-- niveau 1 par sa première vente sans avoir terminé sa configuration revient au niveau 0. Il retrouve le niveau 1 en
-- terminant son démarrage, ou passe directement au niveau 2 à sa dixième vente confirmée.
update account_progress set level = 0, level_reached_at = null
 where level = 1 and onboarding_completed_at is null;
