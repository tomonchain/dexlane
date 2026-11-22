-- Rang d'une carte dans son plan de mise en ligne.
-- La colonne avait été ajoutée après coup dans la migration 0016, déjà appliquée sur certaines bases :
-- celles-là ne l'ont jamais reçue. Cette migration la pose partout, sans effet là où elle existe déjà.
-- Règle retenue : une migration poussée ne se modifie plus, on en écrit une nouvelle.
alter table scheduled_publications add column if not exists rank integer not null default 0;
