-- Comptes et cloisonnement des données.
--
-- Jusqu'ici, l'application n'avait qu'un propriétaire. Chaque vendeur a maintenant son compte, et chaque table de
-- données porte le compte auquel ses lignes appartiennent. Le cloisonnement est fait par Postgres (row-level security) :
-- une requête exécutée pour un compte ne voit et ne modifie que ses lignes, sans que les requêtes aient à le préciser.
--
-- Le catalogue (séries, cartes, variantes), les cotes du marché, les correspondances d'état, les descripteurs de vrac et
-- les clés de notification du serveur restent communs à tous les comptes.

-- ───────────────────────── Comptes ─────────────────────────

create table accounts (
  id uuid primary key default gen_random_uuid(),
  -- Sans adresse : le compte d'installation (le propriétaire d'origine), qui se connecte avec son seul mot de passe.
  email text,
  password_hash text,
  session_version integer not null default 1,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  email_verified_at timestamptz,
  -- Forfait choisi et code du flyer saisis à l'inscription (indicatifs : pas encore de facturation).
  plan text,
  signup_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index accounts_email_key on accounts (lower(email));

create function owner_account_id() returns uuid language sql immutable
  as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;

-- Le propriétaire d'origine devient le premier compte, avec son mot de passe et toutes les données existantes.
insert into accounts (id, password_hash, session_version, failed_attempts, locked_until, email_verified_at, updated_at)
select owner_account_id(), c.password_hash, coalesce(c.session_version, 1), coalesce(c.failed_attempts, 0), c.locked_until, now(),
       coalesce(c.updated_at, now())
  from (select 1) one left join owner_credentials c on true;
drop table owner_credentials;

-- Liens à usage unique envoyés par e-mail : vérification de l'adresse, réinitialisation du mot de passe.
create table account_tokens (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  kind text not null check (kind in ('VERIFY_EMAIL', 'RESET_PASSWORD')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index account_tokens_account_idx on account_tokens (account_id, kind);

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

  -- Un compte ne voit que lui-même et ses propres liens.
  alter table accounts enable row level security;
  execute format('create policy account_isolation on accounts using (id = %s) with check (id = %s)', cond, cond);
  alter table account_tokens enable row level security;
  execute format('create policy account_isolation on account_tokens using (account_id = %s) with check (account_id = %s)', cond, cond);
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
-- Le suivi des migrations ne regarde pas les comptes.
revoke all on schema_migrations from dexlane_tenant;
