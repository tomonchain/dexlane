-- Statistiques, parcours de démarrage, récaps, niveau et succès (#83, #84, #85, #86).
--
-- Tout se calcule à partir des tables métier et d'un journal d'événements par compte. Le journal ne remplace pas
-- l'outbox (outbox_events, faite pour publier vers l'extérieur) : il garde les faits qui comptent pour le vendeur, avec
-- une clé de déduplication qui rend chaque écriture idempotente (un même fait rejoué ou reconstruit ne compte qu'une fois).

-- ───────────────────────── Journal d'événements ─────────────────────────

create table account_events (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null default current_account_id(),
  type        text not null check (type in (
    'ebay_connected', 'card_added', 'location_set', 'listing_published', 'listing_failed',
    'sale_paid', 'sale_cancelled', 'sale_refunded', 'sale_returned', 'slip_printed',
    'referral_qualified', 'referral_discount_full'
  )),
  -- Ce qui identifie le fait : « listing_published:<annonce> », « sale_paid:<commande> »…
  dedupe_key  text not null,
  payload     jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  unique (account_id, dedupe_key)
);
create index account_events_type_idx on account_events (account_id, type, occurred_at);

-- ───────────────────────── Préférences de chaque utilisateur ─────────────────────────

create table user_preferences (
  account_id               uuid not null default current_account_id(),
  user_id                  text not null,
  -- Fuseau des statistiques et des semaines de régularité.
  timezone                 text not null default 'Europe/Paris',
  -- « Afficher le niveau et les succès » : désactivé, le niveau, la page Progression, les notifications de succès et la
  -- partie progression des récaps disparaissent.
  show_progression         boolean not null default true,
  -- E-mail qui annonce le récap du mois.
  recap_email              boolean not null default true,
  -- Bloc « Compte configuré à x % » masqué de l'accueil (il reste dans le menu du compte).
  onboarding_hidden        boolean not null default false,
  -- Succès déjà annoncés à cet utilisateur (notification groupée).
  achievements_seen_at     timestamptz,
  -- Message unique « Tu as déjà débloqué n succès » après l'attribution rétroactive.
  retro_message_seen_at    timestamptz,
  updated_at               timestamptz not null default now(),
  primary key (account_id, user_id)
);

-- ───────────────────────── Progression du compte ─────────────────────────

-- Le niveau est celui du compte (la boutique). Il ne descend jamais : on garde le plus haut atteint.
create table account_progress (
  account_id              uuid primary key default current_account_id(),
  level                   integer not null default 0 check (level between 0 and 10),
  level_reached_at        timestamptz,
  onboarding_completed_at timestamptz,
  -- Accès anticipé aux fonctionnalités en test (avantage du niveau 3).
  beta                    boolean not null default false,
  -- Compte qui existait au lancement : sa première évaluation attribue son historique sans notification individuelle
  -- (attribution rétroactive), puis un message unique le résume.
  retroactive_pending     boolean not null default false,
  retroactive_at          timestamptz,
  evaluated_at            timestamptz
);
insert into account_progress (account_id, retroactive_pending) select id, true from accounts;

-- Une vente confirmée : une ligne de commande restée sans annulation, retour ni remboursement pendant le délai de
-- confirmation. Écrite une fois, jamais retirée : le niveau qui en découle ne peut pas descendre.
create table sale_confirmations (
  account_id    uuid not null default current_account_id(),
  order_line_id uuid not null references order_lines (id),
  -- Une vente = une unité vendue d'une annonce ; un lot compte pour 1.
  units         integer not null check (units > 0),
  sold_at       timestamptz not null,
  confirmed_at  timestamptz not null default now(),
  primary key (account_id, order_line_id)
);

-- Succès obtenus. Un succès n'est jamais retiré, sauf fraude constatée (action manuelle : revoked_at).
create table account_achievements (
  account_id     uuid not null default current_account_id(),
  achievement    text not null,
  unlocked_at    timestamptz not null default now(),
  -- 'live' : constaté au fil de l'eau ; 'retroactive' : attribué d'après l'historique, sans notification.
  source         text not null default 'live' check (source in ('live', 'retroactive')),
  revoked_at     timestamptz,
  revoked_reason text,
  primary key (account_id, achievement)
);

-- Avantages de niveau, appliqués une seule fois à l'atteinte du niveau.
create table account_perks (
  account_id uuid not null default current_account_id(),
  level      integer not null,
  perk       text not null,
  applied_at timestamptz not null default now(),
  detail     jsonb not null default '{}',
  primary key (account_id, level, perk)
);

-- ───────────────────────── Récaps ─────────────────────────

-- Un récap par mois (« 2026-11 ») ou par année (« 2026 »), figé à sa génération.
create table account_recaps (
  account_id uuid not null default current_account_id(),
  period     text not null check (period ~ '^[0-9]{4}(-[0-9]{2})?$'),
  data       jsonb not null,
  created_at timestamptz not null default now(),
  emailed_at timestamptz,
  primary key (account_id, period)
);

-- ───────────────────────── Cloisonnement ─────────────────────────

do $$
declare
  t text;
  cond constant text := 'nullif(current_setting(''app.account_id'', true), '''')::uuid';
begin
  foreach t in array array[
    'account_events', 'user_preferences', 'account_progress', 'sale_confirmations', 'account_achievements', 'account_perks', 'account_recaps'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy account_isolation on %I using (account_id = %s) with check (account_id = %s)', t, cond, cond);
  end loop;
end $$;
