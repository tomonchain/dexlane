import { withTx, type Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";
import { resolveLocation } from "./locations";
import { SHIPPING_MODES, type ShippingMode } from "./shipping";

/**
 * Fournitures d'expédition : ce qu'on a en stock, ce qui part à chaque envoi, et quand recommander.
 * Une fourniture « par carte » (sleeve, top-loader) ou « par envoi » (enveloppe) est décomptée automatiquement à la
 * remise d'un envoi, pour les modes d'envoi qui la concernent ; une fourniture « manuelle » se compte à la main.
 */

export const SUPPLY_USAGES = ["PER_CARD", "PER_SHIPMENT", "MANUAL"] as const;
export type SupplyUsage = (typeof SUPPLY_USAGES)[number];
export type SupplyStatus = "OK" | "LOW" | "OUT";

export interface Supply {
  id: string;
  name: string;
  usage: SupplyUsage;
  perUse: number;
  modes: ShippingMode[];
  onHand: number;
  reorderPoint: number;
  reorderQuantity: number | null;
  supplierUrl: string | null;
  /** Référence libre (celle du fournisseur, par exemple). */
  reference: string | null;
  /** Prix d'achat unitaire, en centimes ; null : non renseigné. */
  unitCostCents: number | null;
  locationCode: string | null;
  orderedAt: Date | null;
  createdAt: Date;
  /** Quantité × prix unitaire ; 0 sans prix renseigné. */
  valueCents: number;
  /** Sorties des 30 derniers jours (envois et corrections à la baisse). */
  used30Days: number;
  /** Jours de stock au rythme des 30 derniers jours ; null sans consommation. */
  daysLeft: number | null;
  /** OUT : épuisée ; LOW : au seuil de commande ou en dessous ; OK sinon. */
  status: SupplyStatus;
}

export interface SupplyMovement {
  id: string;
  kind: "RECEIVE" | "CONSUME" | "ADJUST";
  qtyDelta: number;
  shipmentId: string | null;
  actor: string;
  note: string | null;
  createdAt: Date;
}

export interface SupplyInput {
  name: string;
  usage: SupplyUsage;
  perUse: number;
  modes: ShippingMode[];
  reorderPoint: number;
  reorderQuantity: number | null;
  supplierUrl: string | null;
  reference: string | null;
  unitCostCents: number | null;
  /** Code d'un emplacement existant ; null : sans emplacement. */
  locationCode: string | null;
}

const statusOf = (onHand: number, reorderPoint: number): SupplyStatus => (onHand === 0 ? "OUT" : onHand <= reorderPoint ? "LOW" : "OK");

function check(input: Partial<SupplyInput>) {
  if (input.name !== undefined && (input.name.trim().length === 0 || input.name.trim().length > 80)) {
    throw new DomainError("INVALID_SUPPLY", "name must be 1 to 80 characters");
  }
  if (input.perUse !== undefined && (!Number.isInteger(input.perUse) || input.perUse < 1 || input.perUse > 100)) {
    throw new DomainError("INVALID_SUPPLY", "perUse must be a whole number between 1 and 100");
  }
  if (input.reorderPoint !== undefined && (!Number.isInteger(input.reorderPoint) || input.reorderPoint < 0 || input.reorderPoint > 1_000_000)) {
    throw new DomainError("INVALID_SUPPLY", "reorderPoint must be a whole number of 0 or more");
  }
  if (input.reorderQuantity != null && (!Number.isInteger(input.reorderQuantity) || input.reorderQuantity < 1 || input.reorderQuantity > 1_000_000)) {
    throw new DomainError("INVALID_SUPPLY", "reorderQuantity must be a whole number of 1 or more");
  }
  if (input.modes !== undefined && (input.modes.length === 0 || input.modes.some((m) => !SHIPPING_MODES.includes(m)))) {
    throw new DomainError("INVALID_SUPPLY", "modes must list at least one shipping mode");
  }
  if (input.supplierUrl && !/^https?:\/\/\S+$/i.test(input.supplierUrl)) {
    throw new DomainError("INVALID_SUPPLY", "supplierUrl must be an http(s) link");
  }
  if (input.unitCostCents != null && (!Number.isInteger(input.unitCostCents) || input.unitCostCents < 0 || input.unitCostCents > 1_000_000)) {
    throw new DomainError("INVALID_SUPPLY", "unitCostCents must be whole cents between 0 and 10 000 €");
  }
  if (input.reference != null && input.reference.trim().length > 60) throw new DomainError("INVALID_SUPPLY", "reference must be 60 characters at most");
}

/** Emplacement donné par son code : son identifiant, null pour « sans emplacement », inchangé si absent. */
async function locationIdOf(sql: Db, code: string | null | undefined): Promise<string | null | undefined> {
  if (code === undefined) return undefined;
  if (code === null || code.trim() === "") return null;
  return (await resolveLocation(sql, { code })).id;
}

const COLUMNS = (sql: Db) => sql`
  s.id, s.name, s.usage, s.per_use, s.modes, s.on_hand, s.reorder_point, s.reorder_quantity, s.supplier_url, s.ordered_at, s.created_at,
  s.reference, s.unit_cost_cents, (select l.code from locations l where l.id = s.location_id) as location_code,
  (select coalesce(-sum(m.qty_delta), 0)::int from supply_movements m
    where m.supply_id = s.id and m.qty_delta < 0 and m.kind <> 'RECEIVE' and m.created_at > now() - interval '30 days') as used_30_days`;

type SupplyRow = Omit<Supply, "daysLeft" | "status" | "valueCents">;
const toSupply = (row: SupplyRow): Supply => ({
  ...row,
  valueCents: row.onHand * (row.unitCostCents ?? 0),
  daysLeft: row.used30Days > 0 ? Math.floor(row.onHand / (row.used30Days / 30)) : null,
  status: statusOf(row.onHand, row.reorderPoint),
});

export interface SupplyList {
  supplies: Supply[];
  /** À commander : au seuil ou en dessous, pas encore commandées. */
  toReorder: number;
  ordered: number;
  totals: { items: number; units: number; valueCents: number };
}

/** Les fournitures actives : à commander d'abord (épuisées, puis sous le seuil), puis par nom. */
export async function listSupplies(sql: Db): Promise<SupplyList> {
  const rows = await sql<SupplyRow[]>`select ${COLUMNS(sql)} from supplies s where s.archived_at is null order by s.name`;
  const rank: Record<SupplyStatus, number> = { OUT: 0, LOW: 1, OK: 2 };
  const supplies = rows.map(toSupply).sort((a, b) => rank[a.status] - rank[b.status]);
  return {
    supplies,
    toReorder: supplies.filter((x) => x.status !== "OK" && !x.orderedAt).length,
    ordered: supplies.filter((x) => x.orderedAt).length,
    totals: {
      items: supplies.length,
      units: supplies.reduce((n, x) => n + x.onHand, 0),
      valueCents: supplies.reduce((n, x) => n + x.valueCents, 0),
    },
  };
}

export async function getSupply(sql: Db, id: string): Promise<Supply & { movements: SupplyMovement[] }> {
  const [row] = await sql<SupplyRow[]>`select ${COLUMNS(sql)} from supplies s where s.id = ${id} and s.archived_at is null`;
  if (!row) throw new DomainError("SUPPLY_NOT_FOUND", "supply not found");
  const movements = await sql<SupplyMovement[]>`
    select id::text, kind, qty_delta, shipment_id, actor, note, created_at from supply_movements
     where supply_id = ${id} order by created_at desc, id desc limit 30`;
  return { ...toSupply(row), movements };
}

export async function createSupply(sql: Db, input: SupplyInput & { onHand: number }, actor: string): Promise<Supply> {
  check(input);
  if (!Number.isInteger(input.onHand) || input.onHand < 0) throw new DomainError("INVALID_SUPPLY", "onHand must be a whole number of 0 or more");
  const locationId = await locationIdOf(sql, input.locationCode);
  const id = await withTx(sql, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into supplies (name, usage, per_use, modes, on_hand, reorder_point, reorder_quantity, supplier_url, reference, unit_cost_cents, location_id)
      values (${input.name.trim()}, ${input.usage}, ${input.perUse}, ${input.modes}, ${input.onHand}, ${input.reorderPoint},
              ${input.reorderQuantity}, ${input.supplierUrl || null}, ${input.reference?.trim() || null}, ${input.unitCostCents}, ${locationId ?? null})
      returning id`;
    if (input.onHand > 0) {
      await tx`insert into supply_movements (supply_id, kind, qty_delta, actor, note) values (${row!.id}, 'RECEIVE', ${input.onHand}, ${actor}, 'initial')`;
    }
    return row!.id;
  });
  return getSupply(sql, id);
}

export async function updateSupply(sql: Db, id: string, input: Partial<SupplyInput>): Promise<Supply> {
  check(input);
  const locationId = await locationIdOf(sql, input.locationCode);
  const [row] = await sql<{ id: string }[]>`
    update supplies set
      name = coalesce(${input.name?.trim() ?? null}, name),
      usage = coalesce(${input.usage ?? null}, usage),
      per_use = coalesce(${input.perUse ?? null}, per_use),
      modes = coalesce(${input.modes ?? null}::text[], modes),
      reorder_point = coalesce(${input.reorderPoint ?? null}, reorder_point),
      reorder_quantity = ${input.reorderQuantity === undefined ? sql`reorder_quantity` : input.reorderQuantity},
      supplier_url = ${input.supplierUrl === undefined ? sql`supplier_url` : input.supplierUrl || null},
      reference = ${input.reference === undefined ? sql`reference` : input.reference?.trim() || null},
      unit_cost_cents = ${input.unitCostCents === undefined ? sql`unit_cost_cents` : input.unitCostCents},
      location_id = ${locationId === undefined ? sql`location_id` : locationId},
      updated_at = now()
     where id = ${id} and archived_at is null
     returning id`;
  if (!row) throw new DomainError("SUPPLY_NOT_FOUND", "supply not found");
  await resetAlert(sql, id);
  return getSupply(sql, id);
}

/** Retire une fourniture de la liste ; son historique est gardé. */
export async function archiveSupply(sql: Db, id: string): Promise<void> {
  const [row] = await sql`update supplies set archived_at = now(), updated_at = now() where id = ${id} and archived_at is null returning id`;
  if (!row) throw new DomainError("SUPPLY_NOT_FOUND", "supply not found");
}

/** Le stock est repassé au-dessus du seuil : la prochaine descente sous le seuil sera de nouveau signalée. */
async function resetAlert(sql: Db, id: string) {
  await sql`update supplies set alerted_at = null where id = ${id} and on_hand > reorder_point and alerted_at is not null`;
}

async function move(sql: Db, id: string, delta: (onHand: number) => number, kind: SupplyMovement["kind"], actor: string, note: string | null, extra?: (tx: Db) => Promise<unknown>) {
  await withTx(sql, async (tx) => {
    const [row] = await tx<{ onHand: number }[]>`select on_hand from supplies where id = ${id} and archived_at is null for update`;
    if (!row) throw new DomainError("SUPPLY_NOT_FOUND", "supply not found");
    const change = delta(row.onHand);
    if (row.onHand + change < 0) throw new DomainError("INVALID_QUANTITY", "the count cannot go below zero");
    if (change !== 0) {
      await tx`update supplies set on_hand = on_hand + ${change}, updated_at = now() where id = ${id}`;
      await tx`insert into supply_movements (supply_id, kind, qty_delta, actor, note) values (${id}, ${kind}, ${change}, ${actor}, ${note})`;
    }
    await extra?.(tx);
  });
  await resetAlert(sql, id);
  return getSupply(sql, id);
}

/** Réception d'une commande : ajoute la quantité et clôt la commande en cours. */
export function receiveSupply(sql: Db, id: string, quantity: number, actor: string, note: string | null = null) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) throw new DomainError("INVALID_QUANTITY", "quantity must be a whole number of 1 or more");
  return move(sql, id, () => quantity, "RECEIVE", actor, note, (tx) => tx`update supplies set ordered_at = null where id = ${id}`);
}

/** Inventaire : le stock compté remplace le stock calculé (l'écart est gardé dans l'historique). */
export function countSupply(sql: Db, id: string, onHand: number, actor: string, note: string | null = null) {
  if (!Number.isInteger(onHand) || onHand < 0 || onHand > 1_000_000) throw new DomainError("INVALID_QUANTITY", "onHand must be a whole number of 0 or more");
  return move(sql, id, (current) => onHand - current, "ADJUST", actor, note);
}

/** Commande passée (ou annulée) : tant qu'elle n'est pas reçue, la fourniture n'est plus « à commander ». */
export async function markSupplyOrdered(sql: Db, id: string, ordered: boolean): Promise<Supply> {
  const [row] = await sql`
    update supplies set ordered_at = ${ordered ? sql`coalesce(ordered_at, now())` : null}, updated_at = now()
     where id = ${id} and archived_at is null returning id`;
  if (!row) throw new DomainError("SUPPLY_NOT_FOUND", "supply not found");
  return getSupply(sql, id);
}

/**
 * Décompte des fournitures d'un envoi remis (dans la transaction de la remise). Une fourniture épuisée reste à zéro :
 * le stock compté à la main fait foi, la remise n'est jamais bloquée pour une enveloppe.
 */
export async function consumeSupplies(tx: Db, input: { shipmentId: string; mode: ShippingMode; cards: number; actor: string }): Promise<void> {
  const used = await tx<{ id: string; qty: number }[]>`
    select id, case usage when 'PER_CARD' then per_use * ${input.cards} else per_use end as qty
      from supplies
     where archived_at is null and usage <> 'MANUAL' and ${input.mode} = any (modes)
     order by id for update`;
  for (const supply of used) {
    const [row] = await tx<{ taken: number }[]>`
      with before as (select on_hand from supplies where id = ${supply.id})
      update supplies set on_hand = greatest(on_hand - ${supply.qty}, 0), updated_at = now() where id = ${supply.id}
      returning (select on_hand from before) - on_hand as taken`;
    if (row && row.taken > 0) {
      await tx`insert into supply_movements (supply_id, kind, qty_delta, shipment_id, actor)
               values (${supply.id}, 'CONSUME', ${-row.taken}, ${input.shipmentId}, ${input.actor})`;
    }
  }
}

/**
 * Fournitures passées au seuil de commande ou en dessous, pas encore signalées ni commandées : elles sont marquées
 * comme signalées et renvoyées, pour une notification unique par passage sous le seuil.
 */
export async function takeSupplyAlerts(sql: Db): Promise<{ id: string; name: string; onHand: number }[]> {
  return sql<{ id: string; name: string; onHand: number }[]>`
    update supplies set alerted_at = now()
     where archived_at is null and ordered_at is null and alerted_at is null and on_hand <= reorder_point
     returning id, name, on_hand`;
}
