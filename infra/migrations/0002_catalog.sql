-- Catalogue : séries, variantes détaillées TCGdex, recherche de candidats, cotations Cardmarket.

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- unaccent() n'est pas IMMUTABLE ; enveloppe utilisable dans un index.
create function f_unaccent(text) returns text
  language sql immutable parallel safe strict
  as $$ select public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- ───────────────────────── Séries ─────────────────────────

create table catalog_sets (
  id            text not null,               -- identifiant TCGdex, identique pour toutes les langues (ex. swsh3)
  language      text not null,
  name          text not null,
  serie_id      text,
  serie_name    text,
  release_date  date,
  card_count_official integer,               -- dénominateur imprimé (« 136/189 »)
  card_count_total    integer,
  abbreviation  text,
  logo_url      text,
  symbol_url    text,
  synced_at     timestamptz not null default now(),
  primary key (id, language)
);

-- ───────────────────────── Cartes ─────────────────────────

alter table catalog_cards
  -- « 001 » → « 1 », « TG05 » → « tg5 » : comparaison avec l'OCR. Même règle que normalizeNumber() (catalog/number.ts).
  add column number_normalized text not null generated always as (
    regexp_replace(lower(regexp_replace(local_number, '\s', '', 'g')), '(^|[a-z-])0+([0-9])', '\1\2', 'g')
  ) stored,
  add column category text,                  -- Pokémon, Dresseur, Énergie
  add column source text not null default 'tcgdex',
  add column source_updated_at timestamptz,
  add column synced_at timestamptz;

create index catalog_cards_number_idx on catalog_cards (language, number_normalized);
create index catalog_cards_name_trgm_idx on catalog_cards using gin (f_unaccent(lower(name)) gin_trgm_ops);

-- ───────────────────────── Variantes ─────────────────────────

alter table card_variants
  add column subtype text not null default '',          -- ex. « sans ombre », « illimité »
  add column size text not null default 'standard',
  add column tcgdex_variant_id text,                     -- partagé entre langues : unique par carte seulement
  add column cardmarket_product_id integer,
  add column tcgplayer_product_id integer,
  -- Données incomplètes ou déduites (placeholder TCGdex, absence de variantes détaillées) :
  -- interdit la publication tant qu'un humain n'a pas confirmé.
  add column incomplete boolean not null default false;

alter table card_variants drop constraint card_variants_catalog_card_id_finish_edition_promo_stamp_key;
alter table card_variants
  add constraint card_variants_natural_key unique (catalog_card_id, finish, edition, promo, stamp, subtype, size);
create unique index card_variants_tcgdex_key on card_variants (catalog_card_id, tcgdex_variant_id)
  where tcgdex_variant_id is not null;

-- ───────────────────────── Cotations ─────────────────────────

alter table price_snapshots drop constraint price_snapshots_quote_type_check;
alter table price_snapshots add constraint price_snapshots_quote_type_check check (quote_type in (
  'LISTED_LOW',      -- prix le plus bas affiché
  'LISTED_TREND',    -- prix tendance calculé par la source
  'SOLD',            -- transaction réelle unitaire
  'SOLD_AVG_1D',     -- moyenne des ventes réalisées sur 1 / 7 / 30 jours
  'SOLD_AVG_7D',
  'SOLD_AVG_30D',
  'BUYLIST',
  'ESTIMATE'
));

alter table price_snapshots
  -- Vrai si la source ne distingue pas cette variante d'une autre (même produit, même prix) :
  -- la cotation ne doit pas servir à publier sans revue.
  add column variant_ambiguous boolean not null default false;

-- Rejouer une synchronisation ne duplique pas les cotations.
create unique index price_snapshots_dedup on price_snapshots
  (variant_id, source, quote_type, observed_at, condition) nulls not distinct;
