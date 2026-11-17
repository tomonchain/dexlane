import { withTx, type Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";

export type PhotoKind = "SCAN_FRONT" | "SCAN_BACK" | "LISTING" | "BACKGROUND" | "PROMO";

export interface PhotoRow {
  id: string;
  kind: PhotoKind;
  url: string;
  contentType: string;
  byteSize: number;
  stockItemId: string | null;
  offerId: string | null;
  /** Pour un visuel d'annonce : le scan dont il est tiré. */
  sourcePhotoId: string | null;
  createdAt: Date;
}

/** Fichier déjà déposé dans le stockage, à référencer en base. */
export interface StoredFile {
  storageKey: string;
  url: string;
  contentType: string;
  byteSize: number;
}

const columns = (sql: Db) => sql`id, kind, url, content_type, byte_size, stock_item_id, offer_id, source_photo_id, created_at`;

/** Enregistre la référence d'un fichier déjà déposé dans le stockage. */
export async function recordPhoto(sql: Db, input: StoredFile & { kind: PhotoKind }): Promise<PhotoRow> {
  const [row] = await sql<PhotoRow[]>`
    insert into photos (kind, storage_key, url, content_type, byte_size)
    values (${input.kind}, ${input.storageKey}, ${input.url}, ${input.contentType}, ${input.byteSize})
    returning ${columns(sql)}`;
  return row!;
}

export async function getPhoto(sql: Db, id: string): Promise<PhotoRow> {
  const [row] = await sql<PhotoRow[]>`select ${columns(sql)} from photos where id = ${id}`;
  if (!row) throw new DomainError("PHOTO_NOT_FOUND", `photo ${id} does not exist`);
  return row;
}

/**
 * Rattache des photos de scan à la position créée (et à son offre).
 * Une photo déjà rattachée n'est jamais détournée vers une autre position.
 */
export async function attachPhotos(sql: Db, photoIds: string[], target: { stockItemId: string; offerId: string | null }): Promise<number> {
  if (photoIds.length === 0) return 0;
  const rows = await sql`
    update photos set stock_item_id = ${target.stockItemId}, offer_id = ${target.offerId}
     where id in ${sql(photoIds)} and stock_item_id is null and kind in ('SCAN_FRONT', 'SCAN_BACK')
    returning id`;
  return rows.length;
}

/**
 * Enregistre le visuel d'annonce composé à partir d'un scan. Il hérite de la position et de l'offre du scan ;
 * le visuel précédent du même scan est remplacé (son URL est renvoyée pour que l'appelant supprime le fichier).
 */
export function saveListingPhoto(sql: Db, sourcePhotoId: string, file: StoredFile): Promise<{ photo: PhotoRow; replacedUrl: string | null }> {
  return withTx(sql, async (tx) => {
    const [source] = await tx<{ stockItemId: string | null; offerId: string | null; kind: PhotoKind }[]>`
      select stock_item_id, offer_id, kind from photos where id = ${sourcePhotoId} for update`;
    if (!source || (source.kind !== "SCAN_FRONT" && source.kind !== "SCAN_BACK")) {
      throw new DomainError("PHOTO_NOT_FOUND", `scan photo ${sourcePhotoId} does not exist`);
    }
    const [previous] = await tx<{ url: string }[]>`delete from photos where source_photo_id = ${sourcePhotoId} and kind = 'LISTING' returning url`;
    const [photo] = await tx<PhotoRow[]>`
      insert into photos (kind, storage_key, url, content_type, byte_size, stock_item_id, offer_id, source_photo_id)
      values ('LISTING', ${file.storageKey}, ${file.url}, ${file.contentType}, ${file.byteSize}, ${source.stockItemId}, ${source.offerId}, ${sourcePhotoId})
      returning ${columns(tx)}`;
    return { photo: photo!, replacedUrl: previous?.url ?? null };
  });
}

export function listPhotos(sql: Db, where: { stockItemId: string } | { offerIds: string[] }): Promise<PhotoRow[]> {
  if ("offerIds" in where && where.offerIds.length === 0) return Promise.resolve([]);
  return sql<PhotoRow[]>`
    select ${columns(sql)} from photos
     where ${"stockItemId" in where ? sql`stock_item_id = ${where.stockItemId}` : sql`offer_id in ${sql(where.offerIds)}`}
     order by kind, created_at`;
}
