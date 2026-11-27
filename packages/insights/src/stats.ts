import type { Db } from "@dexlane/db";
import { minutesSavedPerListing } from "./config/progression";
import { type Period } from "./period";
import { countedOrder, median } from "./sql";

/**
 * Les statistiques qui aident à vendre mieux (#83), sur une période découpée dans le fuseau de l'utilisateur. Sans
 * donnée sur la période, un indicateur vaut null (l'interface affiche « — », jamais 0).
 */

export interface Amount {
  currency: string;
  cents: number;
}

export interface SellerStats {
  period: Period;
  /** Prix des lignes vendues (prix × quantité), hors port ; une ligne par devise, sans conversion. */
  revenue: Amount[] | null;
  margin: {
    /** CA des lignes au prix d'achat connu − ce prix d'achat − les frais de la marketplace connus. */
    amounts: Amount[];
    /** Part des cartes vendues dont le prix d'achat est connu, en %. */
    coveragePercent: number;
    /** Des ventes eBay sont comptées sans leurs frais (pas encore synchronisés). */
    ebayFeesMissing: boolean;
  } | null;
  /** Quantités vendues ; un lot compte pour 1. */
  cardsSold: number | null;
  /** Unités vendues ÷ (en ligne au début + mises en ligne pendant la période), en %. */
  sellThroughPercent: number | null;
  /** Médiane, en jours, entre la mise en ligne et la vente, des unités vendues sur la période. */
  medianDaysToSell: number | null;
  /** Estimation : annonces publiées via Dexlane × minutes gagnées par annonce. */
  timeSaved: { listings: number; minutes: number; minutesPerListing: number } | null;
  /** Ventes par semaine ISO (lundi, heure locale), toutes les semaines de la période. */
  weekly: { week: string; cards: number; revenue: Amount[] }[];
  /** Les 10 meilleures ventes (prix unitaire). */
  topSales: TopSale[];
}

export interface TopSale {
  orderId: string;
  orderLineId: string;
  catalogCardId: string;
  name: string;
  setName: string | null;
  qty: number;
  unitPriceCents: number;
  currency: string;
  soldAt: Date;
}

interface SoldLine {
  orderLineId: string;
  orderId: string;
  qty: number;
  unitPriceCents: number;
  feeCents: number;
  /** Les frais de la commande sont connus (synchronisés depuis le canal). */
  feesKnown: boolean;
  currency: string;
  channel: string;
  orderedAt: Date;
  week: string;
  catalogCardId: string;
  name: string;
  setName: string | null;
  allocatedUnits: number;
  costCents: string;
  costKnown: boolean;
}

/** Les lignes vendues qui comptent, sur [start, end[, avec ce qu'on sait de leur prix d'achat. */
export function soldLines(sql: Db, period: Pick<Period, "start" | "end" | "timezone">) {
  return sql<SoldLine[]>`
    select ol.id as order_line_id, o.id as order_id, ol.qty, ol.unit_price_cents, ol.fee_allocated_cents as fee_cents,
           o.fees_synced_at is not null as fees_known,
           o.currency, o.channel, o.ordered_at,
           to_char(date_trunc('week', o.ordered_at at time zone ${period.timezone}), 'YYYY-MM-DD') as week,
           c.id as catalog_card_id, coalesce(off.lot_title, c.name) as name, st.name as set_name,
           coalesce(alloc.units, 0)::int as allocated_units, coalesce(alloc.cost_cents, 0)::text as cost_cents,
           -- Prix d'achat connu : chaque exemplaire vendu a un coût saisi, ou vient d'un lot d'acquisition (une
           -- collection personnelle peut valoir 0). Une ligne en survente, sans exemplaire alloué, n'a pas de coût connu.
           coalesce(alloc.units = ol.qty and alloc.known, false) as cost_known
      from order_lines ol
      join orders o on o.id = ol.order_id
      join offers off on off.id = ol.offer_id
      join card_variants v on v.id = off.variant_id
      join catalog_cards c on c.id = v.catalog_card_id
      left join catalog_sets st on st.id = c.set_id and st.language = c.language
      left join lateral (
        select sum(a.qty)::int as units, sum(a.qty::bigint * s.unit_cost_cents) as cost_cents,
               bool_and(s.unit_cost_cents > 0 or s.acquisition_lot_id is not null) as known
          from order_allocations a join stock_items s on s.id = a.stock_item_id
         where a.order_line_id = ol.id and a.status <> 'RELEASED'
      ) alloc on true
     where o.ordered_at >= ${period.start} and o.ordered_at < ${period.end} and ${countedOrder(sql)}`;
}

