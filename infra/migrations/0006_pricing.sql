-- Prix et catégorisation des offres (spec 4.3).
-- `target_price_cents` est la décision (ce qu'on demandera) ; `suggested_price_cents` est le dernier calcul
-- du moteur de règles. Le prix décidé ne bouge jamais tout seul : un écart devient un motif de revue.
alter table offers
  add column suggested_price_cents integer check (suggested_price_cents is null or suggested_price_cents >= 0),
  -- Cotation retenue pour le calcul : montant brut, type et date, pour ne jamais présenter un prix sans sa source.
  add column reference_price_cents integer,
  add column reference_quote_type text,
  add column reference_observed_at timestamptz,
  -- NONE : jamais tarifée ; AUTO : prix posé par les règles ; MANUAL : prix décidé à la main (les règles n'y touchent plus).
  add column price_source text not null default 'NONE' check (price_source in ('NONE', 'AUTO', 'MANUAL')),
  -- Motifs de revue en cours (codes) ; vide = rien à revoir.
  add column price_reasons jsonb not null default '[]',
  add column priced_at timestamptz;

create index offers_price_review_idx on offers ((jsonb_array_length(price_reasons) > 0));

-- Règles de prix (ligne unique) : seuils de catégorie, coefficients d'état, fraîcheur exigée des cotations.
create table pricing_settings (
  id         boolean primary key default true check (id),
  settings   jsonb not null,
  updated_at timestamptz not null default now()
);
