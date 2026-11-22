-- Estimation d'après les ventes réussies, telle que calculée au dernier passage des règles de prix :
-- { cents, confidence, sales: [{ quoteType, amountCents }] }. Null quand la source ne rapporte aucune vente récente.
-- Conservée sur l'offre pour l'afficher partout (stock, prix, annonces) sans relire les cotations.
alter table offers add column sales_estimate jsonb;
