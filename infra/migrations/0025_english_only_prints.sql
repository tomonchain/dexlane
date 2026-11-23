-- TCGdex rattache aux fiches françaises (et des autres langues) des impressions qui n'existent qu'en anglais : le Set de
-- Base « sans ombre » (Shadowless) et le tirage britannique « Copyright 1999-2000 ». Elles sont retirées des catalogues
-- non anglais, sauf si une offre, un suivi ou un lot scanné s'y rapporte déjà (elles restent alors, à corriger à la main).
create temporary table english_only on commit drop as
  select v.id
    from card_variants v join catalog_cards c on c.id = v.catalog_card_id
   where c.language <> 'en' and v.subtype ~* '(sans ombre|shadowless|1999-2000)' and v.edition <> '1st'
     and not exists (select 1 from offers o where o.variant_id = v.id)
     and not exists (select 1 from watched_cards w where w.variant_id = v.id)
     and not exists (select 1 from scan_items i where i.variant_id = v.id);
delete from price_snapshots where variant_id in (select id from english_only);
delete from card_variants where id in (select id from english_only);

-- La 1re édition existe aussi dans les autres langues : elle reste, sans la mention anglaise, mais sa cote est celle de
-- l'impression anglaise. Elle est marquée partagée (jamais publiée sans revue) et le prix TCGplayer, américain, est retiré.
create temporary table borrowed on commit drop as
  select v.id
    from card_variants v join catalog_cards c on c.id = v.catalog_card_id
   where c.language <> 'en' and v.subtype ~* '(sans ombre|shadowless|1999-2000)' and v.edition = '1st'
     and not exists (select 1 from card_variants o where o.catalog_card_id = v.catalog_card_id and o.id <> v.id
                      and o.finish = v.finish and o.edition = v.edition and o.promo = v.promo and o.stamp = v.stamp
                      and o.subtype = '' and o.size = v.size);
update card_variants set attributes = attributes || jsonb_build_object('pricedFromEnglishPrint', subtype), subtype = ''
 where id in (select id from borrowed);
update price_snapshots set variant_ambiguous = true where variant_id in (select id from borrowed);
delete from price_snapshots where quote_type = 'MARKET' and variant_id in (select id from borrowed);
