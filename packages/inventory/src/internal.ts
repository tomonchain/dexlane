import type { Db } from "@dexlane/db";

export type StockKind = "UNIQUE" | "FUNGIBLE" | "BULK";
export type StockBucket = "on_hand" | "reserved" | "inspection" | "quarantine";
export type MovementType =
  | "RECEIVE" | "MOVE" | "ALLOCATE" | "RELEASE" | "PICK" | "SHIP_OUT"
  | "RETURN_IN" | "INSPECT_OK" | "INSPECT_KO" | "QUARANTINE" | "UNQUARANTINE"
  | "BULK_EXTRACT" | "ADJUST" | "LOST" | "DISPOSED";
export type AllocationStatus = "RESERVED" | "PICKED" | "PACKED" | "SHIPPED" | "RELEASED";

export interface StockItemRow {
  id: string;
  unitSku: string;
  kind: StockKind;
  offerId: string | null;
  bulkDescriptorId: string | null;
  locationId: string;
  acquisitionLotId: string | null;
  unitCostCents: number;
  onHand: number;
  reserved: number;
  inspection: number;
  quarantine: number;
  lifecycle: "DRAFT" | "ACTIVE" | "ARCHIVED";
  createdAt: Date;
}

export interface AllocationRow {
  id: string;
  orderLineId: string;
  stockItemId: string;
  qty: number;
  status: AllocationStatus;
}

export const availableOf = (s: Pick<StockItemRow, "onHand" | "reserved" | "inspection" | "quarantine">) =>
  s.onHand - s.reserved - s.inspection - s.quarantine;

export interface MovementInput {
  stockItemId: string;
  type: MovementType;
  bucket?: StockBucket;
  qtyDelta?: number;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  orderAllocationId?: string | null;
  correlationId?: string | null;
  actor: string;
  reason?: string | null;
}

/** Ajoute une ligne au journal. N'applique PAS le delta aux compteurs : l'appelant le fait dans la même transaction. */
export async function recordMovement(tx: Db, m: MovementInput): Promise<void> {
  const qty = m.qtyDelta ?? 0;
  await tx`
    insert into inventory_movements
      (stock_item_id, movement_type, bucket, qty_delta, from_location_id, to_location_id,
       order_allocation_id, correlation_id, actor, reason)
    values
      (${m.stockItemId}, ${m.type}, ${qty === 0 ? null : (m.bucket ?? null)}, ${qty},
       ${m.fromLocationId ?? null}, ${m.toLocationId ?? null}, ${m.orderAllocationId ?? null},
       ${m.correlationId ?? null}, ${m.actor}, ${m.reason ?? null})`;
}

/** Applique un delta à un compteur et journalise le mouvement correspondant. */
export async function applyDelta(
  tx: Db,
  m: MovementInput & { bucket: StockBucket; qtyDelta: number },
): Promise<void> {
  const col = tx(m.bucket);
  await tx`
    update stock_items
       set ${col} = ${col} + ${m.qtyDelta}, version = version + 1, updated_at = now()
     where id = ${m.stockItemId}`;
  await recordMovement(tx, m);
}

export async function emit(
  tx: Db,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await tx`
    insert into outbox_events (event_type, aggregate_type, aggregate_id, payload)
    values (${eventType}, ${aggregateType}, ${aggregateId}, ${tx.json(payload as never)})`;
}
