-- TCGdex n'a pas l'image de chaque carte dans chaque langue. Les cartes importées sans image reçoivent l'adresse de
-- l'image anglaise de la même carte (même série, même numéro) ; l'écran se rabat sur un emplacement vide si elle manque
-- aussi. Une image dans la langue de la carte, publiée plus tard, la remplace à la synchronisation suivante.
update catalog_cards c
   set image_url = 'https://assets.tcgdex.net/en/' || s.serie_id || '/' || s.id || '/' || c.local_number
  from catalog_sets s
 where c.image_url is null and s.id = c.set_id and s.language = c.language and s.serie_id is not null;
