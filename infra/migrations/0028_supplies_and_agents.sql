-- Fournitures d'expédition (sleeves, top-loaders, enveloppes…) : quantités en stock, consommation automatique à la
-- remise d'un envoi, seuil de commande. Et jetons d'accès des agents (serveur MCP).

create table supplies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) between 1 and 80),
  -- Consommée à chaque remise : par carte envoyée, par envoi, ou jamais (comptée à la main).
  usage            text not null default 'MANUAL' check (usage in ('PER_CARD', 'PER_SHIPMENT', 'MANUAL')),
  -- Quantité consommée par carte ou par envoi.
  per_use          integer not null default 1 check (per_use between 1 and 100),
  -- Modes d'envoi concernés (une enveloppe ne sert pas à une remise en main propre).
  modes            text[] not null default array['LETTER_UNTRACKED', 'LETTER_TRACKED', 'PARCEL_TRACKED', 'HAND_DELIVERY'],
  on_hand          integer not null default 0 check (on_hand >= 0),
  -- À ce niveau ou en dessous, il faut commander.
  reorder_point    integer not null default 0 check (reorder_point >= 0),
  -- Quantité habituellement commandée (proposée à la réception).
  reorder_quantity integer check (reorder_quantity is null or reorder_quantity > 0),
  supplier_url     text,
  -- Commande passée, pas encore reçue : l'alerte se tait jusqu'à la réception.
  ordered_at       timestamptz,
  -- Alerte envoyée pour ce passage sous le seuil ; effacée quand le stock repasse au-dessus.
  alerted_at       timestamptz,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table supply_movements (
  id          bigint generated always as identity primary key,
  supply_id   uuid not null references supplies (id),
  kind        text not null check (kind in ('RECEIVE', 'CONSUME', 'ADJUST')),
  qty_delta   integer not null,
  shipment_id uuid references shipments (id),
  actor       text not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index supply_movements_supply_idx on supply_movements (supply_id, created_at desc);

create trigger supply_movements_append_only
  before update or delete on supply_movements
  for each statement execute function forbid_mutation();

-- Jetons des agents : seule l'empreinte est gardée, le jeton n'est montré qu'à sa création.
create table agent_tokens (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) between 1 and 60),
  token_hash   text not null unique,
  -- Début du jeton, pour le reconnaître dans la liste.
  prefix       text not null,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
