-- Mise en ligne planifiée : chaque offre reçoit un jour de publication sur un canal ; une tâche quotidienne publie ce qui est dû.
create table scheduled_publications (
  id         uuid primary key default gen_random_uuid(),
  offer_id   uuid not null references offers (id),
  channel    text not null,
  planned_on date not null,
  status     text not null default 'PENDING' check (status in ('PENDING', 'DONE', 'FAILED', 'CANCELLED')),
  -- Pourquoi la publication n'a pas eu lieu (prix manquant, canal éteint, stock épuisé…).
  error_code text,
  listing_id uuid references listings (id),
  created_at timestamptz not null default now(),
  done_at    timestamptz
);

-- Une offre n'attend qu'une publication par canal : la replanifier déplace sa date.
create unique index scheduled_publications_one_pending on scheduled_publications (offer_id, channel) where status = 'PENDING';
create index scheduled_publications_due_idx on scheduled_publications (planned_on) where status = 'PENDING';

-- Image de fin d'annonce (« on rachète vos cartes »…), ajoutée en dernière photo de chaque annonce.
alter table photos drop constraint photos_kind_check;
alter table photos add constraint photos_kind_check check (kind in ('SCAN_FRONT', 'SCAN_BACK', 'LISTING', 'BACKGROUND', 'PROMO'));
