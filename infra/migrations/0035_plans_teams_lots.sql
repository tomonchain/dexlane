-- Forfaits, équipes, support, lots et cartes gradées.
--
-- Les règles des forfaits (quotas, fonctionnalités) vivent dans le code (@dexlane/shared, plans.ts) : la base ne garde
-- que le forfait de chaque compte, ce qui a été publié dans le mois et les packs ajoutés.

-- ───────────────────────── Forfait du compte ─────────────────────────

-- Un nouveau compte commence en Découverte. Le compte d'installation (le propriétaire du serveur) n'a pas de limite.
alter table accounts
  add column plan text not null default 'decouverte',
  add column plan_changed_at timestamptz not null default now();
-- Le compte d'installation est toujours sans limite (voir accountPlan, @dexlane/listings) ; sa colonne le dit aussi.
update accounts set plan = 'community' where id = owner_account_id();

-- Une carte publiée = une offre mise en ligne pour la première fois sur un canal. Une révision (prix, quantité), une
-- remise en ligne ou une republication ne crée pas de nouvelle ligne : elles ne comptent pas.
create table publication_usage (
  account_id  uuid not null default current_account_id(),
  offer_id    uuid not null references offers (id),
  channel     text not null,
  -- Premier jour du mois (heure de Paris) où l'offre a été publiée.
  month       date not null,
  -- Publiée au-delà du quota du mois, dans une publication en masse déjà commencée.
  over_quota  boolean not null default false,
  counted_at  timestamptz not null default now(),
  primary key (account_id, offer_id, channel)
);
create index publication_usage_month_idx on publication_usage (account_id, month);

-- Packs de cartes supplémentaires, valables pour le mois où ils sont pris.
create table quota_packs (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null default current_account_id(),
  month       date not null,
  cards       integer not null check (cards > 0),
  price_cents integer not null check (price_cents >= 0),
  -- Ajouté à la main, ou automatiquement pour terminer une publication en masse commencée sous le quota.
  automatic   boolean not null default false,
  actor       text not null,
  created_at  timestamptz not null default now()
);
create index quota_packs_month_idx on quota_packs (account_id, month);

-- Alertes de quota déjà envoyées (80 % puis 100 %), une fois par mois.
create table quota_alerts (
  account_id uuid not null default current_account_id(),
  month      date not null,
  level      integer not null check (level in (80, 100)),
  sent_at    timestamptz not null default now(),
  primary key (account_id, month, level)
);

-- ───────────────────────── Équipe ─────────────────────────

-- Invitation à rejoindre un compte : un lien envoyé par e-mail. Seule l'empreinte du jeton est gardée.
create table account_invitations (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null default current_account_id(),
  email       text not null,
  token_hash  text not null unique,
  invited_by  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  revoked_at  timestamptz
);
create index account_invitations_email_idx on account_invitations (lower(email));

-- ───────────────────────── Support ─────────────────────────

create table support_requests (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null default current_account_id(),
  email      text not null,
  subject    text not null,
  message    text not null,
  -- Forfait du compte au moment de la demande : le support prioritaire est celui du forfait Boutique.
  plan       text not null,
  priority   boolean not null,
  status     text not null default 'OPEN' check (status in ('OPEN', 'ANSWERED', 'CLOSED')),
  created_at timestamptz not null default now()
);

-- ───────────────────────── Lots ─────────────────────────

-- Un lot est une offre comme les autres (une annonce, une commande, une préparation), qui regroupe des cartes du stock.
-- Elle reste rattachée à la variante de sa carte phare (affichage, catalogue) mais porte son propre titre.
alter table offers
  add column kind text not null default 'CARD' check (kind in ('CARD', 'LOT')),
  add column lot_title text,
  add column lot_description text,
  -- Carte gradée : société de gradation, note et numéro de certificat (exemplaires uniques seulement).
  add column grader text,
  add column grade text,
  add column cert_number text,
  -- Titre choisi pour cette offre (suggestion appliquée) : il remplace le modèle de titre.
  add column title_override text check (title_override is null or length(title_override) between 1 and 80),
  add constraint offers_lot_shape check ((kind = 'LOT') = (lot_title is not null)),
  add constraint offers_graded_unique check (grader is null or is_unique);

-- Les cartes mises dans un lot : elles quittent leur position (mouvement LOT_PACK) et y reviennent si le lot est défait.
create table lot_items (
  account_id      uuid not null default current_account_id(),
  lot_offer_id    uuid not null references offers (id),
  stock_item_id   uuid not null references stock_items (id),
  qty             integer not null check (qty > 0),
  unit_cost_cents integer not null default 0,
  primary key (lot_offer_id, stock_item_id)
);
create index lot_items_stock_idx on lot_items (stock_item_id);

alter type movement_type add value 'LOT_PACK';
alter type movement_type add value 'LOT_UNPACK';

-- ───────────────────────── Cloisonnement ─────────────────────────

do $$
declare
  t text;
  cond constant text := 'nullif(current_setting(''app.account_id'', true), '''')::uuid';
begin
  foreach t in array array['publication_usage', 'quota_packs', 'quota_alerts', 'account_invitations', 'support_requests', 'lot_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy account_isolation on %I using (account_id = %s) with check (account_id = %s)', t, cond, cond);
  end loop;
end $$;
