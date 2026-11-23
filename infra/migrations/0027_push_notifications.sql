-- Notifications sur le téléphone (Web Push) : un abonnement par appareil, la paire de clés qui signe les envois,
-- et ce qui a déjà été signalé (pour ne pas répéter chaque matin la même alerte).
create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  locale     text not null default 'fr' check (locale in ('fr', 'en')),
  user_agent text,
  created_at timestamptz not null default now()
);

create table push_keys (
  id          boolean primary key default true check (id),
  public_key  text not null,
  private_key text not null,
  created_at  timestamptz not null default now()
);

create table notification_state (
  id             boolean primary key default true check (id),
  last_digest_at timestamptz not null,
  notified       jsonb not null default '{}'::jsonb
);
