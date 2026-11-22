-- Pilote automatique d'un lot scanné : chaque carte reconnue sans doute entre en stock, reçoit son prix et part
-- à la mise en ligne sans attendre la revue du lot. Les cartes à vérifier restent en attente, sans bloquer les autres.
alter table scan_batches
  add column autopilot boolean not null default false,
  -- NONE : entrée en stock et prix seulement ; NOW : mise en ligne le jour même ; DAILY : au fil des jours, `publish_per_day` par jour.
  add column publish_mode text not null default 'NONE' check (publish_mode in ('NONE', 'NOW', 'DAILY')),
  add column publish_per_day integer check (publish_per_day is null or publish_per_day between 1 and 500),
  -- Sans état par défaut, aucune carte n'est complète : le pilote automatique n'aurait rien à faire.
  add constraint scan_batches_autopilot_condition check (not autopilot or default_condition is not null),
  add constraint scan_batches_daily_rate check (publish_mode <> 'DAILY' or publish_per_day is not null);
