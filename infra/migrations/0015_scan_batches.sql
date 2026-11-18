-- Sessions de scan : un lot de cartes passé au scanner, lu carte par carte, revu puis entré en stock d'un bloc.
-- Tout est conservé côté serveur : fermer l'onglet ou recharger la page ne perd ni les lectures ni les corrections.
create table scan_batches (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  -- Où iront les cartes : une boîte par lot, dans l'ordre du scan.
  location_id        uuid not null references locations (id),
  unit_cost_cents    integer not null default 0 check (unit_cost_cents >= 0),
  acquisition_lot_id uuid references acquisition_lots (id),
  -- État appliqué aux cartes qui n'ont pas le leur.
  default_condition  card_condition,
  language           text not null default 'fr',
  -- Le scanner produit deux images par carte (recto puis verso) ; fixé à la création, l'ordre des cartes en dépend.
  paired             boolean not null default true,
  received_at        timestamptz,
  created_at         timestamptz not null default now()
);

create table scan_items (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references scan_batches (id) on delete cascade,
  -- Rang de la carte dans la pile scannée : c'est l'ordre des codes attribués à l'entrée en stock.
  position        integer not null check (position > 0),
  file_name       text not null,
  front_photo_id  uuid references photos (id),
  back_photo_id   uuid references photos (id),
  -- Ce que la lecture a rendu : carte reconnue sans doute possible, propositions, motifs de vérification.
  sure            boolean not null default false,
  candidates      jsonb not null default '[]',
  review_reasons  jsonb not null default '[]',
  scan_error      text,
  -- Ce que l'opérateur retient.
  catalog_card_id uuid references catalog_cards (id),
  variant_id      uuid references card_variants (id),
  condition       card_condition,
  skipped         boolean not null default false,
  stock_item_id   uuid references stock_items (id),
  created_at      timestamptz not null default now(),
  unique (batch_id, position)
);
