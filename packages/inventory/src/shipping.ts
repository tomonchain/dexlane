import { randomUUID } from "node:crypto";
import { withTx, type Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";
import { applyDelta, emit, type AllocationRow } from "./internal";

export type ShippingMode = "LETTER_UNTRACKED" | "LETTER_TRACKED" | "PARCEL_TRACKED";

export interface CreateShipmentInput {
  orderId: string;
  mode: ShippingMode;
  carrier?: string;
  service?: string;
  tracking?: string;
  postageCostCents?: number;
}

/** Un envoi suivi peut être créé sans numéro (étiquette à venir) mais pas déposé sans. */
export async function createShipment(sql: Db, input: CreateShipmentInput): Promise<{ id: string }> {
  const [row] = await sql<{ id: string }[]>`
    insert into shipments (order_id, mode, carrier, service, tracking, postage_cost_cents)
    values (${input.orderId}, ${input.mode}, ${input.carrier ?? null}, ${input.service ?? null},
            ${input.tracking ?? null}, ${input.postageCostCents ?? null})
    returning id`;
  return row!;
}

export type HandoverResult =
  | { shipmentId: string; status: "HANDED_OVER" | "ALREADY_HANDED_OVER" }
  | { shipmentId: string; status: "REJECTED"; code: string; message: string };

/**
 * Confirmation de dépôt (spec Parcours D.8–9) — mode nominal, y compris pour les lettres non suivies.
 * Sort les unités du stock physique : on_hand −qty et reserved −qty, allocations → SHIPPED.
 * Idempotent : reconfirmer un envoi déjà déposé ne refait rien.
 */
export function confirmHandover(sql: Db, shipmentId: string, actor: string): Promise<HandoverResult> {
  return withTx(sql, async (tx) => {
    const [shipment] = await tx<{ id: string; orderId: string; mode: ShippingMode; tracking: string | null; status: string }[]>`
      select id, order_id, mode, tracking, status from shipments where id = ${shipmentId} for update`;
    if (!shipment) throw new DomainError("SHIPMENT_NOT_FOUND", "shipment not found");
    if (shipment.status !== "PENDING" && shipment.status !== "LABELLED") {
      return { shipmentId, status: "ALREADY_HANDED_OVER" };
    }
    if (shipment.mode !== "LETTER_UNTRACKED" && !shipment.tracking) {
      throw new DomainError("TRACKING_REQUIRED", "a tracked shipment needs a tracking number before handover");
    }

    const allocs = await tx<AllocationRow[]>`
      select a.* from order_allocations a join order_lines l on l.id = a.order_line_id
       where l.order_id = ${shipment.orderId} and a.status <> 'RELEASED'
       for update of a`;
    if (allocs.length === 0) throw new DomainError("NOTHING_TO_SHIP", "order has no active allocations");
    const notPacked = allocs.filter((a) => a.status !== "PACKED");
    if (notPacked.length > 0) {
      throw new DomainError("NOT_FULLY_PACKED", "all allocations must be packed before handover", {
        allocationIds: notPacked.map((a) => a.id),
      });
    }

    // Positions verrouillées dans un ordre stable.
    const stockIds = [...new Set(allocs.map((a) => a.stockItemId))].sort();
    await tx`select id from stock_items where id in ${tx(stockIds)} order by id for update`;

    const correlationId = randomUUID();
    for (const a of allocs) {
      const common = { stockItemId: a.stockItemId, type: "SHIP_OUT" as const, orderAllocationId: a.id, correlationId, actor };
      await applyDelta(tx, { ...common, bucket: "reserved", qtyDelta: -a.qty });
      await applyDelta(tx, { ...common, bucket: "on_hand", qtyDelta: -a.qty });
    }
    await tx`update order_allocations set status = 'SHIPPED', updated_at = now() where id in ${tx(allocs.map((a) => a.id))}`;
    // Une position vide est archivée (les nouvelles entrées créent de nouvelles positions).
    await tx`update stock_items set lifecycle = 'ARCHIVED', updated_at = now()
              where id in ${tx(stockIds)} and on_hand = 0`;
    await tx`update shipments set status = 'HANDED_OVER', handover_confirmed_at = now(),
                                  handover_confirmed_by = ${actor}, updated_at = now()
              where id = ${shipmentId}`;
    await tx`update orders set fulfillment_status = 'SHIPPED', updated_at = now() where id = ${shipment.orderId}`;
    await emit(tx, "ParcelHandedOver", "shipment", shipmentId, {
      orderId: shipment.orderId,
      mode: shipment.mode,
      tracking: shipment.tracking,
    });
    return { shipmentId, status: "HANDED_OVER" };
  });
}

/** Confirmation groupée au bureau de poste : chaque envoi est traité indépendamment. */
export async function confirmHandoverBatch(sql: Db, shipmentIds: string[], actor: string): Promise<HandoverResult[]> {
  const results: HandoverResult[] = [];
  for (const id of shipmentIds) {
    try {
      results.push(await confirmHandover(sql, id, actor));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      results.push({ shipmentId: id, status: "REJECTED", code: e.code, message: e.message });
    }
  }
  return results;
}
