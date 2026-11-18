-- Réglages de l'application (ligne unique) : avancement de l'assistant de démarrage, façon de faire entrer les cartes.
create table app_settings (
  id         boolean primary key default true check (id),
  settings   jsonb not null,
  updated_at timestamptz not null default now()
);
