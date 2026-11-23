-- Achats : cartes suivies pour leur prix, et prix du marché TCGplayer (en dollars) à côté des cotes Cardmarket.

-- 'MARKET' : prix du marché TCGplayer, calculé par la plateforme d'après ses ventes récentes (source tcgplayer_via_tcgdex, USD).
alter table price_snapshots drop constraint price_snapshots_quote_type_check;
alter table price_snapshots add constraint price_snapshots_quote_type_check check (quote_type in (
  'LISTED_LOW', 'LISTED_TREND', 'SOLD', 'SOLD_AVG_1D', 'SOLD_AVG_7D', 'SOLD_AVG_30D', 'BUYLIST', 'ESTIMATE', 'MARKET'
));

-- Une carte suivie, avec un prix cible d'achat facultatif : l'alerte se déclenche quand l'annonce la moins chère
-- de Cardmarket passe dessous. Ses cotes sont relevées chaque jour, comme celles du stock.
create table watched_cards (
  id           uuid primary key default gen_random_uuid(),
  variant_id   uuid not null unique references card_variants (id),
  target_cents integer check (target_cents is null or target_cents > 0),
  note         text,
  created_at   timestamptz not null default now()
);

-- Les bonnes affaires ne regardent que les relevés récents : accès par date d'observation.
create index price_snapshots_observed_idx on price_snapshots (observed_at);
