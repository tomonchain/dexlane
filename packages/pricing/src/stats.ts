import { withTx, type Db } from "@dexlane/db";
import { getInventorySummary, type InventorySummary } from "@dexlane/inventory";
import { DomainError } from "@dexlane/shared";

// ───────────────────────── Alertes de prix ─────────────────────────

export interface AlertSettings {
  /** La cote du jour est comparée à celle d'il y a au moins ce nombre de jours. */
  windowDays: number;
  /** Variation, en pourcentage, à partir de laquelle une carte est signalée. */
  percent: number;
  /** Variation minimale en centimes : évite de signaler une carte passée de 0,10 € à 0,15 €. */
  minChangeCents: number;
}
export const DEFAULT_ALERT_SETTINGS: AlertSettings = { windowDays: 7, percent: 15, minChangeCents: 100 };

export async function getAlertSettings(sql: Db): Promise<AlertSettings> {
  const [row] = await sql<{ settings: Partial<AlertSettings> }[]>`select settings from price_alert_settings`;
  return { ...DEFAULT_ALERT_SETTINGS, ...row?.settings };
}

export async function saveAlertSettings(sql: Db, settings: AlertSettings): Promise<AlertSettings> {
  const ok =
    Number.isInteger(settings.windowDays) && settings.windowDays >= 1 && settings.windowDays <= 90 &&
    settings.percent >= 1 && settings.percent <= 500 &&
    Number.isInteger(settings.minChangeCents) && settings.minChangeCents >= 0 && settings.minChangeCents <= 1_000_000;
  if (!ok) throw new DomainError("INVALID_ALERT_SETTINGS", "window must be 1 to 90 days, threshold 1 to 500 %, minimum change a positive amount");
  await sql`
    insert into price_alert_settings (settings) values (${sql.json(settings as never)})
    on conflict (id) do update set settings = excluded.settings, updated_at = now()`;
  return settings;
}

/** Variation de la cote d'une carte détenue, entre son dernier relevé et celui d'avant la fenêtre. */
export interface PriceMove {
  variantId: string;
  cardName: string;
  setId: string;
  setName: string | null;
  localNumber: string;
  imageUrl: string | null;
  finish: string;
  edition: string;
  stamp: string;
  subtype: string;
  /** Exemplaires en stock. */
  quantity: number;
  /** Prix cible le plus élevé parmi les offres de cette variante ; null si aucun n'est décidé. */
  targetPriceCents: number | null;
  latestCents: number;
  latestAt: Date;
  previousCents: number;
  previousAt: Date;
  deltaCents: number;
  deltaPercent: number;
  /** La variation dépasse les seuils d'alerte. */
  alert: boolean;
  /** Relevés des 90 derniers jours, du plus ancien au plus récent. */
  series: { at: Date; cents: number }[];
}

export interface PriceMoves {
  settings: AlertSettings;
  moves: PriceMove[];
  alerts: number;
  /** Variantes détenues, et parmi elles celles dont on a assez de relevés pour mesurer une variation. */
  ownedVariants: number;
  trackedVariants: number;
  /** Date du relevé le plus récent, toutes cartes détenues confondues. */
  latestQuoteAt: Date | null;
}

const QUOTE = "LISTED_TREND";

export function isAlert(move: Pick<PriceMove, "deltaCents" | "deltaPercent">, s: AlertSettings): boolean {
  return Math.abs(move.deltaPercent) >= s.percent && Math.abs(move.deltaCents) >= s.minChangeCents;
}

/**
 * Variations de cote (tendance Cardmarket) des cartes en stock, triées par enjeu : écart × exemplaires détenus.
 * Les alertes passent devant.
 */
