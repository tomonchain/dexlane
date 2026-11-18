import type { Candidate, CandidateVariant } from "@dexlane/catalog";
import { withTx, type Db } from "@dexlane/db";
import { attachPhotos, receiveCard, resolveLocation, type CardCondition, type LocationRef, type ReceivedPosition } from "@dexlane/inventory";
import { DomainError } from "@dexlane/shared";
import type { Identification } from "./identify";

export * from "./order";

// ───────────────────────── Sessions ─────────────────────────

export interface ScanBatch {
  id: string;
  name: string;
  locationCode: string;
  unitCostCents: number;
  acquisitionLotId: string | null;
  defaultCondition: CardCondition | null;
  language: string;
  paired: boolean;
  receivedAt: Date | null;
  createdAt: Date;
  /** Cartes du lot, puis celles qui attendent une décision, puis celles déjà en stock. */
  counts: { items: number; toReview: number; received: number; skipped: number };
}

export interface ScanItem {
  id: string;
  position: number;
  fileName: string;
  frontPhoto: { id: string; url: string } | null;
  backPhoto: { id: string; url: string } | null;
  sure: boolean;
  candidates: Candidate[];
  reviewReasons: string[];
  scanError: string | null;
  card: { id: string; name: string; setId: string; setName: string | null; localNumber: string; rarity: string | null; imageUrl: string | null; variants: CandidateVariant[] } | null;
  variantId: string | null;
  condition: CardCondition | null;
  skipped: boolean;
  /** Entrée en stock : le code attribué, et l'offre à laquelle la carte appartient désormais. */
  unitSku: string | null;
  offerId: string | null;
  /** Rien ne manque : carte, variante et état (le sien ou celui du lot). */
  ready: boolean;
}

export interface CreateBatchInput {
  name?: string;
  location: LocationRef;
  unitCostCents?: number;
  acquisitionLotId?: string;
  defaultCondition?: CardCondition | null;
  language?: string;
  paired?: boolean;
}

const batchSelect = (sql: Db) => sql`
  select b.id, b.name, l.code as location_code, b.unit_cost_cents, b.acquisition_lot_id, b.default_condition, b.language, b.paired, b.received_at, b.created_at,
         jsonb_build_object(
           'items', count(i.id),
           'toReview', count(i.id) filter (where not i.skipped and i.stock_item_id is null and (i.variant_id is null or coalesce(i.condition, b.default_condition) is null)),
           'received', count(i.id) filter (where i.stock_item_id is not null),
           'skipped', count(i.id) filter (where i.skipped)) as counts
    from scan_batches b
    join locations l on l.id = b.location_id
    left join scan_items i on i.batch_id = b.id`;

export async function createBatch(sql: Db, input: CreateBatchInput): Promise<ScanBatch> {
  const location = await resolveLocation(sql, input.location);
  const name = input.name?.trim() || `Lot du ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date())}`;
  const [row] = await sql<{ id: string }[]>`
    insert into scan_batches (name, location_id, unit_cost_cents, acquisition_lot_id, default_condition, language, paired)
    values (${name}, ${location.id}, ${input.unitCostCents ?? 0}, ${input.acquisitionLotId ?? null}, ${input.defaultCondition ?? null},
            ${input.language ?? "fr"}, ${input.paired ?? true})
    returning id`;
  return getBatch(sql, row!.id);
}

export async function getBatch(sql: Db, batchId: string): Promise<ScanBatch> {
  const [row] = await sql<ScanBatch[]>`${batchSelect(sql)} where b.id = ${batchId} group by b.id, l.code`;
  if (!row) throw new DomainError("SCAN_BATCH_NOT_FOUND", `scan batch ${batchId} does not exist`);
  return row;
}

export function listBatches(sql: Db): Promise<ScanBatch[]> {
  return sql<ScanBatch[]>`${batchSelect(sql)} group by b.id, l.code order by b.created_at desc limit 50`;
}

export async function updateBatch(
  sql: Db,
  batchId: string,
  change: { name?: string; location?: LocationRef; unitCostCents?: number; defaultCondition?: CardCondition | null },
): Promise<ScanBatch> {
  const batch = await getBatch(sql, batchId);
  if (batch.receivedAt) throw new DomainError("BATCH_ALREADY_RECEIVED", "this batch has already been received into stock");
  const location = change.location ? await resolveLocation(sql, change.location) : null;
  await sql`
    update scan_batches set
      name = ${change.name?.trim() || batch.name},
      location_id = coalesce(${location?.id ?? null}, location_id),
      unit_cost_cents = ${change.unitCostCents ?? batch.unitCostCents},
      default_condition = ${change.defaultCondition === undefined ? batch.defaultCondition : change.defaultCondition}
    where id = ${batchId}`;
  return getBatch(sql, batchId);
}

