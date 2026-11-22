-- Préparation quotidienne des envois : date d'impression du bon de livraison et du reçu d'une commande.
-- Sert à n'imprimer chaque jour que les commandes nouvelles ; réimprimer reste possible.
alter table orders add column slip_printed_at timestamptz;
