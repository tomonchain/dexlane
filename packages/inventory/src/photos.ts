import type { Db } from "@dexlane/db";

export type PhotoKind = "SCAN_FRONT" | "SCAN_BACK" | "LISTING";

export interface PhotoRow {
  id: string;
  kind: PhotoKind;
  url: string;
  contentType: string;
  byteSize: number;
  stockItemId: string | null;
  offerId: string | null;
  createdAt: Date;
}

const columns = (sql: Db) => sql`id, kind, url, content_type, byte_size, stock_item_id, offer_id, created_at`;

/** Enregistre la référence d'un fichier déjà déposé dans le stockage. */
export async function recordPhoto(
  sql: Db,
  input: { kind: PhotoKind; storageKey: string; url: string; contentType: string; byteSize: number },
): Promise<PhotoRow> {
  const [row] = await sql<PhotoRow[]>`
    insert into photos (kind, storage_key, url, content_type, byte_size)
    values (${input.kind}, ${input.storageKey}, ${input.url}, ${input.contentType}, ${input.byteSize})
    returning ${columns(sql)}`;
  return row!;
}

/**
 * Rattache des photos de scan à la position créée (et à son offre).
 * Une photo déjà rattachée n'est jamais détournée vers une autre position.
 */
export async function attachPhotos(sql: Db, photoIds: string[], target: { stockItemId: string; offerId: string | null }): Promise<number> {
  if (photoIds.length === 0) return 0;
  const rows = await sql`
    update photos set stock_item_id = ${target.stockItemId}, offer_id = ${target.offerId}
     where id in ${sql(photoIds)} and stock_item_id is null
    returning id`;
  return rows.length;
}

export function listPhotos(sql: Db, where: { stockItemId: string } | { offerId: string }): Promise<PhotoRow[]> {
  return sql<PhotoRow[]>`
    select ${columns(sql)} from photos
     where ${"stockItemId" in where ? sql`stock_item_id = ${where.stockItemId}` : sql`offer_id = ${where.offerId}`}
     order by kind, created_at`;
}
