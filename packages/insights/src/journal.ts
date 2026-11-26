import type { Db } from "@dexlane/db";

/**
 * Reconstruit le journal d'événements du compte d'après l'historique des tables métier, avec les mêmes clés que les
 * événements écrits au fil de l'eau : ce qui est déjà au journal n'est pas réécrit. Sert au lancement (comptes existants)
 * et chaque nuit, pour rattraper un événement qui aurait manqué. Renvoie le nombre d'événements ajoutés.
 */
export async function rebuildJournal(sql: Db): Promise<number> {
  const inserts = [
    // Connexion du compte eBay.
    sql`
      insert into account_events (type, dedupe_key, payload, occurred_at)
      select 'ebay_connected', 'ebay_connected:' || to_char(connected_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             jsonb_build_object('environment', environment), connected_at
        from channel_accounts where channel = 'ebay'
      on conflict (account_id, dedupe_key) do nothing`,
    // Cartes identifiées entrées en stock (une position créée).
    sql`
      insert into account_events (type, dedupe_key, payload, occurred_at)
      select 'card_added', 'card_added:' || s.id,
             jsonb_build_object('stockItemId', s.id, 'quantity', r.qty, 'locationId', r.location_id, 'rebuilt', true), r.at
        from stock_items s
        join lateral (select sum(m.qty_delta)::int as qty, min(m.created_at) as at, (array_agg(m.to_location_id order by m.id))[1] as location_id
                        from inventory_movements m
                       where m.stock_item_id = s.id and m.movement_type in ('RECEIVE', 'BULK_EXTRACT') and m.bucket = 'on_hand' and m.qty_delta > 0) r on true
       where s.kind <> 'BULK' and r.qty > 0
      on conflict (account_id, dedupe_key) do nothing`,
    // Rangements (déplacements vers un emplacement).
    sql`
      insert into account_events (type, dedupe_key, payload, occurred_at)
      select 'location_set', 'location_set:' || m.id, jsonb_build_object('stockItemId', m.stock_item_id, 'locationId', m.to_location_id, 'rebuilt', true), m.created_at
        from inventory_movements m where m.movement_type = 'MOVE' and m.to_location_id is not null
      on conflict (account_id, dedupe_key) do nothing`,
    // Annonces publiées pour de vrai.
    sql`
      insert into account_events (type, dedupe_key, payload, occurred_at)
      select 'listing_published', 'listing_published:' || l.id,
             jsonb_build_object('listingId', l.id, 'offerId', l.offer_id, 'channel', l.channel, 'rebuilt', true), l.created_at
        from listings l where not l.simulated
      on conflict (account_id, dedupe_key) do nothing`,
    // Mises en ligne planifiées en échec.
    sql`
      insert into account_events (type, dedupe_key, payload, occurred_at)
      select 'listing_failed', 'listing_failed:' || p.id,
             jsonb_build_object('offerId', p.offer_id, 'channel', p.channel, 'errorCode', p.error_code, 'rebuilt', true), coalesce(p.done_at, p.created_at)
        from scheduled_publications p where p.status = 'FAILED'
      on conflict (account_id, dedupe_key) do nothing`,
    // Ventes payées (hors acheteur fictif de la simulation).
    sql`
      insert into account_events (type, dedupe_key, payload, occurred_at)
      select 'sale_paid', 'sale_paid:' || o.id,
             jsonb_build_object('orderId', o.id, 'channel', o.channel, 'currency', o.currency,
                                'units', (select coalesce(sum(qty), 0) from order_lines where order_id = o.id), 'rebuilt', true), o.ordered_at
        from orders o where o.external_id not like 'SIM-%'
      on conflict (account_id, dedupe_key) do nothing`,
    // Annulations : la date de l'annulation au journal d'audit, à défaut la dernière mise à jour de la commande.
    sql`
      insert into account_events (type, dedupe_key, payload, occurred_at)
      select 'sale_cancelled', 'sale_cancelled:' || o.id, jsonb_build_object('orderId', o.id, 'rebuilt', true),
             coalesce((select min(a.at) from audit_events a where a.action = 'order_cancelled' and a.entity_id = o.id::text), o.updated_at)
        from orders o where o.fulfillment_status = 'CANCELLED'
      on conflict (account_id, dedupe_key) do nothing`,
    sql`
      insert into account_events (type, dedupe_key, payload, occurred_at)
      select 'sale_refunded', 'sale_refunded:' || o.id, jsonb_build_object('orderId', o.id, 'rebuilt', true), o.updated_at
        from orders o where o.payment_status = 'REFUNDED'
      on conflict (account_id, dedupe_key) do nothing`,
    sql`
      insert into account_events (type, dedupe_key, payload, occurred_at)
      select distinct on (sh.order_id) 'sale_returned', 'sale_returned:' || sh.order_id,
             jsonb_build_object('orderId', sh.order_id, 'shipmentId', sh.id, 'rebuilt', true), sh.updated_at
        from shipments sh where sh.status = 'RETURNED'
       order by sh.order_id, sh.updated_at
      on conflict (account_id, dedupe_key) do nothing`,
    // Premier bordereau imprimé de chaque commande.
    sql`
      insert into account_events (type, dedupe_key, payload, occurred_at)
      select 'slip_printed', 'slip_printed:' || o.id, jsonb_build_object('orderId', o.id, 'rebuilt', true), o.slip_printed_at
        from orders o where o.slip_printed_at is not null
      on conflict (account_id, dedupe_key) do nothing`,
  ];
  let added = 0;
  for (const insert of inserts) added += (await insert).count;
  return added;
}
