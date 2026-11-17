import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";

/** Dépôt de fichiers image. Abstrait pour pouvoir changer de fournisseur et tester sans réseau. */
export interface PhotoStore {
  put(input: { folder: string; data: Buffer; contentType: string }): Promise<{ key: string; url: string }>;
  /** Supprime un fichier devenu inutile (visuel d'annonce remplacé). */
  remove(url: string): Promise<void>;
}

/** Contenu d'une photo à partir de son adresse : fichier du stockage, ou URL `data:` du stockage de test. */
export async function readPhoto(url: string): Promise<{ data: Buffer; contentType: string | null }> {
  const inline = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (inline) return { data: Buffer.from(inline[2]!, "base64"), contentType: inline[1]! };
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo storage answered ${res.status}`);
  return { data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") };
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** Chemin daté et unique : `scans/2026/11/<uuid>.jpg`. */
export function photoKey(folder: string, contentType: string, now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${folder}/${now.getUTCFullYear()}/${month}/${randomUUID()}.${EXTENSIONS[contentType] ?? "bin"}`;
}

/**
 * Stockage Vercel Blob. Les fichiers sont publics mais leur adresse n'est pas devinable (identifiant aléatoire) :
 * c'est ce qu'il faut pour qu'une marketplace puisse télécharger les photos d'une annonce.
 */
export function createBlobPhotoStore(token = process.env.BLOB_READ_WRITE_TOKEN): PhotoStore | null {
  if (!token) return null;
  return {
    async put({ folder, data, contentType }) {
      const blob = await put(photoKey(folder, contentType), data, { access: "public", contentType, token });
      return { key: blob.pathname, url: blob.url };
    },
    remove: (url) => del(url, { token }),
  };
}

/** Stockage en mémoire pour les tests : l'image est renvoyée sous forme d'URL `data:`. */
export function createMemoryPhotoStore(): PhotoStore & { count: () => number } {
  let stored = 0;
  return {
    count: () => stored,
    async remove() {
      stored--;
    },
    async put({ folder, data, contentType }) {
      stored++;
      return { key: photoKey(folder, contentType), url: `data:${contentType};base64,${data.toString("base64")}` };
    },
  };
}
