-- Pokémon Trading OS — schéma initial (spec v1.1, §4.2 et §7)
-- Montants en centimes entiers (integer), jamais de flottants.
-- Horodatages en timestamptz (UTC interne).

-- ───────────────────────── Types ─────────────────────────

create type card_condition as enum ('MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO');
create type stock_kind as enum ('UNIQUE', 'FUNGIBLE', 'BULK');
create type stock_lifecycle as enum ('DRAFT', 'ACTIVE', 'ARCHIVED');
create type stock_bucket as enum ('on_hand', 'reserved', 'inspection', 'quarantine');
create type movement_type as enum (
  'RECEIVE', 'MOVE', 'ALLOCATE', 'RELEASE', 'PICK', 'SHIP_OUT',
  'RETURN_IN', 'INSPECT_OK', 'INSPECT_KO', 'QUARANTINE', 'UNQUARANTINE',
  'BULK_EXTRACT', 'ADJUST', 'LOST', 'DISPOSED'
);
create type allocation_status as enum ('RESERVED', 'PICKED', 'PACKED', 'SHIPPED', 'RELEASED');
create type offer_category as enum ('BULK', 'LOT', 'SINGLE', 'PREMIUM', 'REVIEW');
create type offer_status as enum ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
create type shipping_mode as enum ('LETTER_UNTRACKED', 'LETTER_TRACKED', 'PARCEL_TRACKED');

-- Interdit UPDATE/DELETE sur les tables append-only.
create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end $$;

-- ───────────────────────── Emplacements ─────────────────────────

create table locations (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references locations (id),
  code        text not null unique,          -- ex. BOX-03/ROW-12/SLOT-04
  description text,
  created_at  timestamptz not null default now()
);

-- ───────────────────────── Catalogue ─────────────────────────

-- La langue est une propriété de l'impression : FR et EN sont deux cartes distinctes.
create table catalog_cards (
  id           uuid primary key default gen_random_uuid(),
  set_id       text not null,
  local_number text not null,
  name         text not null,
  language     text not null check (language ~ '^[a-z]{2}(-[a-z]{2})?$'),
  rarity       text,
  image_url    text,
  external_ids jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  unique (set_id, local_number, language)
);

create table card_variants (
  id              uuid primary key default gen_random_uuid(),
  catalog_card_id uuid not null references catalog_cards (id),
  finish          text not null,               -- normal, holo, reverse, …
  edition         text not null default '',    -- '' = sans mention, '1st', …
  promo           boolean not null default false,
  stamp           text not null default '',
  attributes      jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  unique (catalog_card_id, finish, edition, promo, stamp)
);

create table bulk_descriptors (
  id          uuid primary key default gen_random_uuid(),
  set_id      text,
  era         text,
  card_type   text not null,                   -- communes, peu communes, énergies, …
  rarity_band text,
  language    text check (language is null or language ~ '^[a-z]{2}(-[a-z]{2})?$'),
  label       text not null,
  created_at  timestamptz not null default now()
);

-- ───────────────────────── Acquisitions ─────────────────────────

create table acquisition_lots (
  id                  uuid primary key default gen_random_uuid(),
  source_type         text not null,
  seller_ref          text,
  purchase_date       date not null,
  total_cost_cents    integer not null check (total_cost_cents >= 0),
  shipping_cost_cents integer not null default 0 check (shipping_cost_cents >= 0),
  provenance_docs     jsonb not null default '[]',
  created_at          timestamptz not null default now()
);

