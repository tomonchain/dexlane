-- Canaux de vente (marketplaces). Un canal est éteint, en simulation (tout le circuit tourne, rien ne sort),
-- ou réel (connecteur configuré).
create table channel_settings (
  channel        text primary key,
  mode           text not null default 'OFF' check (mode in ('OFF', 'SIMULATION', 'LIVE')),
  last_synced_at timestamptz,
  updated_at     timestamptz not null default now()
);

alter table listings
  add column url text,
  add column title text,
  -- Annonce créée en simulation : elle n'existe pas sur le canal et disparaît quand on quitte la simulation.
  add column simulated boolean not null default false;

create sequence simulated_order_seq;
