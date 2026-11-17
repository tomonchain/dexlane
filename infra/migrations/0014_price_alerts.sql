-- Alertes de variation de prix (ligne unique) : fenêtre de comparaison, seuil en pourcentage, variation minimale.
create table price_alert_settings (
  id         boolean primary key default true check (id),
  settings   jsonb not null,
  updated_at timestamptz not null default now()
);

-- Historique d'une variante par type de cotation : variations et courbes de prix.
create index price_snapshots_history_idx on price_snapshots (variant_id, quote_type, observed_at desc) where condition is null;
