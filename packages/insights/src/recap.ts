import type { Db } from "@dexlane/db";
import { achievements as ACHIEVEMENTS } from "./config/progression";
import { calendarPeriod, localDate, previousMonthLabel } from "./period";
import { getProgress, type LevelState } from "./progression";
import { countedOrder } from "./sql";
import { sellerStats, type Amount } from "./stats";

/**
 * Récaps (#85) : le mois (« 2026-11 ») ou l'année (« 2026 ») d'un compte, figés à leur génération. Un récap n'est créé
 * que si le compte a publié ou vendu au moins une carte sur la période.
 */

export interface RecapData {
  version: 1;
  period: string;
  kind: "month" | "year";
  start: string;
  end: string;
  timezone: string;
  listingsPublished: number;
  cardsSold: number;
  revenue: Amount[];
  /** Estimation : annonces publiées × minutes gagnées par annonce. */
  timeSavedMinutes: number;
  bestSale: { name: string; setName: string | null; unitPriceCents: number; currency: string; soldAt: string } | null;
  fastestSale: { name: string; setName: string | null; days: number; soldAt: string } | null;
  /** Succès débloqués sur la période. */
  achievements: { id: string; name: string; unlockedAt: string }[];
  /** Niveau et progression vers le suivant au moment du récap. */
  level: Pick<LevelState, "level" | "next" | "progressPercent" | "confirmedSales">;
  /** Récap annuel : le mois où il s'est vendu le plus de cartes. */
  recordMonth: { month: string; cards: number } | null;
  /** Nombre de succès débloqués sur la période (le total de l'année pour un récap annuel). */
  achievementsCount: number;
}

export async function buildRecap(sql: Db, label: string, timezone: string): Promise<RecapData> {
  const period = await calendarPeriod(sql, label, timezone);
  const stats = await sellerStats(sql, period);
  const [fastest] = await sql<{ name: string; setName: string | null; days: number; soldAt: Date }[]>`
    select coalesce(off.lot_title, c.name) as name, st.name as set_name, o.ordered_at as sold_at,
           round((greatest(extract(epoch from o.ordered_at - greatest(s.created_at, fl.at)) / 86400, 0))::numeric, 1)::float8 as days
      from order_allocations a
      join stock_items s on s.id = a.stock_item_id
      join order_lines ol on ol.id = a.order_line_id
      join orders o on o.id = ol.order_id
      join offers off on off.id = ol.offer_id
      join card_variants v on v.id = off.variant_id
      join catalog_cards c on c.id = v.catalog_card_id
      left join catalog_sets st on st.id = c.set_id and st.language = c.language
      join lateral (select min(l.created_at) as at from listings l
                     where l.offer_id = ol.offer_id and not l.simulated and l.created_at <= o.ordered_at) fl on true
     where a.status <> 'RELEASED' and fl.at is not null
       and o.ordered_at >= ${period.start} and o.ordered_at < ${period.end} and ${countedOrder(sql)}
     order by days, o.ordered_at limit 1`;
  const unlocked = await sql<{ achievement: string; unlockedAt: Date }[]>`
    select achievement, unlocked_at from account_achievements
     where revoked_at is null and unlocked_at >= ${period.start} and unlocked_at < ${period.end} order by unlocked_at`;
  const progress = await getProgress(sql);
  const best = stats.topSales[0];

  let recordMonth: RecapData["recordMonth"] = null;
  if (period.id === "year") {
    const months = await sql<{ month: string; cards: number }[]>`
      select to_char(o.ordered_at at time zone ${timezone}, 'YYYY-MM') as month, sum(ol.qty)::int as cards
        from order_lines ol join orders o on o.id = ol.order_id
       where o.ordered_at >= ${period.start} and o.ordered_at < ${period.end} and ${countedOrder(sql)}
       group by 1 order by 2 desc, 1 limit 1`;
    recordMonth = months[0] ?? null;
  }

  const achievements = unlocked.map((a) => ({
    id: a.achievement, name: ACHIEVEMENTS.find((d) => d.id === a.achievement)?.name ?? a.achievement, unlockedAt: a.unlockedAt.toISOString(),
  }));
  return {
    version: 1,
    period: label,
    kind: period.id === "year" ? "year" : "month",
    start: period.start.toISOString(),
    end: period.end.toISOString(),
    timezone,
    listingsPublished: stats.timeSaved?.listings ?? 0,
    cardsSold: stats.cardsSold ?? 0,
    revenue: stats.revenue ?? [],
    timeSavedMinutes: stats.timeSaved?.minutes ?? 0,
    bestSale: best ? { name: best.name, setName: best.setName, unitPriceCents: best.unitPriceCents, currency: best.currency, soldAt: best.soldAt.toISOString() } : null,
    fastestSale: fastest ? { name: fastest.name, setName: fastest.setName, days: fastest.days, soldAt: fastest.soldAt.toISOString() } : null,
    achievements,
    level: { level: progress.level.level, next: progress.level.next, progressPercent: progress.level.progressPercent, confirmedSales: progress.level.confirmedSales },
    recordMonth,
    achievementsCount: achievements.length,
  };
}

