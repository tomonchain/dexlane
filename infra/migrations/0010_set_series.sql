-- Regroupement des séries par bloc (« Soleil et Lune », « Épée et Bouclier », « Wizards »…).
-- serie_id / serie_name existaient déjà mais n'étaient connus qu'après l'import complet d'une série ;
-- la position donne l'ordre des blocs tel que la source les publie (du plus ancien au plus récent).
alter table catalog_sets add column serie_position integer;
create index catalog_sets_serie_idx on catalog_sets (language, serie_id);
