-- Comptes et cloisonnement des données.
--
-- Jusqu'ici, l'application n'avait qu'un propriétaire. Chaque vendeur a maintenant son compte, et chaque table de
-- données porte le compte auquel ses lignes appartiennent. Le cloisonnement est fait par Postgres (row-level security) :
-- une requête exécutée pour un compte ne voit et ne modifie que ses lignes, sans que les requêtes aient à le préciser.
--
-- Le catalogue (séries, cartes, variantes), les cotes du marché, les correspondances d'état, les descripteurs de vrac et
-- les clés de notification du serveur restent communs à tous les comptes.

-- ───────────────────────── Comptes ─────────────────────────

-- Un compte : l'espace de données d'un vendeur. Ses utilisateurs (adresse e-mail, mot de passe, sessions) sont tenus par
-- BetterAuth dans les tables auth_* ci-dessous ; chaque utilisateur porte le compte auquel il appartient.
create table accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create function owner_account_id() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;

-- Le propriétaire d'origine devient le compte d'installation, avec toutes les données existantes. Son ancien mot de
-- passe (sans adresse e-mail) ne sert plus : il choisit son adresse et son mot de passe à la première connexion, avec
-- le jeton d'installation.
insert into accounts (id) values (owner_account_id());
drop table owner_credentials;

-- Tables de BetterAuth (schéma généré par son outil de migration pour la configuration d'apps/api/src/better-auth.ts).
create table "auth_users" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "role" text, "banned" boolean, "banReason" text, "banExpires" timestamptz, "accountId" text, "plan" text, "signupCode" text);
create table "auth_sessions" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "auth_users" ("id") on delete cascade, "impersonatedBy" text);
create table "auth_credentials" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "auth_users" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);
create table "auth_verifications" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
create table "auth_rate_limits" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);
create index "auth_sessions_userId_idx" on "auth_sessions" ("userId");
create index "auth_credentials_userId_idx" on "auth_credentials" ("userId");
create index "auth_verifications_identifier_idx" on "auth_verifications" ("identifier");
create index "auth_users_accountId_idx" on "auth_users" ("accountId");

-- ───────────────────────── Compte courant ─────────────────────────

-- Le compte pour lequel la transaction travaille (voir withAccount, @dexlane/db). Sans compte désigné — migrations,
-- scripts, tests des paquets — c'est le compte d'installation.
create function current_account_id() returns uuid language sql stable
  as $$ select coalesce(nullif(current_setting('app.account_id', true), '')::uuid, owner_account_id()) $$;

-- Rôle sous lequel tournent les requêtes faites pour un compte : il n'est pas propriétaire des tables et ne peut pas
-- contourner le cloisonnement, contrairement au rôle de connexion.
do $$
begin
  -- Le rôle est commun à toutes les bases du serveur : il peut déjà exister, ou être créé au même moment par une autre
  -- base (tests lancés en parallèle).
  begin
    create role dexlane_tenant nologin;
  exception when duplicate_object or unique_violation then null;
  end;
  begin
    if current_setting('server_version_num')::int >= 160000 then
      execute format('grant dexlane_tenant to %I with set true', current_user);
    else
      execute format('grant dexlane_tenant to %I', current_user);
    end if;
  exception when others then
    -- Déjà accordé par une migration concurrente : seule compte l'appartenance au rôle.
    if not pg_has_role(current_user, 'dexlane_tenant', 'member') then raise; end if;
  end;
end $$;

-- ───────────────────────── Colonne de compte et cloisonnement ─────────────────────────

do $$
declare
  t text;
  cond constant text := 'nullif(current_setting(''app.account_id'', true), '''')::uuid';
begin
  foreach t in array array[
    'acquisition_lots', 'agent_tokens', 'app_settings', 'audit_events', 'channel_settings', 'external_sync_jobs',
    'idempotency_keys', 'inventory_movements', 'listing_settings', 'listings', 'locations', 'notification_state', 'offers',
    'order_allocations', 'order_lines', 'orders', 'outbox_events', 'oversell_incidents', 'photos', 'price_alert_settings',
    'pricing_settings', 'print_jobs', 'push_subscriptions', 'scan_batches', 'scan_items', 'scheduled_publications',
    'shipments', 'shipping_costs', 'stock_items', 'supplies', 'supply_movements', 'watched_cards', 'work_sessions'
  ] loop
    -- Les lignes existantes reçoivent le compte d'installation ; les nouvelles, le compte courant.
    execute format('alter table %I add column account_id uuid not null default current_account_id()', t);
    execute format('create index %I on %I (account_id)', t || '_account_idx', t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy account_isolation on %I using (account_id = %s) with check (account_id = %s)', t, cond, cond);
  end loop;

  -- Un compte ne voit que lui-même.
  alter table accounts enable row level security;
  execute format('create policy account_isolation on accounts using (id = %s) with check (id = %s)', cond, cond);
end $$;

-- ───────────────────────── Unicité par compte ─────────────────────────

-- Réglages : une ligne par compte au lieu d'une ligne en tout.
alter table app_settings drop constraint app_settings_pkey, add primary key (account_id);
alter table listing_settings drop constraint listing_settings_pkey, add primary key (account_id);
alter table notification_state drop constraint notification_state_pkey, add primary key (account_id);
alter table price_alert_settings drop constraint price_alert_settings_pkey, add primary key (account_id);
alter table pricing_settings drop constraint pricing_settings_pkey, add primary key (account_id);
alter table shipping_costs drop constraint shipping_costs_pkey, add primary key (account_id);
alter table channel_settings drop constraint channel_settings_pkey, add primary key (account_id, channel);
alter table idempotency_keys drop constraint idempotency_keys_pkey, add primary key (account_id, key);

-- Codes et références : uniques dans un compte, plus dans toute la base.
alter table external_sync_jobs drop constraint external_sync_jobs_idempotency_key_key, add unique (account_id, idempotency_key);
alter table listings drop constraint listings_channel_external_id_key, add unique (account_id, channel, external_id);
alter table locations drop constraint locations_code_key, add unique (account_id, code);
alter table offers drop constraint offers_offer_sku_key, add unique (account_id, offer_sku);
alter table orders drop constraint orders_channel_external_id_key, add unique (account_id, channel, external_id);
alter table push_subscriptions drop constraint push_subscriptions_endpoint_key, add unique (account_id, endpoint);
alter table stock_items drop constraint stock_items_unit_sku_key, add unique (account_id, unit_sku);
alter table watched_cards drop constraint watched_cards_variant_id_key, add unique (account_id, variant_id);
drop index offers_fungible_key;
create unique index offers_fungible_key on offers (account_id, variant_id, condition) where not is_unique;

-- La vue des disponibilités applique le cloisonnement de celui qui la lit, pas celui de son propriétaire.
alter view offer_availability set (security_invoker = true);

-- ───────────────────────── Droits du rôle des comptes ─────────────────────────

grant usage on schema public to dexlane_tenant;
grant select, insert, update, delete on all tables in schema public to dexlane_tenant;
grant usage, select on all sequences in schema public to dexlane_tenant;
alter default privileges in schema public grant select, insert, update, delete on tables to dexlane_tenant;
alter default privileges in schema public grant usage, select on sequences to dexlane_tenant;
-- Le suivi des migrations et les tables d'authentification ne regardent pas les comptes.
revoke all on schema_migrations, auth_users, auth_sessions, auth_credentials, auth_verifications, auth_rate_limits from dexlane_tenant;
