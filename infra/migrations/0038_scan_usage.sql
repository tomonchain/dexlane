-- Quota de scans (#50) : chaque photo lue par Claude, avec son coût estimé. Sert au plafond mensuel du forfait et à la
-- limite de débit par minute ; le coût permet de suivre la dépense réelle par compte.
create table scan_usage (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null default current_account_id(),
  -- Premier jour du mois (heure de Paris) du scan.
  month       date not null,
  -- Lecture d'une carte seule ou d'une carte dans un lot scanné.
  source      text not null check (source in ('single', 'batch')),
  -- Estimation d'après le barème du modèle ; vide si la lecture a échoué ou si le modèle est inconnu.
  cost_usd    numeric(10, 5),
  created_at  timestamptz not null default now()
);
create index scan_usage_month_idx on scan_usage (account_id, month);
create index scan_usage_recent_idx on scan_usage (account_id, created_at);

alter table scan_usage enable row level security;
create policy account_isolation on scan_usage
  using (account_id = nullif(current_setting('app.account_id', true), '')::uuid)
  with check (account_id = nullif(current_setting('app.account_id', true), '')::uuid);
