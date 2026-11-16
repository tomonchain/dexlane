-- Codes d'extension imprimés sur les cartes : officiel (« DAA ») et localisé (« TEM » en français).
-- Utilisés par l'identification quand le nom est illisible.
alter table catalog_sets add column abbreviation_localized text;

create index catalog_sets_abbreviation_idx on catalog_sets (language, upper(abbreviation));
create index catalog_sets_abbreviation_localized_idx on catalog_sets (language, upper(abbreviation_localized));
