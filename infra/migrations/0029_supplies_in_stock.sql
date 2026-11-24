-- Fournitures gérées comme le reste du stock : une référence libre, un prix unitaire (pour la valeur du stock)
-- et un emplacement, pris parmi les emplacements des cartes.
alter table supplies add column reference text check (reference is null or length(reference) <= 60);
alter table supplies add column unit_cost_cents integer check (unit_cost_cents is null or unit_cost_cents between 0 and 1000000);
alter table supplies add column location_id uuid references locations (id);

-- Journal des mouvements : lecture par date, toutes positions confondues.
create index inventory_movements_created_idx on inventory_movements (created_at desc, id desc);
create index supply_movements_created_idx on supply_movements (created_at desc, id desc);