/** Le compte a-t-il publié ou vendu au moins une carte sur la période ? Sinon, pas de récap. */
export const recapWorthIt = (r: Pick<RecapData, "listingsPublished" | "cardsSold">) => r.listingsPublished > 0 || r.cardsSold > 0;

/**
 * Génère les récaps dus : le mois précédent (le 1er du mois, ou les jours suivants si la tâche a manqué ce jour-là),
 * et l'année écoulée en janvier. Idempotent : un récap déjà généré n'est jamais refait.
 */
export async function generateDueRecaps(sql: Db, opts: { timezone: string; now?: Date }): Promise<string[]> {
  const now = opts.now ?? new Date();
  const month = previousMonthLabel(now, opts.timezone);
  const due = [month];
  if (localDate(now, opts.timezone).slice(5, 7) === "01") due.push(month.slice(0, 4));
  const created: string[] = [];
  for (const label of due) {
    const [exists] = await sql`select 1 from account_recaps where period = ${label}`;
    if (exists) continue;
    const data = await buildRecap(sql, label, opts.timezone);
    if (!recapWorthIt(data)) continue;
    const rows = await sql`
      insert into account_recaps (period, data) values (${label}, ${sql.json(data as never)})
      on conflict (account_id, period) do nothing returning period`;
    if (rows.length) created.push(label);
  }
  return created;
}

export interface RecapSummary {
  period: string;
  kind: "month" | "year";
  createdAt: Date;
  cardsSold: number;
}

export function listRecaps(sql: Db): Promise<RecapSummary[]> {
  return sql<RecapSummary[]>`
    select period, case when length(period) = 4 then 'year' else 'month' end as kind, created_at, (data->>'cardsSold')::int as cards_sold
      from account_recaps order by period desc`;
}

export async function getRecap(sql: Db, label: string): Promise<{ period: string; createdAt: Date; data: RecapData } | null> {
  const [row] = await sql<{ period: string; createdAt: Date; data: RecapData }[]>`
    select period, created_at, data from account_recaps where period = ${label}`;
  return row ?? null;
}

/** Récaps créés depuis moins de 7 jours mais pas encore annoncés par e-mail. */
export function recapsToEmail(sql: Db): Promise<{ period: string; data: RecapData }[]> {
  // Seulement les récaps récents : réactiver l'e-mail n'envoie pas d'un coup les récaps des mois passés.
  return sql<{ period: string; data: RecapData }[]>`
    select period, data from account_recaps where emailed_at is null and created_at > now() - interval '7 days' order by period`;
}

export async function markRecapEmailed(sql: Db, label: string): Promise<void> {
  await sql`update account_recaps set emailed_at = now() where period = ${label}`;
}

