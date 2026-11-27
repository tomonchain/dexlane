-- Frais de la marketplace et remboursements des commandes (#95, #96).
--
-- Les frais d'une commande eBay (totalMarketplaceFee) sont répartis sur ses lignes (order_lines.fee_allocated_cents) ;
-- `fees_synced_at` dit qu'ils sont connus : sans lui, une ligne à 0 € de frais est une ligne dont on ne sait rien, et
-- la marge le signale (« Frais eBay non inclus »).
alter table orders
  add column fees_synced_at timestamptz,
  -- Remboursement complet, constaté sur le canal ou noté à la main ; la vente ne compte plus (statistiques, niveau).
  add column refunded_at timestamptz;