const byCurrency = (entries: { currency: string; cents: number }[]): Amount[] => {
  const totals = new Map<string, number>();
  for (const e of entries) totals.set(e.currency, (totals.get(e.currency) ?? 0) + e.cents);
  return [...totals].map(([currency, cents]) => ({ currency, cents })).sort((a, b) => b.cents - a.cents || a.currency.localeCompare(b.currency));
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function sellerStats(sql: Db, period: Period): Promise<SellerStats> {
  const lines = await soldLines(sql, period);

  // Délai de vente : pour chaque exemplaire vendu, de sa mise en ligne (première annonce de l'offre publiée pour de
  // vrai, ou son entrée en stock si elle est plus tardive) à la vente. Une carte vendue sans être passée en ligne n'en a pas.
  const delays = await sql<{ qty: number; days: number }[]>`
    select a.qty, greatest(extract(epoch from o.ordered_at - greatest(s.created_at, fl.at)) / 86400, 0)::float8 as days
      from order_allocations a
      join stock_items s on s.id = a.stock_item_id
      join order_lines ol on ol.id = a.order_line_id
      join orders o on o.id = ol.order_id
      join lateral (select min(l.created_at) as at from listings l
                     where l.offer_id = ol.offer_id and not l.simulated and l.created_at <= o.ordered_at) fl on true
     where a.status <> 'RELEASED' and fl.at is not null
       and o.ordered_at >= ${period.start} and o.ordered_at < ${period.end} and ${countedOrder(sql)}`;

  // Écoulement. En ligne au début : ce qui restait vendable (en main moins réservé) sur les positions dont l'offre avait
  // une annonce vivante. Mis en ligne pendant : ce qui est entré sur une position dont la mise en ligne tombe dans la période.
  const [flow] = await sql<{ atStart: number; listedDuring: number }[]>`
    with positions as (
      select s.id, s.created_at,
             (select min(l.created_at) from listings l where l.offer_id = s.offer_id and not l.simulated) as first_listed,
             exists (select 1 from listings l where l.offer_id = s.offer_id and not l.simulated and l.created_at < ${period.start}
                       and (l.status <> 'ENDED' or l.updated_at >= ${period.start})) as live_at_start
        from stock_items s where s.kind <> 'BULK' and s.offer_id is not null
    )
    select coalesce(sum(greatest(st.available, 0)) filter (where p.live_at_start), 0)::int as at_start,
           coalesce(sum(st.received) filter (where greatest(p.created_at, p.first_listed) >= ${period.start}
                                              and greatest(p.created_at, p.first_listed) < ${period.end}), 0)::int as listed_during
      from positions p
      join lateral (
        select coalesce(sum(m.qty_delta) filter (where m.bucket = 'on_hand' and m.created_at < ${period.start}), 0)
             - coalesce(sum(m.qty_delta) filter (where m.bucket = 'reserved' and m.created_at < ${period.start}), 0) as available,
               coalesce(sum(m.qty_delta) filter (where m.bucket = 'on_hand' and m.qty_delta > 0
                                                  and m.movement_type in ('RECEIVE', 'BULK_EXTRACT', 'LOT_PACK')), 0) as received
          from inventory_movements m where m.stock_item_id = p.id
      ) st on true
     where p.first_listed is not null`;

  const [published] = await sql<{ n: number }[]>`
    select count(*)::int as n from listings
     where not simulated and created_at >= ${period.start} and created_at < ${period.end}`;

  const weeks = await sql<{ week: string }[]>`
    select to_char(w, 'YYYY-MM-DD') as week
      from generate_series(date_trunc('week', ${period.start}::timestamptz at time zone ${period.timezone}),
                           date_trunc('week', (${period.end}::timestamptz - interval '1 microsecond') at time zone ${period.timezone}),
                           interval '1 week') w`;

  const units = lines.reduce((n, l) => n + l.qty, 0);
  const known = lines.filter((l) => l.costKnown);
  const knownUnits = known.reduce((n, l) => n + l.qty, 0);
  const sold = flow!;
  const denominator = sold.atStart + sold.listedDuring;
  const unitDelays = delays.flatMap((d) => Array<number>(d.qty).fill(d.days));
  const medianDays = median(unitDelays);

  return {
    period,
    revenue: lines.length ? byCurrency(lines.map((l) => ({ currency: l.currency, cents: l.qty * l.unitPriceCents }))) : null,
    margin: lines.length
      ? {
          amounts: byCurrency(known.map((l) => ({
            currency: l.currency,
            cents: l.qty * l.unitPriceCents - Number(l.costCents) - l.feeCents,
          }))),
          coveragePercent: Math.round((knownUnits / units) * 100),
          // Des ventes eBay dont les frais ne sont pas (encore) connus : la marge les compte sans frais.
          ebayFeesMissing: known.some((l) => l.channel === "ebay" && !l.feesKnown),
        }
      : null,
    cardsSold: lines.length ? units : null,
    sellThroughPercent: lines.length && denominator > 0 ? round1(Math.min(100, (units / denominator) * 100)) : null,
    medianDaysToSell: medianDays === null ? null : round1(medianDays),
    timeSaved: published!.n > 0
      ? { listings: published!.n, minutes: published!.n * minutesSavedPerListing, minutesPerListing: minutesSavedPerListing }
      : null,
    weekly: weeks.map(({ week }) => {
      const of = lines.filter((l) => l.week === week);
      return { week, cards: of.reduce((n, l) => n + l.qty, 0), revenue: byCurrency(of.map((l) => ({ currency: l.currency, cents: l.qty * l.unitPriceCents }))) };
    }),
    topSales: [...lines]
      .sort((a, b) => b.unitPriceCents - a.unitPriceCents || b.orderedAt.getTime() - a.orderedAt.getTime())
      .slice(0, 10)
      .map((l) => ({
        orderId: l.orderId, orderLineId: l.orderLineId, catalogCardId: l.catalogCardId, name: l.name, setName: l.setName,
        qty: l.qty, unitPriceCents: l.unitPriceCents, currency: l.currency, soldAt: l.orderedAt,
      })),
  };
}
