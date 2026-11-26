import type { Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";
import { checkTimezone } from "./sql";

/** Périodes du sélecteur de la page Statistiques. */
export const PERIOD_IDS = ["this_month", "last_month", "90d", "12m"] as const;
export type PeriodId = (typeof PERIOD_IDS)[number];
export const isPeriodId = (v: string): v is PeriodId => (PERIOD_IDS as readonly string[]).includes(v);

/** Un intervalle [start, end[ en instants, avec le fuseau dans lequel il a été découpé. */
export interface Period {
  id: PeriodId | "month" | "year";
  /** « 2026-11 » pour un mois, « 2026 » pour une année ; null pour une période glissante. */
  label: string | null;
  start: Date;
  end: Date;
  timezone: string;
}

/**
 * Bornes d'une période du sélecteur, dans le fuseau de l'utilisateur : « ce mois-ci » commence le 1er à 0 h, heure
 * locale ; « 90 derniers jours », aujourd'hui compris, commence il y a 89 jours à 0 h ; « 12 derniers mois », à la même
 * date l'an dernier.
 */
export async function resolvePeriod(sql: Db, id: PeriodId, timezone: string, now = new Date()): Promise<Period> {
  const tz = checkTimezone(timezone);
  const local = sql`(${now}::timestamptz at time zone ${tz})`;
  const monthStart = sql`date_trunc('month', ${local})`;
  const bounds: Record<PeriodId, [ReturnType<Db>, ReturnType<Db>]> = {
    this_month: [sql`${monthStart} at time zone ${tz}`, sql`${now}::timestamptz`],
    last_month: [sql`(${monthStart} - interval '1 month') at time zone ${tz}`, sql`${monthStart} at time zone ${tz}`],
    "90d": [sql`(date_trunc('day', ${local}) - interval '89 days') at time zone ${tz}`, sql`${now}::timestamptz`],
    "12m": [sql`(date_trunc('day', ${local}) - interval '12 months' + interval '1 day') at time zone ${tz}`, sql`${now}::timestamptz`],
  };
  const [start, end] = bounds[id];
  const [row] = await sql<{ start: Date; end: Date }[]>`select ${start} as start, ${end} as "end"`;
  return { id, label: null, start: row!.start, end: row!.end, timezone: tz };
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR = /^(\d{4})$/;
export const isRecapPeriod = (label: string) => MONTH.test(label) || YEAR.test(label);

/** Un mois (« 2026-11 ») ou une année (« 2026 ») entiers, de 0 h le premier jour à 0 h le premier jour suivant, heure locale. */
export async function calendarPeriod(sql: Db, label: string, timezone: string): Promise<Period> {
  const tz = checkTimezone(timezone);
  const month = MONTH.exec(label);
  const year = YEAR.exec(label);
  if (!month && !year) throw new DomainError("INVALID_PERIOD", "a period is a month (YYYY-MM) or a year (YYYY)");
  const first = month ? `${month[1]}-${month[2]}-01` : `${year![1]}-01-01`;
  const step = month ? "1 month" : "1 year";
  const [row] = await sql<{ start: Date; end: Date }[]>`
    select (${first}::timestamp) at time zone ${tz} as start, (${first}::timestamp + ${step}::interval) at time zone ${tz} as "end"`;
  return { id: month ? "month" : "year", label, start: row!.start, end: row!.end, timezone: tz };
}

/** Le mois qui précède celui de `now`, dans le fuseau donné (« 2026-10 » le 1er novembre 2026). */
export function previousMonthLabel(now: Date, timezone: string): string {
  const [y, m] = localDate(now, timezone).split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** La date locale de `now` dans le fuseau donné, « AAAA-MM-JJ ». */
export function localDate(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: checkTimezone(timezone), year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
