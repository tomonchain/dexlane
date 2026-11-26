import type { Db } from "@dexlane/db";
import type { ChannelId } from "./channel-ids";
import { todayInParis } from "./schedule";

/** Ce qui s'est passé récemment : ventes jour par jour, dernières ventes, dernières mises en ligne. */
export interface Activity {
  /** Les 30 derniers jours (calendrier de Paris), du plus ancien à aujourd'hui, jours sans vente compris. */
  days: { day: string; orders: number; grossCents: number }[];
  /** Sur ces 30 jours : ventes enregistrées hors annulations, frais de port facturés compris. */
  totals: { orders: number; grossCents: number };
  sales: {
    id: string;
    externalId: string;
    channel: string;
    orderedAt: Date;
    grossCents: number;
    buyerName: string | null;
    cards: number;
    cardNames: string[];
    /** PENDING : à préparer ; PACKED : emballée ; SHIPPED : remise. */
    fulfillmentStatus: string;
  }[];
  listings: {
    id: string;
    offerId: string;
    catalogCardId: string;
    channel: ChannelId;
    priceCents: number;
    url: string | null;
    simulated: boolean;
    listedAt: Date;
    name: string;
    setId: string;
    setName: string | null;
    localNumber: string;
    finish: string;
    edition: string;
    condition: string;
    imageUrl: string | null;
  }[];
}

/**
 * Activité pour l'accueil. Une vente compte le jour où elle est enregistrée (date de commande), pour le montant encaissé ;
 * une vente annulée ne compte pas. Une annonce compte à sa mise en ligne, tant qu'elle n'est pas retirée.
 */
export async function getActivity(sql: Db, opts: { today?: string; limit?: number } = {}): Promise<Activity> {
  const today = opts.today ?? todayInParis();
  const limit = Math.min(Math.max(opts.limit ?? 6, 1), 20);
  const [days, sales, listings] = await Promise.all([
    sql<Activity["days"]>`
      select to_char(d.day, 'YYYY-MM-DD') as day, count(o.id)::int as orders, coalesce(sum(o.gross_cents), 0)::int as gross_cents
        from generate_series(${today}::date - 29, ${today}::date, interval '1 day') as d(day)
        left join orders o on (o.ordered_at at time zone 'Europe/Paris')::date = d.day::date and o.fulfillment_status <> 'CANCELLED'
       group by d.day order by d.day`,
    sql<Activity["sales"]>`
      select o.id, o.external_id, o.channel, o.ordered_at, o.gross_cents, o.shipping_address->>'name' as buyer_name, o.fulfillment_status,
             coalesce(l.cards, 0)::int as cards, coalesce(l.card_names, '{}') as card_names
        from orders o
        left join lateral (
          select sum(ol.qty) as cards, (array_agg(coalesce(f.lot_title, c.name) order by ol.external_line_id))[1:3] as card_names
            from order_lines ol
            join offers f on f.id = ol.offer_id
            join card_variants v on v.id = f.variant_id
            join catalog_cards c on c.id = v.catalog_card_id
           where ol.order_id = o.id) l on true
       where o.fulfillment_status <> 'CANCELLED'
       order by o.ordered_at desc, o.id
       limit ${limit}`,
    sql<Activity["listings"]>`
      select l.id, l.offer_id, l.channel, l.price_cents, l.url, l.simulated, l.created_at as listed_at,
             c.id as catalog_card_id, coalesce(o.lot_title, c.name) as name, c.set_id, st.name as set_name, c.local_number, v.finish, v.edition, o.condition, c.image_url
        from listings l
        join offers o on o.id = l.offer_id
        join card_variants v on v.id = o.variant_id
        join catalog_cards c on c.id = v.catalog_card_id
        left join catalog_sets st on st.id = c.set_id and st.language = c.language
       where l.status in ('ACTIVE', 'PAUSED')
       order by l.created_at desc, l.id
       limit ${limit}`,
  ]);
  return {
    days,
    totals: { orders: days.reduce((sum, d) => sum + d.orders, 0), grossCents: days.reduce((sum, d) => sum + d.grossCents, 0) },
    sales,
    listings,
  };
}
