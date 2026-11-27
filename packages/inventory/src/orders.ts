import { randomUUID } from "node:crypto";
import { recordEvent, withTx, type Db } from "@dexlane/db";
import { DomainError, assertCents } from "@dexlane/shared";
import { applyDelta, availableOf, emit, recordMovement, type AllocationRow, type StockItemRow } from "./internal";
import { planAllocation } from "./plan";

// ───────────────────────── Import ─────────────────────────

/** Commande passée par l'acheteur fictif du mode simulation (numérotée « SIM-… ») : elle ne compte nulle part. */
export const isSimulatedOrder = (externalId: string) => externalId.startsWith("SIM-");

export interface ImportOrderInput {
  channel: string;
  externalId: string;
  paymentStatus: string;
  grossCents: number;
  currency: string;
  orderedAt: Date;
  shipBy?: Date;
  shippingAddress?: Record<string, unknown>;
  lines: { externalLineId: string; offerSku: string; qty: number; unitPriceCents: number }[];
}

export interface ImportOrderResult {
  orderId: string;
  created: boolean;
}

/**
 * Importe une commande de façon idempotente : un même `(channel, externalId)` reçu plusieurs fois
 * (webhook rejoué, polling qui chevauche) ne crée qu'une commande.
 */
export function importOrder(sql: Db, input: ImportOrderInput): Promise<ImportOrderResult> {
  assertCents(input.grossCents, "grossCents");
  if (input.lines.length === 0) throw new DomainError("EMPTY_ORDER", "order has no lines");
  return withTx(sql, async (tx) => {
    const [inserted] = await tx<{ id: string }[]>`
      insert into orders (channel, external_id, payment_status, gross_cents, currency, ordered_at, ship_by, shipping_address)
      values (${input.channel}, ${input.externalId}, ${input.paymentStatus}, ${input.grossCents}, ${input.currency},
              ${input.orderedAt}, ${input.shipBy ?? null},
              ${input.shippingAddress ? tx.json(input.shippingAddress as never) : null})
      on conflict (account_id, channel, external_id) do nothing
      returning id`;
    if (!inserted) {
      const [existing] = await tx<{ id: string }[]>`
        select id from orders where channel = ${input.channel} and external_id = ${input.externalId}`;
      return { orderId: existing!.id, created: false };
    }

    const skus = input.lines.map((l) => l.offerSku);
    const offers = await tx<{ id: string; offerSku: string }[]>`
      select id, offer_sku from offers where offer_sku in ${tx(skus)}`;
    const offerIdBySku = new Map(offers.map((o) => [o.offerSku, o.id]));

    for (const line of input.lines) {
      const offerId = offerIdBySku.get(line.offerSku);
      if (!offerId) {
        throw new DomainError("UNKNOWN_OFFER_SKU", `order references unknown offer ${line.offerSku}`, {
          offerSku: line.offerSku,
        });
      }
      await tx`
        insert into order_lines (order_id, offer_id, external_line_id, qty, unit_price_cents)
        values (${inserted.id}, ${offerId}, ${line.externalLineId}, ${line.qty}, ${line.unitPriceCents})`;
    }
    await emit(tx, "OrderImported", "order", inserted.id, { channel: input.channel, externalId: input.externalId });
    // Les commandes d'un acheteur fictif (simulation d'un canal) ne sont pas des ventes.
    if (!isSimulatedOrder(input.externalId)) {
      await recordEvent(tx, {
        type: "sale_paid", key: `sale_paid:${inserted.id}`, occurredAt: input.orderedAt,
        payload: { orderId: inserted.id, channel: input.channel, currency: input.currency, units: input.lines.reduce((n, l) => n + l.qty, 0) },
      });
    }
    return { orderId: inserted.id, created: true };
  });
}

// ───────────────────────── Allocation ─────────────────────────

export type AllocateResult =
  | { status: "ALLOCATED" | "ALREADY_ALLOCATED"; allocations: AllocationRow[] }
  | { status: "OVERSOLD"; incidentId: string; requested: number; available: number };

/**
 * Alloue une ligne de commande à des positions physiques (spec 4.2 « Allocation commande → stock »).
 * Tout ou rien pour la ligne. Idempotent. En cas de stock insuffisant : Parcours F (survente).
 */
