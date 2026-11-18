-- Entrée en stock (Parcours A / B) : numérotation des SKU, vrac, recherche, idempotence de l'API.

-- unit_sku = « SI-000123 » : identifiant immuable imprimé en QR sur la position.
create sequence unit_sku_seq;

-- Un seul descripteur par combinaison série/époque/type/rareté/langue : deux lots de même nature le partagent.
create unique index bulk_descriptors_natural_key
  on bulk_descriptors (set_id, era, card_type, rarity_band, language) nulls not distinct;

-- Recherche d'inventaire : filtre par préfixe d'emplacement (« BOX-03 » → « BOX-03/ROW-12/… »), tri par date d'entrée.
create index locations_code_prefix_idx on locations (code text_pattern_ops);
create index stock_items_created_idx on stock_items (created_at desc, id);
create index offers_variant_idx on offers (variant_id);

-- Clés d'idempotence des mutations HTTP : écrites dans la même transaction que la mutation,
-- donc une requête rejouée (double appui, réseau mobile) renvoie la réponse d'origine sans rien refaire.
create table idempotency_keys (
  key          text primary key,
  scope        text not null,          -- méthode + chemin
  request_hash text not null,          -- une même clé avec un autre corps est refusée
  status       integer not null,
  response     jsonb not null,
  created_at   timestamptz not null default now()
);
