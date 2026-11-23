-- Logo de la boutique, posé sur les visuels d'annonce (avec la mention « powered by Dexlane »).
alter table photos drop constraint photos_kind_check;
alter table photos add constraint photos_kind_check check (kind in ('SCAN_FRONT', 'SCAN_BACK', 'LISTING', 'BACKGROUND', 'PROMO', 'LOGO'));
