-- Photos des exemplaires : scans (recto, verso) et visuels d'annonce.
-- Le fichier vit dans un stockage d'objets ; la base ne garde que sa référence et son rattachement.
create table photos (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('SCAN_FRONT', 'SCAN_BACK', 'LISTING')),
  storage_key   text not null unique,
  -- URL non devinable servie par le stockage (les marketplaces doivent pouvoir la télécharger).
  url           text not null,
  content_type  text not null,
  byte_size     integer not null check (byte_size > 0),
  -- Vide tant que le scan n'a pas abouti à une entrée en stock.
  stock_item_id uuid references stock_items (id),
  offer_id      uuid references offers (id),
  created_at    timestamptz not null default now()
);

create index photos_stock_item_idx on photos (stock_item_id) where stock_item_id is not null;
create index photos_offer_idx on photos (offer_id) where offer_id is not null;
