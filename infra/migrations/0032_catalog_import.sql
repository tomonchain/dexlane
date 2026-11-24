-- Import progressif du catalogue complet : une série tentée sans succès (aucune carte dans cette langue chez TCGdex,
-- source indisponible) n'est pas retentée avant une semaine.
alter table catalog_sets add column import_attempted_at timestamptz;
-- Rang de la série dans la liste TCGdex (chronologique) : l'import complet commence par les plus récentes.
alter table catalog_sets add column list_position integer;