-- ───────────────────────── Offres (ce qu'on vend) ─────────────────────────

create table offers (
  id                uuid primary key default gen_random_uuid(),
  offer_sku         text not null unique,
  variant_id        uuid not null references card_variants (id),
  condition         card_condition not null,
  is_unique         boolean not null,
  photos            jsonb not null default '[]',
  category          offer_category not null default 'REVIEW',
  target_price_cents integer check (target_price_cents is null or target_price_cents >= 0),
  floor_price_cents  integer check (floor_price_cents is null or floor_price_cents >= 0),
  status            offer_status not null default 'DRAFT',
  version           integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Une seule offre interchangeable par (variante, état).
create unique index offers_fungible_key on offers (variant_id, condition) where not is_unique;

-- ───────────────────────── Positions de stock (ce qu'on possède) ─────────────────────────

create table stock_items (
  id                 uuid primary key default gen_random_uuid(),
  unit_sku           text not null unique,
  kind               stock_kind not null,
  offer_id           uuid references offers (id),
  bulk_descriptor_id uuid references bulk_descriptors (id),
  location_id        uuid not null references locations (id),
  acquisition_lot_id uuid references acquisition_lots (id),
  unit_cost_cents    integer not null default 0 check (unit_cost_cents >= 0),
  on_hand            integer not null default 0,
  reserved           integer not null default 0,  -- projection de Σ allocations actives
  inspection         integer not null default 0,
  quarantine         integer not null default 0,
  lifecycle          stock_lifecycle not null default 'DRAFT',
  version            integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint stock_counters_non_negative
    check (on_hand >= 0 and reserved >= 0 and inspection >= 0 and quarantine >= 0),
  -- Garantie de niveau base : available_to_sell = on_hand − reserved − inspection − quarantine ≥ 0
  constraint stock_available_non_negative
    check (reserved + inspection + quarantine <= on_hand),
  constraint stock_unique_at_most_one
    check (kind <> 'UNIQUE' or on_hand <= 1),
  constraint stock_bulk_shape
    check ((kind = 'BULK') = (offer_id is null) and (kind = 'BULK') = (bulk_descriptor_id is not null))
);

create index stock_items_offer_idx on stock_items (offer_id) where offer_id is not null;
create index stock_items_location_idx on stock_items (location_id);
-- Une offre unique ne référence qu'une seule position.
create unique index stock_items_one_unique_per_offer on stock_items (offer_id) where kind = 'UNIQUE';

-- Cohérence offre.is_unique ⇔ position.kind = UNIQUE.
create function check_stock_item_offer() returns trigger language plpgsql as $$
declare
  v_unique boolean;
begin
  if new.offer_id is null then
    return new;
  end if;
  select is_unique into v_unique from offers where id = new.offer_id;
  if v_unique is distinct from (new.kind = 'UNIQUE') then
    raise exception 'stock item kind % is incompatible with offer is_unique=%', new.kind, v_unique
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger stock_items_offer_consistency
  before insert or update of offer_id, kind on stock_items
  for each row execute function check_stock_item_offer();

create view offer_availability as
select
  o.id        as offer_id,
  o.offer_sku,
  o.status    as offer_status,
  coalesce(sum(s.on_hand - s.reserved - s.inspection - s.quarantine)
           filter (where s.lifecycle = 'ACTIVE'), 0)::integer as available_to_sell,
  coalesce(sum(s.on_hand), 0)::integer  as on_hand,
  coalesce(sum(s.reserved), 0)::integer as reserved,
  count(s.id) filter (where s.lifecycle = 'ACTIVE')::integer as active_positions
from offers o
left join stock_items s on s.offer_id = o.id
group by o.id;

-- ───────────────────────── Commandes ─────────────────────────

create table orders (
  id                 uuid primary key default gen_random_uuid(),
  channel            text not null,
  external_id        text not null,
  payment_status     text not null,
  fulfillment_status text not null default 'PENDING',
  oversold           boolean not null default false,
  gross_cents        integer not null check (gross_cents >= 0),
  currency           char(3) not null,
  shipping_address   jsonb,                  -- données personnelles : accès restreint, purge RGPD
  ordered_at         timestamptz not null,
  ship_by            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (channel, external_id)
);

create table order_lines (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders (id),
  offer_id            uuid not null references offers (id),
  external_line_id    text not null,
  qty                 integer not null check (qty > 0),
  unit_price_cents    integer not null check (unit_price_cents >= 0),
  fee_allocated_cents integer not null default 0,
  unique (order_id, external_line_id)
);

create table order_allocations (
  id            uuid primary key default gen_random_uuid(),
  order_line_id uuid not null references order_lines (id),
  stock_item_id uuid not null references stock_items (id),
  qty           integer not null check (qty > 0),
  status        allocation_status not null default 'RESERVED',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index order_allocations_line_idx on order_allocations (order_line_id);
create index order_allocations_stock_idx on order_allocations (stock_item_id) where status in ('RESERVED', 'PICKED', 'PACKED');

create table oversell_incidents (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders (id),
  order_line_id  uuid not null references order_lines (id),
  offer_id       uuid not null references offers (id),
  requested_qty  integer not null,
  available_qty  integer not null,
  cause          text,
  resolution     text check (resolution is null or resolution in ('SUBSTITUTED', 'FOUND', 'CANCELLED')),
  resolved_at    timestamptz,
  penalty_note   text,
  created_at     timestamptz not null default now()
);

-- ───────────────────────── Journal des mouvements (append-only) ─────────────────────────

create table inventory_movements (
  id                  bigint generated always as identity primary key,
  stock_item_id       uuid not null references stock_items (id),
  movement_type       movement_type not null,
  bucket              stock_bucket,           -- null pour les mouvements sans effet de quantité (MOVE, PICK)
  qty_delta           integer not null,
  from_location_id    uuid references locations (id),
  to_location_id      uuid references locations (id),
  order_allocation_id uuid references order_allocations (id),
  correlation_id      uuid,
  actor               text not null,
  reason              text,
  created_at          timestamptz not null default now(),
  check ((bucket is null) = (qty_delta = 0))
);

create index inventory_movements_item_idx on inventory_movements (stock_item_id, id);

create trigger inventory_movements_append_only
  before update or delete on inventory_movements
  for each statement execute function forbid_mutation();

-- ───────────────────────── Canaux ─────────────────────────

create table condition_mappings (
  id                 uuid primary key default gen_random_uuid(),
  channel            text not null,
  internal_condition card_condition not null,
  external_code      text not null,
  external_label     text,
  valid_from         date not null default current_date,
  unique (channel, internal_condition, valid_from)
);

create table listings (
  id                 uuid primary key default gen_random_uuid(),
  offer_id           uuid not null references offers (id),
  channel            text not null,
  external_id        text,
  price_cents        integer not null check (price_cents >= 0),
  currency           char(3) not null default 'EUR',
  status             text not null default 'PENDING'
                     check (status in ('PENDING', 'ACTIVE', 'PAUSED', 'ENDED', 'ERROR')),
  quantity_sent      integer not null default 0,
  quantity_confirmed integer,
  buffer             integer not null default 0 check (buffer >= 0),
  last_synced_at     timestamptz,
  error_code         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (channel, external_id)
);

create unique index listings_one_live_per_channel
  on listings (channel, offer_id) where status in ('PENDING', 'ACTIVE', 'PAUSED', 'ERROR');

-- ───────────────────────── Prix ─────────────────────────

create table price_snapshots (
  id           uuid primary key default gen_random_uuid(),
  variant_id   uuid not null references card_variants (id),
  condition    card_condition,
  source       text not null,
  quote_type   text not null check (quote_type in ('LISTED_LOW', 'LISTED_TREND', 'SOLD', 'BUYLIST', 'ESTIMATE')),
  currency     char(3) not null,
  amount_cents integer not null check (amount_cents >= 0),
  source_scope text,
  observed_at  timestamptz not null,
  ingested_at  timestamptz not null default now()
);

create index price_snapshots_lookup_idx on price_snapshots (variant_id, condition, observed_at desc);

-- ───────────────────────── Expédition ─────────────────────────

create table shipments (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references orders (id),
  mode                  shipping_mode not null,
  carrier               text,
  service               text,
  tracking              text,
  label_asset_id        text,
  postage_cost_cents    integer check (postage_cost_cents is null or postage_cost_cents >= 0),
  status                text not null default 'PENDING'
                        check (status in ('PENDING', 'LABELLED', 'HANDED_OVER', 'IN_TRANSIT', 'DELIVERED', 'LOST', 'RETURNED')),
  handover_confirmed_at timestamptz,
  handover_confirmed_by text,
  first_carrier_scan_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (mode = 'LETTER_UNTRACKED' or status = 'PENDING' or tracking is not null)
);

create table print_jobs (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null,
  asset_id   text not null,
  printer    text,
  status     text not null default 'QUEUED' check (status in ('QUEUED', 'SENT', 'PRINTED', 'FAILED', 'CANCELLED')),
  attempts   integer not null default 0,
  printed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_id, asset_id)
);

-- ───────────────────────── Exploitation ─────────────────────────

create table external_sync_jobs (
  id              uuid primary key default gen_random_uuid(),
  channel         text not null,
  entity_type     text not null,
  entity_id       uuid,
  idempotency_key text not null unique,
  state           text not null default 'PENDING' check (state in ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'DEAD')),
  attempts        integer not null default 0,
  error           text,
  next_retry_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table work_sessions (
  id                uuid primary key default gen_random_uuid(),
  actor             text not null,
  activity          text not null,   -- SCAN, STORE, PUBLISH, PICK, PACK, HANDOVER, PRICE_REVIEW, EXCEPTIONS, PHYSICAL_SHIPPING
  started_at        timestamptz not null,
  ended_at          timestamptz,
  idle_excluded_s   integer not null default 0,
  items_processed   integer not null default 0,
  manual_correction boolean not null default false,
  check (ended_at is null or ended_at >= started_at)
);

create table audit_events (
  id        bigint generated always as identity primary key,
  actor     text not null,
  action    text not null,
  entity    text not null,
  entity_id text not null,
  before    jsonb,
  after     jsonb,
  at        timestamptz not null default now()
);

create trigger audit_events_append_only
  before update or delete on audit_events
  for each statement execute function forbid_mutation();

-- Outbox transactionnelle : événements écrits dans la même transaction que la mutation métier.
create table outbox_events (
  id             bigint generated always as identity primary key,
  event_type     text not null,
  aggregate_type text not null,
  aggregate_id   text not null,
  payload        jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  published_at   timestamptz
);

create index outbox_events_unpublished_idx on outbox_events (id) where published_at is null;
