import type { Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";

/**
 * Journal du stock : tout ce qui est entré, sorti, a été corrigé ou déplacé, cartes et fournitures confondues, du plus
 * récent au plus ancien. Côté cartes, seuls comptent les mouvements du stock physique (quantité en main) et les
 * déplacements ; les réservations et prélèvements d'une vente en cours n'y figurent pas, sa sortie si.
 */

export type MovementCategory = "CARD" | "SUPPLY";
export type MovementKind = "IN" | "OUT" | "ADJUST" | "MOVE";

export interface StockMovement {
  /** « c:123 » pour une carte, « s:45 » pour une fourniture. */
  id: string;
  at: Date;
  category: MovementCategory;
  kind: MovementKind;
  /** Type détaillé : RECEIVE, SHIP_OUT, ADJUST, MOVE, LOST, DISPOSED, RETURN_IN, BULK_EXTRACT… ; CONSUME pour une fourniture. */
  type: string;
  qtyDelta: number;
  name: string;
  /** Série · numéro · état pour une carte, référence pour une fourniture. */
  detail: string | null;
  unitSku: string | null;
  offerId: string | null;
  supplyId: string | null;
  orderId: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  actor: string;
  reason: string | null;
}

export interface MovementQuery {
  category?: MovementCategory;
  kind?: MovementKind;
  offerId?: string;
  supplyId?: string;
  /** Curseur renvoyé par la page précédente. */
  before?: string;
  limit?: number;
  /** Fenêtre du résumé, en jours (30 par défaut). */
  days?: number;
}

export interface MovementPage {
  movements: StockMovement[];
  /** Curseur de la page suivante ; null : fin du journal. */
  next: string | null;
  /** Unités entrées et sorties sur la fenêtre, selon les mêmes filtres de catégorie et d'article. */
  summary: { days: number; in: number; out: number; adjusted: number; moves: number };
}

const cursor = (m: { at: Date; sortKey: string }) => Buffer.from(`${m.at.toISOString()}|${m.sortKey}`).toString("base64url");
function readCursor(value: string): { at: Date; key: string } {
  const [at, key] = Buffer.from(value, "base64url").toString().split("|");
  const date = new Date(at ?? "");
  if (!key || Number.isNaN(date.getTime())) throw new DomainError("INVALID_CURSOR", "invalid movements cursor");
  return { at: date, key };
}

/** Tous les mouvements, sous une même forme ; filtrés ensuite par la requête qui les lit. */
const ALL = (sql: Db) => sql`
  select 'c:' || m.id as id, 'c' || lpad(m.id::text, 19, '0') as sort_key, m.created_at as at, 'CARD' as category,
         case when m.movement_type = 'MOVE' then 'MOVE' when m.movement_type = 'ADJUST' then 'ADJUST'
              when m.qty_delta > 0 then 'IN' else 'OUT' end as kind,
         m.movement_type::text as type, m.qty_delta,
         coalesce(c.name, 'Lot de vrac') as name,
         case when c.id is null then null else coalesce(st.name, c.set_id) || ' · ' || c.local_number || ' · ' || off.condition::text end as detail,
         si.unit_sku, si.offer_id, null::uuid as supply_id,
         (select ol.order_id from order_allocations a join order_lines ol on ol.id = a.order_line_id where a.id = m.order_allocation_id) as order_id,
         fl.code as from_location, tl.code as to_location, m.actor, m.reason
    from inventory_movements m
    join stock_items si on si.id = m.stock_item_id
    left join offers off on off.id = si.offer_id
    left join card_variants v on v.id = off.variant_id
    left join catalog_cards c on c.id = v.catalog_card_id
    left join catalog_sets st on st.id = c.set_id and st.language = c.language
    left join locations fl on fl.id = m.from_location_id
    left join locations tl on tl.id = m.to_location_id
   where m.bucket = 'on_hand' or m.movement_type = 'MOVE'
  union all
  select 's:' || sm.id, 's' || lpad(sm.id::text, 19, '0'), sm.created_at, 'SUPPLY',
         case sm.kind when 'RECEIVE' then 'IN' when 'CONSUME' then 'OUT' else 'ADJUST' end,
         sm.kind, sm.qty_delta, su.name, su.reference, null, null, su.id,
         (select sh.order_id from shipments sh where sh.id = sm.shipment_id), null, null, sm.actor, sm.note
    from supply_movements sm
    join supplies su on su.id = sm.supply_id`;

export async function listStockMovements(sql: Db, q: MovementQuery = {}): Promise<MovementPage> {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const days = Math.min(Math.max(q.days ?? 30, 1), 365);
  const after = q.before ? readCursor(q.before) : null;
  const scope = sql`
    ${q.category ? sql`and category = ${q.category}` : sql``}
    ${q.offerId ? sql`and offer_id = ${q.offerId}` : sql``}
    ${q.supplyId ? sql`and supply_id = ${q.supplyId}` : sql``}`;
  const rows = await sql<(StockMovement & { sortKey: string })[]>`
    select * from (${ALL(sql)}) m
     where true ${scope}
       ${q.kind ? sql`and kind = ${q.kind}` : sql``}
       ${after ? sql`and (at, sort_key) < (${after.at}, ${after.key})` : sql``}
     order by at desc, sort_key desc
     limit ${limit + 1}`;
  const [summary] = await sql<MovementPage["summary"][]>`
    select ${days}::int as days,
           coalesce(sum(qty_delta) filter (where kind = 'IN'), 0)::int as in,
           coalesce(-sum(qty_delta) filter (where kind = 'OUT'), 0)::int as out,
           coalesce(sum(qty_delta) filter (where kind = 'ADJUST'), 0)::int as adjusted,
           count(*) filter (where kind = 'MOVE')::int as moves
      from (${ALL(sql)}) m
     where at > now() - make_interval(days => ${days}) ${scope}`;
  const page = rows.slice(0, limit);
  return {
    movements: page.map(({ sortKey: _sortKey, ...m }) => m),
    next: rows.length > limit ? cursor(page.at(-1)!) : null,
    summary: summary!,
  };
}
