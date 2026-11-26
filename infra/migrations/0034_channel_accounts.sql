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

-- Chaque compte connecte son propre compte vendeur : les deux tables sont cloisonnées comme les autres (migration 0033).
do $$
declare
  t text;
  cond constant text := 'nullif(current_setting(''app.account_id'', true), '''')::uuid';
begin
  foreach t in array array['channel_accounts', 'channel_oauth_states'] loop
    execute format('alter table %I add column account_id uuid not null default current_account_id()', t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy account_isolation on %I using (account_id = %s) with check (account_id = %s)', t, cond, cond);
  end loop;
end $$;
alter table channel_accounts drop constraint channel_accounts_pkey, add primary key (account_id, channel);
