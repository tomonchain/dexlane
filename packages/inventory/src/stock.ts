import { randomUUID } from "node:crypto";
import { recordEvent, withTx, type Db } from "@dexlane/db";
import { DomainError, assertCents } from "@dexlane/shared";
import { applyDelta, availableOf, emit, recordMovement, type StockItemRow, type StockKind } from "./internal";

export interface ReceiveStockInput {
  unitSku: string;
  kind: StockKind;
  offerId?: string;
  bulkDescriptorId?: string;
  locationId: string;
  acquisitionLotId?: string;
  unitCostCents: number;
  quantity: number;
  /** ACTIVE = vendable immédiatement ; DRAFT = en attente de validation. */
  activate?: boolean;
  actor: string;
  correlationId?: string;
}

/** Entrée en stock d'une nouvelle position (spec Parcours A / B). */
export async function receiveStock(sql: Db, input: ReceiveStockInput): Promise<StockItemRow> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new DomainError("INVALID_QUANTITY", "quantity must be a positive integer");
  }
  assertCents(input.unitCostCents, "unitCostCents");
  return withTx(sql, (tx) => insertPosition(tx, input));
}

async function insertPosition(tx: Db, input: ReceiveStockInput): Promise<StockItemRow> {
  const [item] = await tx<StockItemRow[]>`
    insert into stock_items
      (unit_sku, kind, offer_id, bulk_descriptor_id, location_id, acquisition_lot_id,
       unit_cost_cents, on_hand, lifecycle)
    values
      (${input.unitSku}, ${input.kind}, ${input.offerId ?? null}, ${input.bulkDescriptorId ?? null},
       ${input.locationId}, ${input.acquisitionLotId ?? null}, ${input.unitCostCents}, 0,
       ${input.activate ? "ACTIVE" : "DRAFT"})
    returning *`;
  await applyDelta(tx, {
    stockItemId: item!.id,
    type: "RECEIVE",
    bucket: "on_hand",
    qtyDelta: input.quantity,
    toLocationId: input.locationId,
    correlationId: input.correlationId ?? null,
    actor: input.actor,
  });
  // Une carte identifiée qui entre en stock (le vrac, non identifié, ne compte pas).
  if (input.kind !== "BULK") {
    await recordEvent(tx, { type: "card_added", key: `card_added:${item!.id}`, payload: { stockItemId: item!.id, quantity: input.quantity, locationId: input.locationId } });
  }
  await emit(tx, "InventoryReceived", "stock_item", item!.id, {
    unitSku: input.unitSku,
    kind: input.kind,
    offerId: input.offerId ?? null,
    quantity: input.quantity,
  });
  return { ...item!, onHand: input.quantity };
}

/** Valide une position DRAFT : elle devient vendable. */
export async function activateStock(sql: Db, stockItemId: string, actor: string): Promise<void> {
  await withTx(sql, async (tx) => {
    const [row] = await tx<{ lifecycle: string }[]>`
      update stock_items set lifecycle = 'ACTIVE', version = version + 1, updated_at = now()
       where id = ${stockItemId} and lifecycle = 'DRAFT'
      returning lifecycle`;
    if (!row) throw new DomainError("NOT_DRAFT", "stock item not found or not in DRAFT");
    await tx`
      insert into audit_events (actor, action, entity, entity_id, before, after)
      values (${actor}, 'activate', 'stock_item', ${stockItemId},
              ${tx.json({ lifecycle: "DRAFT" })}, ${tx.json({ lifecycle: "ACTIVE" })})`;
  });
}

/** Déplace une position entière vers un autre emplacement. */
export async function moveStock(sql: Db, stockItemId: string, toLocationId: string, actor: string): Promise<void> {
  await withTx(sql, async (tx) => {
    const [item] = await tx<StockItemRow[]>`select * from stock_items where id = ${stockItemId} for update`;
    if (!item) throw new DomainError("STOCK_ITEM_NOT_FOUND", "stock item not found");
    if (item.locationId === toLocationId) return;
    await tx`update stock_items set location_id = ${toLocationId}, version = version + 1, updated_at = now()
              where id = ${stockItemId}`;
    const movementId = await recordMovement(tx, {
      stockItemId,
      type: "MOVE",
      fromLocationId: item.locationId,
      toLocationId,
      actor,
    });
    await recordEvent(tx, { type: "location_set", key: `location_set:${movementId}`, payload: { stockItemId, locationId: toLocationId } });
    await emit(tx, "InventoryMoved", "stock_item", stockItemId, { from: item.locationId, to: toLocationId });
  });
}

export interface BulkExtractInput {
  bulkStockItemId: string;
  quantity: number;
  target: Omit<ReceiveStockInput, "quantity" | "actor" | "acquisitionLotId" | "unitCostCents" | "correlationId"> & {
    /** Par défaut : coût unitaire du lot de vrac d'origine. */
    unitCostCents?: number;
  };
  actor: string;
}

/**
 * Sort des cartes d'un lot de vrac vers une nouvelle position individualisée (spec Parcours B.5).
 * Les deux mouvements partagent un correlation_id et la même transaction.
 */
