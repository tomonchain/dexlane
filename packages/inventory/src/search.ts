import type { Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";
import type { CardCondition, StockKind } from "./internal";
import { likePrefix, normalizeLocationCode } from "./locations";

export interface InventorySearch {
  /** `unit_sku` ou `offer_sku` (exact ou préfixe), ou fragment du nom de carte / du libellé de vrac (sans accents). */
  q?: string;
  setId?: string;
  language?: string;
  condition?: CardCondition;
  kind?: StockKind;
  /** Par défaut : tout sauf les positions archivées. */
  lifecycle?: "DRAFT" | "ACTIVE" | "ARCHIVED" | "ALL";
  /** Code d'emplacement ou préfixe hiérarchique : « BOX-03 » inclut « BOX-03/ROW-12/SLOT-04 ». */
  location?: string;
  limit?: number;
  offset?: number;
}

export interface InventoryRow {
  id: string;
  unitSku: string;
  kind: StockKind;
  lifecycle: "DRAFT" | "ACTIVE" | "ARCHIVED";
  onHand: number;
  reserved: number;
  inspection: number;
  quarantine: number;
  availableToSell: number;
  unitCostCents: number;
  acquisitionLotId: string | null;
  createdAt: Date;
  locationId: string;
  locationCode: string;
  offer: {
    id: string;
    offerSku: string;
    condition: CardCondition;
    isUnique: boolean;
    category: string;
    status: string;
    targetPriceCents: number | null;
  } | null;
  card: {
    catalogCardId: string;
    variantId: string;
    name: string;
    setId: string;
    localNumber: string;
    language: string;
    rarity: string | null;
    imageUrl: string | null;
    finish: string;
    edition: string;
    variantIncomplete: boolean;
  } | null;
  bulk: { descriptorId: string; label: string; cardType: string; setId: string | null; era: string | null } | null;
}

const MAX_LIMIT = 200;

const select = (sql: Db) => sql`
  select s.id, s.unit_sku, s.kind, s.lifecycle, s.on_hand, s.reserved, s.inspection, s.quarantine,
         (s.on_hand - s.reserved - s.inspection - s.quarantine) as available_to_sell,
         s.unit_cost_cents, s.acquisition_lot_id, s.created_at, s.location_id, l.code as location_code,
         case when o.id is null then null else jsonb_build_object(
           'id', o.id, 'offerSku', o.offer_sku, 'condition', o.condition, 'isUnique', o.is_unique,
           'category', o.category, 'status', o.status, 'targetPriceCents', o.target_price_cents) end as offer,
         case when c.id is null then null else jsonb_build_object(
           'catalogCardId', c.id, 'variantId', v.id, 'name', c.name, 'setId', c.set_id,
           'localNumber', c.local_number, 'language', c.language, 'rarity', c.rarity, 'imageUrl', c.image_url,
           'finish', v.finish, 'edition', v.edition, 'variantIncomplete', v.incomplete) end as card,
         case when b.id is null then null else jsonb_build_object(
           'descriptorId', b.id, 'label', b.label, 'cardType', b.card_type, 'setId', b.set_id, 'era', b.era) end as bulk`;

const joins = (sql: Db) => sql`
    from stock_items s
    join locations l on l.id = s.location_id
    left join offers o on o.id = s.offer_id
    left join card_variants v on v.id = o.variant_id
    left join catalog_cards c on c.id = v.catalog_card_id
    left join bulk_descriptors b on b.id = s.bulk_descriptor_id`;

/** Recherche d'inventaire paginée (spec §8 `GET /api/inventory`, écran Inventaire). */
export async function searchInventory(
  sql: Db,
  f: InventorySearch = {},
): Promise<{ items: InventoryRow[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), MAX_LIMIT);
  const offset = Math.max(f.offset ?? 0, 0);
  const q = f.q?.trim();
  const location = f.location ? normalizeLocationCode(f.location) : null;
  const lifecycle = f.lifecycle ?? "NOT_ARCHIVED";

  const where = sql`
    where true
      ${lifecycle === "ALL" ? sql`` : lifecycle === "NOT_ARCHIVED" ? sql`and s.lifecycle <> 'ARCHIVED'` : sql`and s.lifecycle = ${lifecycle}`}
      ${f.kind ? sql`and s.kind = ${f.kind}` : sql``}
      ${f.condition ? sql`and o.condition = ${f.condition}` : sql``}
      ${f.setId ? sql`and coalesce(c.set_id, b.set_id) = ${f.setId.toLowerCase()}` : sql``}
      ${f.language ? sql`and coalesce(c.language, b.language) = ${f.language.toLowerCase()}` : sql``}
      ${location ? sql`and (l.code = ${location} or l.code like ${likePrefix(location)} || '/%')` : sql``}
      ${
        q
          ? sql`and (
                 upper(s.unit_sku) like upper(${likePrefix(q)}) || '%'
              or upper(o.offer_sku) like upper(${likePrefix(q)}) || '%'
              or f_unaccent(lower(c.name)) like '%' || f_unaccent(lower(${likePrefix(q)})) || '%'
              or f_unaccent(lower(b.label)) like '%' || f_unaccent(lower(${likePrefix(q)})) || '%')`
          : sql``
      }`;

  const [items, [count]] = await Promise.all([
    sql<InventoryRow[]>`${select(sql)} ${joins(sql)} ${where} order by s.created_at desc, s.id limit ${limit} offset ${offset}`,
    sql<{ total: number }[]>`select count(*)::int as total ${joins(sql)} ${where}`,
  ]);
  return { items, total: count!.total, limit, offset };
}

export interface MovementRow {
  id: string;
  movementType: string;
  bucket: string | null;
  qtyDelta: number;
  fromLocationCode: string | null;
  toLocationCode: string | null;
  orderAllocationId: string | null;
  correlationId: string | null;
  actor: string;
  reason: string | null;
  createdAt: Date;
}

/** Fiche d'une position : état courant et historique des mouvements (les plus récents d'abord). */
export async function getStockItemDetail(
  sql: Db,
  ref: { id: string } | { unitSku: string },
  opts: { movements?: number } = {},
): Promise<InventoryRow & { movements: MovementRow[] }> {
  const [item] = await sql<InventoryRow[]>`
    ${select(sql)} ${joins(sql)}
    where ${"id" in ref ? sql`s.id = ${ref.id}` : sql`s.unit_sku = ${ref.unitSku.trim().toUpperCase()}`}`;
  if (!item) throw new DomainError("STOCK_ITEM_NOT_FOUND", "stock item not found");
  const movements = await sql<MovementRow[]>`
    select m.id::text as id, m.movement_type, m.bucket, m.qty_delta, lf.code as from_location_code,
           lt.code as to_location_code, m.order_allocation_id, m.correlation_id, m.actor, m.reason, m.created_at
      from inventory_movements m
      left join locations lf on lf.id = m.from_location_id
      left join locations lt on lt.id = m.to_location_id
     where m.stock_item_id = ${item.id}
     order by m.id desc
     limit ${Math.min(opts.movements ?? 50, 500)}`;
  return { ...item, movements };
}
