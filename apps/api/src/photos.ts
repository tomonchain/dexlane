import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";

/** Dépôt de fichiers image. Abstrait pour pouvoir changer de fournisseur et tester sans réseau. */
export interface PhotoStore {
  put(input: { folder: string; data: Buffer; contentType: string }): Promise<{ key: string; url: string }>;
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
  };
}

/** Stockage en mémoire pour les tests : l'image est renvoyée sous forme d'URL `data:`. */
export function createMemoryPhotoStore(): PhotoStore & { count: () => number } {
  let stored = 0;
  return {
    count: () => stored,
    async put({ folder, data, contentType }) {
      stored++;
      return { key: photoKey(folder, contentType), url: `data:${contentType};base64,${data.toString("base64")}` };
    },
  };
}
