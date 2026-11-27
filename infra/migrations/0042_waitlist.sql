-- Liste d'attente (#103) : tant que les inscriptions sont fermées (DEXLANE_SIGNUP ≠ open), un vendeur intéressé laisse
-- son adresse. Ce n'est pas une donnée d'un compte : la table n'a pas d'account_id, et le rôle des comptes n'y a pas
-- accès ; seuls l'API (rôle de connexion) et les administrateurs la lisent.
create table waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  -- Forfait choisi sur /tarifs, code du flyer (/colis), volume de cartes vendues par mois annoncé.
  plan        text,
  signup_code text,
  volume      text,
  created_at  timestamptz not null default now(),
  -- Invitation à s'inscrire envoyée à l'ouverture.
  invited_at  timestamptz
);
create unique index waitlist_email_key on waitlist (lower(email));
revoke all on waitlist from dexlane_tenant;
