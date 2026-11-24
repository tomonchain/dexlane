import { t } from "./i18n";

const MAX_EDGE = 2000;
const DIRECT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DIRECT_MAX_BYTES = 1.5 * 1024 * 1024;

/**
 * Réduit la photo avant envoi (l'API refuse au-delà de 5 Mo) : plus grand côté ≤ 2000 px, JPEG qualité 0,85.
 * L'orientation EXIF est appliquée, sinon les photos prises en portrait arriveraient couchées.
 */
/**
 * Logo de la boutique : la transparence est gardée (PNG), et l'image ramenée à 800 px au plus.
 * Un PNG ou un WebP déjà léger part tel quel.
 */
export async function prepareLogo(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(t("Format d'image non pris en charge. Choisissez un PNG, un WebP ou un JPEG."));
  }
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && (file.type === "image/png" || file.type === "image/webp") && file.size <= 2 * 1024 * 1024) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error(t("Impossible de préparer la photo."));
  return blob;
}

export async function prepareImage(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (DIRECT_TYPES.includes(file.type) && file.size <= 5 * 1024 * 1024) return file;
    throw new Error(t("Format d'image non pris en charge. Prenez la photo en JPEG."));
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && DIRECT_TYPES.includes(file.type) && file.size <= DIRECT_MAX_BYTES) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error(t("Impossible de préparer la photo."));
  return blob;
}
