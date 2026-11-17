-- Ventes directes (hors marketplace) : numérotation, note libre, remise en main propre.
create sequence direct_order_seq;

alter table orders add column note text;

-- Une valeur d'énumération ajoutée ne peut pas servir dans la transaction qui la crée :
-- la contrainte qui l'utilise est dans la migration suivante.
alter type shipping_mode add value if not exists 'HAND_DELIVERY';
