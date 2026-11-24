-- Suivi des livraisons et demandes d'avis : le transporteur et le dernier état connu de l'envoi, sa date de livraison,
-- et la demande d'avis à l'acheteur (rappelée 24 h après la livraison, une fois).
alter table shipments add column delivered_at timestamptz;
alter table shipments add column tracking_checked_at timestamptz;
alter table shipments add column tracking_event text;
alter table shipments add column tracking_event_at timestamptz;
alter table shipments add column review_requested_at timestamptz;
alter table shipments add column review_reminded_at timestamptz;

-- Transporteurs suivis automatiquement ; une valeur libre ancienne reste lisible.
update shipments set carrier = null where carrier is not null and carrier not in ('LA_POSTE', 'MONDIAL_RELAY', 'OTHER');
alter table shipments add constraint shipments_carrier_check check (carrier is null or carrier in ('LA_POSTE', 'MONDIAL_RELAY', 'OTHER'));

create index shipments_to_track_idx on shipments (tracking_checked_at nulls first)
  where status in ('HANDED_OVER', 'IN_TRANSIT') and tracking is not null;
create index shipments_review_due_idx on shipments (delivered_at)
  where delivered_at is not null and review_requested_at is null;
