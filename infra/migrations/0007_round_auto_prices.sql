-- Arrondi des prix calculés à partir de 10 € (612,37 € → 612 €).
-- Les prix déjà posés par les règles avant cette évolution sont alignés une fois ; les prix fixés à la main
-- ne sont pas touchés. Le plancher suit à la prochaine tarification de l'offre.
update offers
   set target_price_cents = (round(target_price_cents / 100.0) * 100)::integer,
       version = version + 1, updated_at = now()
 where price_source = 'AUTO' and target_price_cents >= 1000 and target_price_cents % 100 <> 0;

update offers
   set suggested_price_cents = (round(suggested_price_cents / 100.0) * 100)::integer
 where suggested_price_cents >= 1000 and suggested_price_cents % 100 <> 0;