export function allocateOrderLine(sql: Db, orderLineId: string, actor: string): Promise<AllocateResult> {
  return withTx(sql, async (tx) => {
    // Verrou sur la ligne : sérialise les allocations concurrentes d'une même ligne.
    const [line] = await tx<{ id: string; orderId: string; offerId: string; qty: number }[]>`
      select id, order_id, offer_id, qty from order_lines where id = ${orderLineId} for update`;
    if (!line) throw new DomainError("ORDER_LINE_NOT_FOUND", "order line not found");

    const existing = await tx<AllocationRow[]>`
      select * from order_allocations where order_line_id = ${orderLineId} and status <> 'RELEASED'`;
    if (existing.length > 0) return { status: "ALREADY_ALLOCATED", allocations: existing };

    // Verrou sur toutes les positions de l'offre, toujours dans le même ordre (évite les interblocages).
    const positions = await tx<StockItemRow[]>`
      select * from stock_items
       where offer_id = ${line.offerId} and lifecycle = 'ACTIVE'
       order by id
       for update`;

    const plan = planAllocation(
      positions.map((p) => ({ id: p.id, locationId: p.locationId, available: availableOf(p), createdAt: p.createdAt })),
      line.qty,
    );

    if (!plan) {
      const available = positions.reduce((n, p) => n + Math.max(0, availableOf(p)), 0);
      return recordOversell(tx, line, available, actor);
    }

    const correlationId = randomUUID();
    const allocations: AllocationRow[] = [];
    for (const step of plan) {
      const [alloc] = await tx<AllocationRow[]>`
        insert into order_allocations (order_line_id, stock_item_id, qty)
        values (${orderLineId}, ${step.stockItemId}, ${step.qty})
        returning *`;
      await applyDelta(tx, {
        stockItemId: step.stockItemId,
        type: "ALLOCATE",
        bucket: "reserved",
        qtyDelta: step.qty,
        orderAllocationId: alloc!.id,
        correlationId,
        actor,
      });
      allocations.push(alloc!);
    }
    await emit(tx, "StockReserved", "order_line", orderLineId, {
      orderId: line.orderId,
      offerId: line.offerId,
      allocations: allocations.map((a) => ({ id: a.id, stockItemId: a.stockItemId, qty: a.qty })),
    });
    return { status: "ALLOCATED", allocations };
  });
}

async function recordOversell(
  tx: Db,
  line: { id: string; orderId: string; offerId: string; qty: number },
  available: number,
  actor: string,
): Promise<AllocateResult> {
  await tx`update orders set oversold = true, updated_at = now() where id = ${line.orderId}`;
  // Pause immédiate de l'offre : le connecteur marketplace la passe à 0 sur tous les canaux.
  await tx`update offers set status = 'PAUSED', version = version + 1, updated_at = now()
            where id = ${line.offerId} and status = 'ACTIVE'`;
  const [incident] = await tx<{ id: string }[]>`
    insert into oversell_incidents (order_id, order_line_id, offer_id, requested_qty, available_qty)
    values (${line.orderId}, ${line.id}, ${line.offerId}, ${line.qty}, ${available})
    returning id`;
  await tx`
    insert into audit_events (actor, action, entity, entity_id, after)
    values (${actor}, 'oversell_detected', 'order_line', ${line.id},
            ${tx.json({ requested: line.qty, available, incidentId: incident!.id })})`;
  await emit(tx, "StockReservationFailed", "order_line", line.id, {
    orderId: line.orderId,
    offerId: line.offerId,
    requested: line.qty,
    available,
    incidentId: incident!.id,
    urgent: true,
  });
  return { status: "OVERSOLD", incidentId: incident!.id, requested: line.qty, available };
}

/** Alloue toutes les lignes d'une commande ; chaque ligne est indépendante (tout ou rien par ligne). */
export async function allocateOrder(sql: Db, orderId: string, actor: string) {
  const lines = await sql<{ id: string }[]>`select id from order_lines where order_id = ${orderId} order by id`;
  const results: (AllocateResult & { orderLineId: string })[] = [];
  for (const l of lines) results.push({ orderLineId: l.id, ...(await allocateOrderLine(sql, l.id, actor)) });
  return results;
}

/** Libère une allocation (annulation avant dépôt). L'article redevient vendable s'il est physiquement présent. */
export function releaseAllocation(sql: Db, allocationId: string, actor: string, reason: string): Promise<void> {
  return withTx(sql, async (tx) => {
    const alloc = await lockAllocation(tx, allocationId);
    if (alloc.status === "RELEASED") return;
    if (alloc.status === "SHIPPED") {
      throw new DomainError("ALREADY_SHIPPED", "cannot release a shipped allocation; use the return flow");
    }
    await tx`update order_allocations set status = 'RELEASED', updated_at = now() where id = ${allocationId}`;
    await applyDelta(tx, {
      stockItemId: alloc.stockItemId,
      type: "RELEASE",
      bucket: "reserved",
      qtyDelta: -alloc.qty,
      orderAllocationId: allocationId,
      actor,
      reason,
    });
  });
}

async function lockAllocation(tx: Db, allocationId: string) {
  const [alloc] = await tx<(AllocationRow & { offerId: string; orderId: string })[]>`
    select a.*, l.offer_id, l.order_id
      from order_allocations a join order_lines l on l.id = a.order_line_id
     where a.id = ${allocationId}
     for update of a`;
  if (!alloc) throw new DomainError("ALLOCATION_NOT_FOUND", "allocation not found");
  return alloc;
}

// ───────────────────────── Préparation ─────────────────────────

/**
 * Confirme le prélèvement par scan (spec Parcours D.6).
 * - Scan d'une autre offre → refusé (`WRONG_ITEM`).
 * - Scan d'une autre position de la même offre → allocation réaffectée si cette position a du disponible.
 */
