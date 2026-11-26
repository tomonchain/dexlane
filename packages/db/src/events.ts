import type { Db } from "./index";

/**
 * Journal d'événements d'un compte (table `account_events`, migration 0036) : les faits qui comptent pour le vendeur,
 * d'où se calculent le parcours de démarrage, le niveau et les succès.
 */
export const ACCOUNT_EVENT_TYPES = [
  "ebay_connected", "card_added", "location_set", "listing_published", "listing_failed",
  "sale_paid", "sale_cancelled", "sale_refunded", "sale_returned", "slip_printed",
  "referral_qualified", "referral_discount_full",
] as const;
export type AccountEventType = (typeof ACCOUNT_EVENT_TYPES)[number];

export interface AccountEventInput {
  type: AccountEventType;
  /**
   * Ce qui identifie le fait, unique dans le compte : « listing_published:<annonce> ». Écrire deux fois la même clé
   * (événement rejoué, reconstruction d'après l'historique) ne crée rien de plus.
   */
  key: string;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
}

/** Inscrit un événement pour le compte en cours ; renvoie false s'il était déjà connu. */
export async function recordEvent(sql: Db, event: AccountEventInput): Promise<boolean> {
  const rows = await sql`
    insert into account_events (type, dedupe_key, payload, occurred_at)
    values (${event.type}, ${event.key}, ${sql.json((event.payload ?? {}) as never)}, ${event.occurredAt ?? new Date()})
    on conflict (account_id, dedupe_key) do nothing
    returning id`;
  return rows.length > 0;
}