export async function listPriceMoves(sql: Db, opts: { limit?: number; alertsOnly?: boolean } = {}): Promise<PriceMoves> {
  const settings = await getAlertSettings(sql);
  const rows = await sql<(Omit<PriceMove, "alert" | "series" | "deltaCents" | "deltaPercent"> & { ownedVariants: number; latestQuoteAt: Date | null })[]>`
    with owned as (
      select o.variant_id, sum(s.on_hand)::int as quantity, max(o.target_price_cents) as target_price_cents
        from stock_items s join offers o on o.id = s.offer_id
       where s.lifecycle <> 'ARCHIVED' and s.on_hand > 0
       group by o.variant_id
    ), latest as (
      select distinct on (p.variant_id) p.variant_id, p.amount_cents, p.observed_at
        from price_snapshots p join owned using (variant_id)
       where p.quote_type = ${QUOTE} and p.condition is null
       order by p.variant_id, p.observed_at desc
    ), previous as (
      select distinct on (p.variant_id) p.variant_id, p.amount_cents, p.observed_at
        from price_snapshots p join latest l using (variant_id)
       where p.quote_type = ${QUOTE} and p.condition is null and p.amount_cents > 0
         and p.observed_at <= l.observed_at - make_interval(days => ${settings.windowDays})
       order by p.variant_id, p.observed_at desc
    )
    select w.variant_id, c.name as card_name, c.set_id, st.name as set_name, c.local_number, c.image_url,
           v.finish, v.edition, v.stamp, v.subtype, w.quantity, w.target_price_cents,
           l.amount_cents as latest_cents, l.observed_at as latest_at, p.amount_cents as previous_cents, p.observed_at as previous_at,
           (select count(*)::int from owned) as owned_variants, (select max(observed_at) from latest) as latest_quote_at
      from owned w
      join latest l using (variant_id)
      join previous p using (variant_id)
      join card_variants v on v.id = w.variant_id
      join catalog_cards c on c.id = v.catalog_card_id
      left join catalog_sets st on st.id = c.set_id and st.language = c.language
     where l.amount_cents <> p.amount_cents`;
  const [totals] = rows.length
    ? [rows[0]!]
    : await sql<{ ownedVariants: number; latestQuoteAt: Date | null }[]>`
        select count(distinct o.variant_id)::int as owned_variants,
               (select max(p.observed_at) from price_snapshots p
                 where p.quote_type = ${QUOTE} and p.variant_id in (select o2.variant_id from offers o2 join stock_items s2 on s2.offer_id = o2.id where s2.on_hand > 0 and s2.lifecycle <> 'ARCHIVED')) as latest_quote_at
          from stock_items s join offers o on o.id = s.offer_id
         where s.lifecycle <> 'ARCHIVED' and s.on_hand > 0`;
  const [trackedRow] = await sql<{ tracked: number }[]>`
    select count(*)::int as tracked from (
      select p.variant_id from price_snapshots p
       where p.quote_type = ${QUOTE} and p.condition is null
         and p.variant_id in (select o.variant_id from offers o join stock_items s on s.offer_id = o.id where s.on_hand > 0 and s.lifecycle <> 'ARCHIVED')
       group by p.variant_id having count(*) >= 2) t`;
  const tracked = trackedRow?.tracked ?? 0;

  const all = rows.map(({ ownedVariants: _o, latestQuoteAt: _l, ...r }) => {
    const deltaCents = r.latestCents - r.previousCents;
    const deltaPercent = Math.round((deltaCents / r.previousCents) * 1000) / 10;
    return { ...r, deltaCents, deltaPercent, alert: isAlert({ deltaCents, deltaPercent }, settings), series: [] as PriceMove["series"] };
  });
  const impact = (m: PriceMove) => Math.abs(m.deltaCents) * m.quantity;
  all.sort((a, b) => Number(b.alert) - Number(a.alert) || impact(b) - impact(a) || a.cardName.localeCompare(b.cardName));
  const moves = (opts.alertsOnly ? all.filter((m) => m.alert) : all).slice(0, opts.limit ?? 50);

  if (moves.length > 0) {
    const points = await sql<{ variantId: string; at: Date; cents: number }[]>`
      select variant_id, observed_at as at, amount_cents as cents from price_snapshots
       where quote_type = ${QUOTE} and condition is null and variant_id in ${sql(moves.map((m) => m.variantId))}
         and observed_at >= now() - interval '90 days'
       order by observed_at`;
    for (const m of moves) m.series = points.filter((p) => p.variantId === m.variantId).map(({ at, cents }) => ({ at, cents }));
  }
  return {
    settings, moves, alerts: all.filter((m) => m.alert).length,
    ownedVariants: totals?.ownedVariants ?? 0, trackedVariants: tracked, latestQuoteAt: totals?.latestQuoteAt ?? null,
  };
}

// ───────────────────────── Tableau de bord ─────────────────────────

export interface MonthlySales {
  /** Premier jour du mois, « 2026-11 ». */
  month: string;
  orders: number;
  cards: number;
  revenueCents: number;
  /** Encaissé − coût des cartes − affranchissement. */
  marginCents: number;
}

