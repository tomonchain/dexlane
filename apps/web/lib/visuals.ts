import { api } from "./api";
import { composeListingPhoto, loadBitmap } from "./compose";

/**
 * Compose le visuel d'annonce (la carte sur le fond choisi) de chaque photo qui n'en a pas encore.
 * Appelé d'office quand une photo arrive et avant une mise en ligne, pour que ce ne soit jamais une étape à part.
 * Sans effet si la composition automatique est désactivée dans les réglages, sauf `force`.
 */
export async function composeMissingVisuals(
  offerIds: (string | null | undefined)[],
  onProgress?: (done: number, total: number) => void,
  /** force : même si la composition automatique est coupée ; all : recompose aussi les visuels existants (nouveau style). */
  opts: { force?: boolean; all?: boolean } = {},
): Promise<number> {
  const ids = [...new Set(offerIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return 0;
  const settings = await api.listingSettings();
  if (!settings.autoCompose && !opts.force) return 0;
  const background = settings.photo.background.type === "image"
    ? await loadBitmap(api.photoContentUrl(settings.photo.background.photoId)).catch(() => null)
    : null;
  const logo = settings.photo.logoPhotoId ? await loadBitmap(api.photoContentUrl(settings.photo.logoPhotoId)).catch(() => null) : null;
  let composed = 0;
  for (const [index, offerId] of ids.entries()) {
    onProgress?.(index, ids.length);
    // Une carte vendue entre-temps, ou une photo illisible, ne doit pas arrêter les autres.
    try {
      const { photos } = await api.stockDetail(offerId);
      const done = new Set(opts.all ? [] : photos.filter((p) => p.kind === "LISTING").map((p) => p.sourcePhotoId));
      for (const scan of photos.filter((p) => (p.kind === "SCAN_FRONT" || p.kind === "SCAN_BACK") && !done.has(p.id))) {
        const card = await loadBitmap(api.photoContentUrl(scan.id));
        await api.uploadListingPhoto(await composeListingPhoto(card, settings.photo, background, logo), scan.id);
        card.close();
        composed++;
      }
    } catch {
      continue;
    }
  }
  onProgress?.(ids.length, ids.length);
  return composed;
}
