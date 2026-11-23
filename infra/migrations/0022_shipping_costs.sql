-- Frais d'envoi : affranchissement habituel par mode d'envoi, et fournitures (sleeve, top-loader par carte ; enveloppe par colis).
-- Une ligne unique. Ils servent à préremplir la remise et à estimer la marge d'une vente pas encore remise.
create table shipping_costs (
  id         boolean primary key default true check (id),
  settings   jsonb not null,
  updated_at timestamptz not null default now()
);

-- Coût des fournitures d'un envoi, figé à la remise avec les tarifs du moment : changer ses tarifs plus tard
-- ne réécrit pas la marge des ventes passées. Nul pour les ventes remises avant cette migration (inconnu).
alter table shipments add column supplies_cost_cents integer check (supplies_cost_cents is null or supplies_cost_cents >= 0);