export interface Dashboard {
  stock: InventorySummary;
  /** Valeur au prix cible (à défaut suggéré) par catégorie de vente. */
  byCategory: { category: string; cards: number; valueCents: number }[];
  /** Ventes remises, par mois, sur les six derniers mois (mois en cours compris). */
  months: MonthlySales[];
  /** Ventes remises des 90 derniers jours, par canal. */
  byChannel: { channel: string; orders: number; revenueCents: number }[];
  /** Commandes à préparer ou à remettre. */
  openOrders: number;
  topOffers: { offerSku: string; cardName: string; quantity: number; unitCents: number }[];
}

export function getDashboard(sql: Db): Promise<Dashboard> {
  return withTx(sql, async (tx) => {
    const byCategory = await tx<{ category: string; cards: number; valueCents: string }[]>`
      select o.category::text as category, sum(s.on_hand)::int as cards,
             coalesce(sum(s.on_hand::bigint * coalesce(o.target_price_cents, o.suggested_price_cents)), 0)::text as value_cents
        from stock_items s join offers o on o.id = s.offer_id
       where s.lifecycle <> 'ARCHIVED' and s.on_hand > 0
       group by o.category order by 3 desc`;
    // Une vente compte le mois où elle a été remise (comme la marge des 30 derniers jours de l'écran Ventes).
    const shipped = tx`
      select o.id, o.channel, o.gross_cents, t.shipped_at,
             (select coalesce(sum(ol.qty), 0) from order_lines ol where ol.order_id = o.id) as cards,
             (select coalesce(sum(a.qty::bigint * s.unit_cost_cents), 0)
                from order_lines ol
                join order_allocations a on a.order_line_id = ol.id and a.status = 'SHIPPED'
                join stock_items s on s.id = a.stock_item_id
               where ol.order_id = o.id) as cost_cents,
             (select coalesce(sum(sh.postage_cost_cents), 0) from shipments sh where sh.order_id = o.id) as postage_cents,
             (select coalesce(sum(sh.supplies_cost_cents), 0) from shipments sh where sh.order_id = o.id) as supplies_cents
        from orders o
        join lateral (select max(sh.handover_confirmed_at) as shipped_at from shipments sh where sh.order_id = o.id) t on true
       where o.fulfillment_status = 'SHIPPED' and t.shipped_at is not null`;
    const months = await tx<{ month: string; orders: number; cards: number; revenueCents: string; marginCents: string }[]>`
      select to_char(m.start, 'YYYY-MM') as month, count(s.id)::int as orders, coalesce(sum(s.cards), 0)::int as cards,
             coalesce(sum(s.gross_cents), 0)::text as revenue_cents,
             coalesce(sum(s.gross_cents - s.cost_cents - s.postage_cents - s.supplies_cents), 0)::text as margin_cents
        from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') as m(start)
        left join (${shipped}) s on s.shipped_at >= m.start and s.shipped_at < m.start + interval '1 month'
       group by m.start order by m.start`;
    const byChannel = await tx<{ channel: string; orders: number; revenueCents: string }[]>`
      select s.channel, count(*)::int as orders, coalesce(sum(s.gross_cents), 0)::text as revenue_cents
        from (${shipped}) s where s.shipped_at >= now() - interval '90 days'
       group by s.channel order by 3 desc`;
    const [open] = await tx<{ openOrders: number }[]>`
      select count(*)::int as open_orders from orders where fulfillment_status in ('PENDING', 'PACKED')`;
    const topOffers = await tx<Dashboard["topOffers"]>`
      select o.offer_sku, c.name as card_name, sum(s.on_hand)::int as quantity, coalesce(o.target_price_cents, o.suggested_price_cents) as unit_cents
        from stock_items s
        join offers o on o.id = s.offer_id
        join card_variants v on v.id = o.variant_id
        join catalog_cards c on c.id = v.catalog_card_id
       where s.lifecycle <> 'ARCHIVED' and s.on_hand > 0 and coalesce(o.target_price_cents, o.suggested_price_cents) is not null
       group by o.id, c.name
       order by coalesce(o.target_price_cents, o.suggested_price_cents) desc, c.name limit 5`;
    return {
      stock: await getInventorySummary(tx),
      byCategory: byCategory.map((r) => ({ ...r, valueCents: Number(r.valueCents) })),
      months: months.map((r) => ({ ...r, revenueCents: Number(r.revenueCents), marginCents: Number(r.marginCents) })),
      byChannel: byChannel.map((r) => ({ ...r, revenueCents: Number(r.revenueCents) })),
      openOrders: open?.openOrders ?? 0,
      topOffers,
    };
  });
}
