import type { Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";

/**
 * Livraison des envois et demandes d'avis. Le transporteur se déduit du numéro de suivi (ou se choisit à la remise) ;
 * la tâche quotidienne interroge La Poste et Mondial Relay pour les envois en route, et une livraison peut aussi se
 * noter à la main. 24 h après la livraison, la vente est « avis à demander » : un rappel part une fois, et la vente
 * le reste jusqu'à ce que la demande soit marquée faite.
 */

export const CARRIERS = ["LA_POSTE", "MONDIAL_RELAY", "OTHER"] as const;
export type Carrier = (typeof CARRIERS)[number];
export type DeliveryStatus = "HANDED_OVER" | "IN_TRANSIT" | "DELIVERED" | "RETURNED" | "LOST";

/** Délai après la livraison avant de demander un avis. */
export const REVIEW_DELAY_HOURS = 24;

/**
 * Transporteur d'après le numéro : La Poste (lettre suivie « 1K… », Colissimo « 6A… », 13 caractères ou format
 * international « LA123456789FR ») ou Mondial Relay (8 à 12 chiffres) ; null s'il n'est pas reconnu.
 */
export function detectCarrier(tracking: string | null | undefined): Carrier | null {
  const code = tracking?.replace(/\s+/g, "").toUpperCase() ?? "";
  if (!code) return null;
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code) || /^[0-9A-Z]{13}$/.test(code) && /[A-Z]/.test(code) && /\d{8,}/.test(code)) return "LA_POSTE";
  if (/^\d{8,12}$/.test(code)) return "MONDIAL_RELAY";
  return null;
}

/** Résultat d'une interrogation du transporteur. */
export interface TrackingResult {
  status: Exclude<DeliveryStatus, "HANDED_OVER" | "LOST">;
  /** Dernier événement, en clair (« Votre colis est livré »). */
  event: string | null;
  eventAt: Date | null;
  /** Date de livraison, si livré. */
  deliveredAt: Date | null;
}

export interface ShipmentToTrack {
  id: string;
  orderId: string;
  carrier: Carrier;
  tracking: string;
  /** Code postal de livraison, quand l'adresse en porte un (Mondial Relay le demande pour le suivi public). */
  postcode: string | null;
}

/** Envois en route à interroger : remis depuis moins de 45 jours, pas vus depuis `staleHours` heures. */
export async function shipmentsToTrack(sql: Db, opts: { carriers: Carrier[]; staleHours?: number; limit?: number }): Promise<ShipmentToTrack[]> {
  if (opts.carriers.length === 0) return [];
  return sql<ShipmentToTrack[]>`
    select sh.id, sh.order_id, sh.carrier, sh.tracking,
           substring(coalesce(o.shipping_address::text, '') from '\\m(\\d{5})\\M') as postcode
      from shipments sh join orders o on o.id = sh.order_id
     where sh.status in ('HANDED_OVER', 'IN_TRANSIT') and sh.tracking is not null
       and sh.carrier in ${sql(opts.carriers)}
       and sh.handover_confirmed_at > now() - interval '45 days'
       and (sh.tracking_checked_at is null or sh.tracking_checked_at < now() - make_interval(hours => ${opts.staleHours ?? 3}))
     order by sh.tracking_checked_at nulls first
     limit ${opts.limit ?? 100}`;
}

/** Enregistre ce que le transporteur a répondu ; une livraison passe la vente en « livrée ». */
export async function recordTracking(sql: Db, shipmentId: string, result: TrackingResult | null): Promise<void> {
  if (!result) {
    await sql`update shipments set tracking_checked_at = now() where id = ${shipmentId}`;
    return;
  }
  await sql`
    update shipments set status = ${result.status}, tracking_checked_at = now(),
                         tracking_event = coalesce(${result.event}, tracking_event),
                         tracking_event_at = coalesce(${result.eventAt}, tracking_event_at),
                         delivered_at = case when ${result.status} = 'DELIVERED' then coalesce(delivered_at, ${result.deliveredAt}, now()) else delivered_at end,
                         updated_at = now()
     where id = ${shipmentId} and status in ('HANDED_OVER', 'IN_TRANSIT')`;
}

async function shipmentOf(sql: Db, orderId: string) {
  const [shipment] = await sql<{ id: string; status: string; mode: string }[]>`
    select id, status, mode from shipments where order_id = ${orderId} order by created_at desc limit 1`;
  if (!shipment) throw new DomainError("SHIPMENT_NOT_FOUND", "this order has no shipment");
  return shipment;
}

/** Livraison constatée à la main (suivi absent, transporteur non relié, remise en main propre). */
export async function markDelivered(sql: Db, orderId: string, actor: string): Promise<void> {
  const shipment = await shipmentOf(sql, orderId);
  if (!["HANDED_OVER", "IN_TRANSIT", "DELIVERED"].includes(shipment.status)) {
    throw new DomainError("NOT_SHIPPED", "the order must be handed over before it can be delivered");
  }
  await sql`
    update shipments set status = 'DELIVERED', delivered_at = coalesce(delivered_at, now()), updated_at = now()
     where id = ${shipment.id}`;
  await sql`insert into audit_events (actor, action, entity, entity_id) values (${actor}, 'delivery_noted', 'shipment', ${shipment.id})`;
}

/** Corrige le transporteur ou le numéro de suivi d'un envoi. */
export async function updateTracking(sql: Db, orderId: string, input: { carrier?: Carrier | null; tracking?: string | null }): Promise<void> {
  const shipment = await shipmentOf(sql, orderId);
  const tracking = input.tracking === undefined ? undefined : input.tracking?.replace(/\s+/g, "").toUpperCase() || null;
  const carrier = input.carrier !== undefined ? input.carrier : tracking !== undefined ? detectCarrier(tracking) : undefined;
  await sql`
    update shipments set
      tracking = ${tracking === undefined ? sql`tracking` : tracking},
      carrier = ${carrier === undefined ? sql`carrier` : carrier},
      tracking_checked_at = null, updated_at = now()
     where id = ${shipment.id}`;
}

/** Demande d'avis faite (ou annulée) : la vente n'est plus « avis à demander ». */
export async function markReviewRequested(sql: Db, orderId: string, requested: boolean): Promise<void> {
  const shipment = await shipmentOf(sql, orderId);
  await sql`
    update shipments set review_requested_at = ${requested ? sql`coalesce(review_requested_at, now())` : null}, updated_at = now()
     where id = ${shipment.id}`;
}

/** Condition SQL d'une vente dont l'avis est à demander (livrée depuis 24 h, pas encore demandé). */
export const REVIEW_DUE = (sql: Db, alias = "sh") => sql`(
  ${sql(alias)}.delivered_at is not null and ${sql(alias)}.review_requested_at is null
  and ${sql(alias)}.delivered_at <= now() - make_interval(hours => ${REVIEW_DELAY_HOURS}))`;

/** Ventes dont l'avis vient d'être dû et pas encore rappelé : marquées rappelées, renvoyées pour une notification. */
export async function takeReviewReminders(sql: Db): Promise<{ orderId: string; externalId: string; buyerName: string | null; channel: string }[]> {
  return sql<{ orderId: string; externalId: string; buyerName: string | null; channel: string }[]>`
    with due as (
      update shipments sh set review_reminded_at = now()
       where ${REVIEW_DUE(sql)} and sh.review_reminded_at is null
       returning sh.order_id)
    select o.id as order_id, o.external_id, o.shipping_address->>'name' as buyer_name, o.channel
      from due join orders o on o.id = due.order_id
     order by o.ordered_at`;
}