export async function extractFromBulk(sql: Db, input: BulkExtractInput): Promise<StockItemRow> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new DomainError("INVALID_QUANTITY", "quantity must be a positive integer");
  }
  if (input.target.kind === "BULK") {
    throw new DomainError("INVALID_TARGET", "bulk extraction must target a UNIQUE or FUNGIBLE position");
  }
  return withTx(sql, async (tx) => {
    const [bulk] = await tx<StockItemRow[]>`select * from stock_items where id = ${input.bulkStockItemId} for update`;
    if (!bulk || bulk.kind !== "BULK") throw new DomainError("NOT_BULK", "source is not a bulk position");
    if (availableOf(bulk) < input.quantity) {
      throw new DomainError("INSUFFICIENT_STOCK", "not enough available cards in bulk lot", {
        available: availableOf(bulk),
        requested: input.quantity,
      });
    }
    const correlationId = randomUUID();
    await applyDelta(tx, {
      stockItemId: bulk.id,
      type: "BULK_EXTRACT",
      bucket: "on_hand",
      qtyDelta: -input.quantity,
      fromLocationId: bulk.locationId,
      correlationId,
      actor: input.actor,
    });
    if (bulk.onHand - input.quantity === 0) {
      await tx`update stock_items set lifecycle = 'ARCHIVED' where id = ${bulk.id}`;
    }
    return insertPosition(tx, {
      ...input.target,
      quantity: input.quantity,
      unitCostCents: input.target.unitCostCents ?? bulk.unitCostCents,
      acquisitionLotId: bulk.acquisitionLotId ?? undefined,
      correlationId,
      actor: input.actor,
    });
  });
}

export interface AdjustStockInput {
  stockItemId: string;
  /** Quantité physiquement comptée à l'emplacement (valeur absolue, pas un écart). */
  countedOnHand: number;
  /** Obligatoire : toute correction est justifiée et auditée. */
  reason: string;
  actor: string;
}

/**
 * Correction d'inventaire après comptage physique (spec 4.2 « réconciliation par scan physique »).
 * Journalise un mouvement `ADJUST` de l'écart et un événement d'audit avant/après.
 * Refuse de descendre sous les quantités engagées (réservées, en inspection, en quarantaine) :
 * une carte réservée introuvable relève du Parcours F, pas d'une correction silencieuse.
 */
export async function adjustStock(sql: Db, input: AdjustStockInput): Promise<StockItemRow> {
  if (!Number.isInteger(input.countedOnHand) || input.countedOnHand < 0) {
    throw new DomainError("INVALID_QUANTITY", "countedOnHand must be a non-negative integer");
  }
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("REASON_REQUIRED", "an inventory adjustment needs a reason");
  return withTx(sql, async (tx) => {
    const [item] = await tx<StockItemRow[]>`select * from stock_items where id = ${input.stockItemId} for update`;
    if (!item) throw new DomainError("STOCK_ITEM_NOT_FOUND", "stock item not found");
    const delta = input.countedOnHand - item.onHand;
    if (delta === 0) return item;
    const committed = item.onHand - availableOf(item);
    if (input.countedOnHand < committed) {
      throw new DomainError("ADJUST_BELOW_COMMITTED", "counted quantity is lower than reserved/inspection/quarantine quantities", {
        counted: input.countedOnHand,
        reserved: item.reserved,
        inspection: item.inspection,
        quarantine: item.quarantine,
      });
    }
    if (item.kind === "UNIQUE" && input.countedOnHand > 1) {
      throw new DomainError("INVALID_QUANTITY", "a unique position holds at most one card");
    }
    await applyDelta(tx, {
      stockItemId: item.id, type: "ADJUST", bucket: "on_hand", qtyDelta: delta, actor: input.actor, reason,
    });
    // Position vidée → archivée ; exemplaire retrouvé sur une position archivée → de nouveau active.
    const lifecycle =
      input.countedOnHand === 0 && item.lifecycle === "ACTIVE" ? "ARCHIVED"
      : input.countedOnHand > 0 && item.lifecycle === "ARCHIVED" ? "ACTIVE"
      : item.lifecycle;
    if (lifecycle !== item.lifecycle) await tx`update stock_items set lifecycle = ${lifecycle} where id = ${item.id}`;
    await tx`
      insert into audit_events (actor, action, entity, entity_id, before, after)
      values (${input.actor}, 'adjust', 'stock_item', ${item.id},
              ${tx.json({ onHand: item.onHand, lifecycle: item.lifecycle })},
              ${tx.json({ onHand: input.countedOnHand, lifecycle, reason })})`;
    await emit(tx, "InventoryAdjusted", "stock_item", item.id, { delta, countedOnHand: input.countedOnHand, reason });
    return { ...item, onHand: input.countedOnHand, lifecycle };
  });
}

export interface OfferAvailability {
  offerId: string;
  offerSku: string;
  offerStatus: string;
  availableToSell: number;
  onHand: number;
  reserved: number;
  activePositions: number;
}

export async function getOfferAvailability(sql: Db, offerId: string): Promise<OfferAvailability> {
  const [row] = await sql<OfferAvailability[]>`select * from offer_availability where offer_id = ${offerId}`;
  if (!row) throw new DomainError("OFFER_NOT_FOUND", "offer not found");
  return row;
}

export async function findStockBySku(sql: Db, unitSku: string) {
  const [row] = await sql<(StockItemRow & { locationCode: string })[]>`
    select s.*, l.code as location_code
      from stock_items s join locations l on l.id = s.location_id
     where s.unit_sku = ${unitSku}`;
  return row ?? null;
}
