-- Connexion des canaux réels. Le compte vendeur autorise Dexlane (OAuth) : on garde le jeton de renouvellement,
-- et le jeton d'accès du moment (deux heures chez eBay). Le jeton de renouvellement ne sert à rien sans le secret de
-- l'application, qui reste dans l'environnement du serveur.
create table channel_accounts (
  channel            text primary key,
  -- Bac à sable ou production : un compte autorisé dans l'un ne vaut rien dans l'autre.
  environment        text not null,
  -- Pseudo du compte vendeur, pour l'afficher.
  username           text,
  refresh_token      text not null,
  refresh_expires_at timestamptz,
  access_token       text,
  access_expires_at  timestamptz,
  connected_at       timestamptz not null default now()
);

-- Autorisations en cours : la valeur `state` envoyée à la marketplace doit revenir telle quelle (protection CSRF).
create table channel_oauth_states (
  state      text primary key,
  channel    text not null,
  created_at timestamptz not null default now()
);

-- Réglages propres à un canal : règles de vente choisies, adresse d'expédition, caractéristiques de la catégorie.
alter table channel_settings add column config jsonb not null default '{}'::jsonb;
