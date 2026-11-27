import type { Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";

/**
 * Une vente qui ne compte pas : commande annulée, remboursée ou retournée (colis revenu), d'après son état ou le
 * journal d'événements. S'applique à une commande d'alias `o`.
 */
export const voidedOrder = (sql: Db) => sql`(
  o.fulfillment_status = 'CANCELLED'
  or o.payment_status in ('REFUNDED', 'CANCELLED') or o.refunded_at is not null
  or exists (select 1 from shipments sh where sh.order_id = o.id and sh.status = 'RETURNED')
  or exists (select 1 from account_events e
              where e.dedupe_key in ('sale_cancelled:' || o.id::text, 'sale_refunded:' || o.id::text, 'sale_returned:' || o.id::text))
)`;

/** Une vraie commande : pas celle de l'acheteur fictif du mode simulation (« SIM-… »). Alias `o`. */
export const realOrder = (sql: Db) => sql`o.external_id not like 'SIM-%'`;

/** Vente qui compte : vraie, ni annulée, ni remboursée, ni retournée. Alias `o`. */
export const countedOrder = (sql: Db) => sql`(${realOrder(sql)} and not ${voidedOrder(sql)})`;

/** Le fuseau donné s'il est connu du moteur JavaScript, sinon une erreur (il finit dans du SQL `at time zone`). */
export function checkTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return timezone;
  } catch {
    throw new DomainError("INVALID_TIMEZONE", `unknown time zone ${timezone}`);
  }
}

/** Médiane d'une liste de nombres (moyenne des deux du milieu pour un nombre pair) ; null si elle est vide. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
