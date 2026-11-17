-- Annonces : modèle de titre et de description, style des photos (ligne unique, comme les règles de prix).
create table listing_settings (
  id         boolean primary key default true check (id),
  settings   jsonb not null,
  updated_at timestamptz not null default now()
);

-- Deux nouveaux usages des photos : le fond choisi pour les visuels d'annonce,
-- et le visuel d'annonce lui-même, composé à partir d'un scan (`source_photo_id`).
alter table photos drop constraint photos_kind_check;
alter table photos add constraint photos_kind_check check (kind in ('SCAN_FRONT', 'SCAN_BACK', 'LISTING', 'BACKGROUND'));
alter table photos add column source_photo_id uuid references photos (id) on delete cascade;
-- Un seul visuel d'annonce par scan : le recomposer remplace le précédent.
create unique index photos_one_listing_per_source on photos (source_photo_id) where kind = 'LISTING';
