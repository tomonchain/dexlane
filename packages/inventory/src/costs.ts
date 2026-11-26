import type { Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";
import { SHIPPING_MODES, type ShippingMode } from "./shipping";

/** Modes d'envoi qui passent par la poste (la remise en main propre n'a ni affranchissement ni enveloppe). */
export type PostalMode = Exclude<ShippingMode, "HAND_DELIVERY">;

export interface ShippingCosts {
  /** Affranchissement habituel par mode, en centimes ; null : non renseigné (compté 0 et signalé). */
  postage: Record<PostalMode, number | null>;
  /** Fournitures, en centimes : sleeve et top-loader par carte, enveloppe par envoi postal. */
  supplies: { sleeveCents: number; toploaderCents: number; envelopeCents: number };
}

export const DEFAULT_SHIPPING_COSTS: ShippingCosts = {
  postage: { LETTER_UNTRACKED: null, LETTER_TRACKED: null, PARCEL_TRACKED: null },
  supplies: { sleeveCents: 0, toploaderCents: 0, envelopeCents: 0 },
};

export async function getShippingCosts(sql: Db): Promise<ShippingCosts> {
  const [row] = await sql<{ settings: Partial<ShippingCosts> }[]>`select settings from shipping_costs`;
  return {
    postage: { ...DEFAULT_SHIPPING_COSTS.postage, ...row?.settings.postage },
    supplies: { ...DEFAULT_SHIPPING_COSTS.supplies, ...row?.settings.supplies },
  };
}

export async function saveShippingCosts(sql: Db, costs: ShippingCosts, actor: string): Promise<ShippingCosts> {
  const amounts = [...Object.values(costs.postage), ...Object.values(costs.supplies)];
  if (amounts.some((c) => c !== null && (!Number.isInteger(c) || c < 0 || c > 100_000))) {
    throw new DomainError("INVALID_COSTS", "costs must be whole cents between 0 and 1000 €");
  }
  await sql`
    insert into shipping_costs (settings) values (${sql.json(costs as never)})
    on conflict (account_id) do update set settings = excluded.settings, updated_at = now()`;
  await sql`
    insert into audit_events (actor, action, entity, entity_id, after)
    values (${actor}, 'shipping_costs_changed', 'shipping_costs', 'default', ${sql.json(costs as never)})`;
  return getShippingCosts(sql);
}

/** Fournitures d'un envoi : sleeve et top-loader pour chaque carte, une enveloppe par envoi postal. */
export function suppliesFor(costs: ShippingCosts, mode: ShippingMode, cards: number): number {
  const perCard = costs.supplies.sleeveCents + costs.supplies.toploaderCents;
  return cards * perCard + (mode === "HAND_DELIVERY" ? 0 : costs.supplies.envelopeCents);
}

/** Affranchissement habituel d'un mode ; 0 pour une remise en main propre ou un mode non renseigné. */
export function postageFor(costs: ShippingCosts, mode: ShippingMode): number {
  return mode === "HAND_DELIVERY" ? 0 : (costs.postage[mode] ?? 0);
}

/** Une fourniture du stock décomptée à chaque envoi, avec son prix d'achat. */
export interface StockSupplyCost {
  name: string;
  usage: "PER_CARD" | "PER_SHIPMENT";
  perUse: number;
  modes: ShippingMode[];
  /** null : prix d'achat non renseigné, compté 0. */
  unitCostCents: number | null;
}

/**
 * Le coût des fournitures tel que le stock le donne : dès qu'une fourniture décomptée automatiquement a un prix
 * d'achat, ce sont les fournitures du stock qui comptent (chacune pour les modes d'envoi qui l'utilisent), et non plus
 * les montants des frais d'envoi. null : aucune fourniture avec un prix, les frais d'envoi font foi.
 */
export async function stockSupplyCosts(sql: Db): Promise<StockSupplyCost[] | null> {
  const rows = await sql<StockSupplyCost[]>`
    select name, usage, per_use, modes, unit_cost_cents from supplies
     where archived_at is null and usage <> 'MANUAL' order by name`;
  return rows.some((r) => r.unitCostCents !== null) ? rows : null;
}

/** Fournitures d'un envoi d'après le stock : par carte ou une fois par envoi, pour les fournitures de ce mode. */
export function stockSuppliesFor(items: StockSupplyCost[], mode: ShippingMode, cards: number): number {
  return items
    .filter((x) => x.modes.includes(mode))
    .reduce((sum, x) => sum + (x.unitCostCents ?? 0) * x.perUse * (x.usage === "PER_CARD" ? cards : 1), 0);
}

/** Coût des fournitures d'un envoi : le stock s'il a des prix, sinon les frais d'envoi réglés. */
export async function suppliesCostFor(sql: Db, mode: ShippingMode, cards: number): Promise<number> {
  const stock = await stockSupplyCosts(sql);
  return stock ? stockSuppliesFor(stock, mode, cards) : suppliesFor(await getShippingCosts(sql), mode, cards);
}

/** Ce que coûtent les fournitures d'après le stock : par carte, et par envoi selon le mode (pour une carte). */
export function stockSuppliesSummary(items: StockSupplyCost[]) {
  return {
    items,
    perCardCents: Math.max(0, ...SHIPPING_MODES.map((m) => stockSuppliesFor(items.filter((x) => x.usage === "PER_CARD"), m, 1))),
    perShipmentCents: Object.fromEntries(SHIPPING_MODES.map((m) => [m, stockSuppliesFor(items.filter((x) => x.usage === "PER_SHIPMENT"), m, 1)])) as Record<ShippingMode, number>,
  };
}
