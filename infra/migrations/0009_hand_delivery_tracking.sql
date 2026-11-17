-- Une remise en main propre, comme une lettre non suivie, se confirme sans numéro de suivi.
alter table shipments drop constraint shipments_check;
alter table shipments add constraint shipments_tracking_required
  check (mode in ('LETTER_UNTRACKED', 'HAND_DELIVERY') or status = 'PENDING' or tracking is not null);