export function pickAllocation(
  sql: Db,
  input: { allocationId: string; scannedUnitSku: string; actor: string },
): Promise<AllocationRow> {
  return withTx(sql, async (tx) => {
    const alloc = await lockAllocation(tx, input.allocationId);
    const [scanned] = await tx<StockItemRow[]>`select * from stock_items where unit_sku = ${input.scannedUnitSku}`;
    if (!scanned) throw new DomainError("UNKNOWN_SKU", `unknown unit SKU ${input.scannedUnitSku}`);
    if (scanned.offerId !== alloc.offerId) {
      throw new DomainError("WRONG_ITEM", "scanned item does not match the ordered offer", {
        expectedOfferId: alloc.offerId,
        scannedOfferId: scanned.offerId,
      });
    }
    if (alloc.status === "PICKED" && alloc.stockItemId === scanned.id) return alloc; // rescan idempotent
    if (alloc.status !== "RESERVED") {
      throw new DomainError("INVALID_STATE", `cannot pick an allocation in status ${alloc.status}`);
    }

    let stockItemId = alloc.stockItemId;
    if (scanned.id !== alloc.stockItemId) {
      // Verrouille les deux positions dans un ordre stable.
      const locked = await tx<StockItemRow[]>`
        select * from stock_items where id in ${tx([alloc.stockItemId, scanned.id])} order by id for update`;
      const target = locked.find((s) => s.id === scanned.id)!;
      if (target.lifecycle !== "ACTIVE" || availableOf(target) < alloc.qty) {
        throw new DomainError("SCANNED_POSITION_UNAVAILABLE", "scanned position has no free quantity for this allocation");
      }
      const correlationId = randomUUID();
      await applyDelta(tx, {
        stockItemId: alloc.stockItemId, type: "RELEASE", bucket: "reserved", qtyDelta: -alloc.qty,
        orderAllocationId: alloc.id, correlationId, actor: input.actor, reason: "picked from another position",
      });
      await applyDelta(tx, {
        stockItemId: target.id, type: "ALLOCATE", bucket: "reserved", qtyDelta: alloc.qty,
        orderAllocationId: alloc.id, correlationId, actor: input.actor, reason: "picked from another position",
      });
      stockItemId = target.id;
    }

    const [updated] = await tx<AllocationRow[]>`
      update order_allocations set status = 'PICKED', stock_item_id = ${stockItemId}, updated_at = now()
       where id = ${alloc.id} returning *`;
    await recordMovement(tx, { stockItemId, type: "PICK", orderAllocationId: alloc.id, actor: input.actor });
    await emit(tx, "PickConfirmed", "order_allocation", alloc.id, { orderId: alloc.orderId, stockItemId });
    return updated!;
  });
}

/** Marque toutes les allocations prélevées d'une commande comme emballées. */
export function packOrder(sql: Db, orderId: string, actor: string): Promise<void> {
  return withTx(sql, async (tx) => {
    const allocs = await tx<AllocationRow[]>`
      select a.* from order_allocations a join order_lines l on l.id = a.order_line_id
       where l.order_id = ${orderId} and a.status <> 'RELEASED'
       for update of a`;
    if (allocs.length === 0) throw new DomainError("NOTHING_TO_PACK", "order has no active allocations");
    const notPicked = allocs.filter((a) => a.status === "RESERVED");
    if (notPicked.length > 0) {
      throw new DomainError("NOT_FULLY_PICKED", "all allocations must be picked before packing", {
        allocationIds: notPicked.map((a) => a.id),
      });
    }
    await tx`update order_allocations set status = 'PACKED', updated_at = now()
              where id in ${tx(allocs.map((a) => a.id))} and status = 'PICKED'`;
    await tx`update orders set fulfillment_status = 'PACKED', updated_at = now() where id = ${orderId}`;
    await emit(tx, "PackagePacked", "order", orderId, { actor });
  });
}

// ───────────────────────── Frais de la marketplace ─────────────────────────

/**
 * Répartit les frais d'une commande sur ses lignes, au prorata de leur montant (méthode du plus fort reste : la somme
 * des lignes vaut exactement les frais), et note que les frais de la commande sont connus.
 */
export async function setOrderFees(sql: Db, orderId: string, feeCents: number): Promise<void> {
  assertCents(feeCents, "feeCents");
  await withTx(sql, async (tx) => {
    const lines = await tx<{ id: string; amount: number }[]>`
      select id, (qty * unit_price_cents)::int as amount from order_lines where order_id = ${orderId} order by external_line_id, id`;
    const total = lines.reduce((n, l) => n + l.amount, 0);
    const shares = lines.map((l) => {
      const exact = total === 0 ? feeCents / lines.length : (feeCents * l.amount) / total;
      return { id: l.id, cents: Math.floor(exact), rest: exact - Math.floor(exact) };
    });
    let left = feeCents - shares.reduce((n, s) => n + s.cents, 0);
    for (const s of [...shares].sort((a, b) => b.rest - a.rest)) {
      if (left <= 0) break;
      s.cents++;
      left--;
    }
    for (const s of shares) await tx`update order_lines set fee_allocated_cents = ${s.cents} where id = ${s.id}`;
    await tx`update orders set fees_synced_at = now(), updated_at = now() where id = ${orderId}`;
  });
}
