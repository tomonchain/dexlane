-- Effacement d'un compte (droit à l'effacement, RGPD).
--
-- Les journaux en ajout seul (inventory_movements, audit_events, supply_movements) refusent toute modification. Seule
-- exception : la suppression des lignes d'un compte pendant son effacement, signalée par `app.erasing_account` dans
-- la transaction qui l'efface (voir eraseAccount, apps/api/src/erasure.ts). Les modifications restent interdites.
create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.erasing_account', true), '') <> '' then
    return null;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end $$;