export async function listItems(sql: Db, batchId: string): Promise<ScanItem[]> {
  return sql<ScanItem[]>`
    select i.id, i.position, i.file_name, i.sure, i.candidates, i.review_reasons, i.scan_error, i.variant_id, i.condition, i.skipped,
           case when fp.id is null then null else jsonb_build_object('id', fp.id, 'url', fp.url) end as front_photo,
           case when bp.id is null then null else jsonb_build_object('id', bp.id, 'url', bp.url) end as back_photo,
           case when c.id is null then null else jsonb_build_object(
             'id', c.id, 'name', c.name, 'setId', c.set_id, 'setName', st.name, 'localNumber', c.local_number, 'rarity', c.rarity, 'imageUrl', c.image_url,
             'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'finish', v.finish, 'edition', v.edition, 'stamp', v.stamp,
                                                                         'subtype', v.subtype, 'incomplete', v.incomplete) order by v.finish, v.edition, v.subtype)
                                     from card_variants v where v.catalog_card_id = c.id), '[]'::jsonb)) end as card,
           s.unit_sku, s.offer_id,
           (not i.skipped and i.stock_item_id is null and i.variant_id is not null and coalesce(i.condition, b.default_condition) is not null) as ready
      from scan_items i
      join scan_batches b on b.id = i.batch_id
      left join photos fp on fp.id = i.front_photo_id
      left join photos bp on bp.id = i.back_photo_id
      left join catalog_cards c on c.id = i.catalog_card_id
      left join catalog_sets st on st.id = c.set_id and st.language = c.language
      left join stock_items s on s.id = i.stock_item_id
     where i.batch_id = ${batchId}
     order by i.position`;
}

async function getItem(sql: Db, itemId: string): Promise<ScanItem & { batchId: string }> {
  const [ref] = await sql<{ batchId: string }[]>`select batch_id from scan_items where id = ${itemId}`;
  if (!ref) throw new DomainError("SCAN_ITEM_NOT_FOUND", `scan item ${itemId} does not exist`);
  const item = (await listItems(sql, ref.batchId)).find((i) => i.id === itemId)!;
  return { ...item, batchId: ref.batchId };
}

/**
 * Enregistre une carte scannée à son rang. Rejouer le même rang (rechargement de la page, dossier relu)
 * renvoie la carte déjà enregistrée sans rien relire : `created` dit si la lecture était nécessaire.
 */
export async function findItem(sql: Db, batchId: string, position: number): Promise<ScanItem | null> {
  const [row] = await sql<{ id: string }[]>`select id from scan_items where batch_id = ${batchId} and position = ${position}`;
  return row ? getItem(sql, row.id) : null;
}

export async function addItem(
  sql: Db,
  input: {
    batchId: string;
    position: number;
    fileName: string;
    frontPhotoId: string | null;
    /** Résultat de la lecture, ou le message d'erreur si elle a échoué (la carte reste à identifier à la main). */
    identification: Identification | { error: string };
  },
): Promise<ScanItem> {
  const batch = await getBatch(sql, input.batchId);
  if (batch.receivedAt) throw new DomainError("BATCH_ALREADY_RECEIVED", "this batch has already been received into stock");
  const id = "error" in input.identification ? null : input.identification;
  const top = id && !id.requiresReview ? id.match.candidates[0] : undefined;
  const [row] = await sql<{ id: string }[]>`
    insert into scan_items (batch_id, position, file_name, front_photo_id, sure, candidates, review_reasons, scan_error, catalog_card_id, variant_id)
    values (${input.batchId}, ${input.position}, ${input.fileName}, ${input.frontPhotoId}, ${!!top},
            ${sql.json((id?.match.candidates ?? []) as never)}, ${sql.json(id?.reviewReasons ?? [])}, ${id ? null : (input.identification as { error: string }).error},
            ${top?.catalogCardId ?? null}, ${top ? id!.suggestedVariantId : null})
    on conflict (batch_id, position) do nothing
    returning id`;
  return row ? getItem(sql, row.id) : (await findItem(sql, input.batchId, input.position))!;
}

export async function setItemBack(sql: Db, itemId: string, backPhotoId: string): Promise<ScanItem> {
  await sql`update scan_items set back_photo_id = ${backPhotoId} where id = ${itemId} and stock_item_id is null`;
  return getItem(sql, itemId);
}

