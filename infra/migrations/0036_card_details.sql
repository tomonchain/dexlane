-- Détails des cartes repris de TCGdex : numéro(s) de Pokédex (pour retrouver un même Pokémon d'une série à l'autre,
-- quel que soit le nom imprimé : « Dracaufeu », « Dracaufeu ex », « M Dracaufeu-EX »), illustrateur, PV, types, stade.
alter table catalog_cards
  add column dex_ids integer[],
  add column illustrator text,
  add column hp integer,
  add column types text[],
  add column stage text;

create index catalog_cards_dex_ids_idx on catalog_cards using gin (dex_ids);

-- Date de la dernière synchronisation complète d'une série. Les séries importées avant cette migration n'ont pas ces
-- détails : la tâche d'import les reprend (voir importNextSets) tant que cette date est vide.
alter table catalog_sets add column details_synced_at timestamptz;