/** Correction d'une carte pendant la revue : autre carte, variante, état, ou mise à l'écart. */
export async function updateItem(
  sql: Db,
  itemId: string,
  change: { catalogCardId?: string; variantId?: string | null; condition?: CardCondition | null; skipped?: boolean },
): Promise<ScanItem> {
  return withTx(sql, async (tx) => {
    const [item] = await tx<{ catalogCardId: string | null; variantId: string | null; condition: CardCondition | null; skipped: boolean; stockItemId: string | null }[]>`
      select catalog_card_id, variant_id, condition, skipped, stock_item_id from scan_items where id = ${itemId} for update`;
    if (!item) throw new DomainError("SCAN_ITEM_NOT_FOUND", `scan item ${itemId} does not exist`);
    if (item.stockItemId) throw new DomainError("ITEM_ALREADY_RECEIVED", "this card is already in stock; correct it from the stock");

    let cardId = item.catalogCardId;
    let variantId = change.variantId === undefined ? item.variantId : change.variantId;
    if (change.catalogCardId && change.catalogCardId !== item.catalogCardId) {
      cardId = change.catalogCardId;
      const variants = await tx<{ id: string }[]>`select id from card_variants where catalog_card_id = ${cardId}`;
      if (variants.length === 0 && !(await tx`select 1 from catalog_cards where id = ${cardId}`).length) {
        throw new DomainError("CARD_NOT_FOUND", `catalog card ${cardId} does not exist`);
      }
      // Une seule variante : inutile de la redemander. Sinon, celle fournie avec la carte, ou à choisir.
      variantId = change.variantId ?? (variants.length === 1 ? variants[0]!.id : null);
    }
    if (variantId) {
      const [variant] = await tx<{ catalogCardId: string }[]>`select catalog_card_id from card_variants where id = ${variantId}`;
      if (!variant || variant.catalogCardId !== cardId) throw new DomainError("VARIANT_NOT_FOUND", "this variant does not belong to the chosen card");
    }
    await tx`
      update scan_items set catalog_card_id = ${cardId}, variant_id = ${variantId},
             condition = ${change.condition === undefined ? item.condition : change.condition},
             skipped = ${change.skipped ?? item.skipped},
             sure = sure and ${cardId === item.catalogCardId}
       where id = ${itemId}`;
    return getItem(tx, itemId);
  });
}

/**
 * Entre le lot en stock, carte par carte dans l'ordre du scan : les codes attribués se suivent comme la pile dans la boîte.
 * Tout ou rien tant qu'une carte attend une décision ; les cartes écartées sont sautées.
 */
export function receiveBatch(
  sql: Db,
  batchId: string,
  actor: string,
  afterEach: (tx: Db, received: ReceivedPosition) => Promise<unknown> = async () => undefined,
): Promise<{ received: number; firstSku: string | null; lastSku: string | null }> {
  return withTx(sql, async (tx) => {
    const [batch] = await tx<{ locationId: string; unitCostCents: number; acquisitionLotId: string | null; defaultCondition: CardCondition | null; receivedAt: Date | null }[]>`
      select location_id, unit_cost_cents, acquisition_lot_id, default_condition, received_at from scan_batches where id = ${batchId} for update`;
    if (!batch) throw new DomainError("SCAN_BATCH_NOT_FOUND", `scan batch ${batchId} does not exist`);
    const items = await tx<{ id: string; position: number; variantId: string | null; condition: CardCondition | null; frontPhotoId: string | null; backPhotoId: string | null }[]>`
      select id, position, variant_id, condition, front_photo_id, back_photo_id from scan_items
       where batch_id = ${batchId} and not skipped and stock_item_id is null order by position`;
    const pending = items.filter((i) => !i.variantId || !(i.condition ?? batch.defaultCondition));
    if (pending.length > 0) {
      throw new DomainError("BATCH_NOT_READY", "some cards still need a decision", { positions: pending.map((i) => i.position) });
    }
    const skus: string[] = [];
    for (const item of items) {
      const received = await receiveCard(tx, {
        variantId: item.variantId!, condition: (item.condition ?? batch.defaultCondition)!, quantity: 1, location: { id: batch.locationId },
        unitCostCents: batch.unitCostCents, acquisitionLotId: batch.acquisitionLotId ?? undefined, actor,
      });
      const photos = [item.frontPhotoId, item.backPhotoId].filter((p): p is string => !!p);
      await attachPhotos(tx, photos, { stockItemId: received.stockItem.id, offerId: received.offer.id });
      await tx`update scan_items set stock_item_id = ${received.stockItem.id} where id = ${item.id}`;
      await afterEach(tx, received);
      skus.push(received.stockItem.unitSku);
    }
    await tx`update scan_batches set received_at = now() where id = ${batchId}`;
    return { received: skus.length, firstSku: skus[0] ?? null, lastSku: skus.at(-1) ?? null };
  });
}
