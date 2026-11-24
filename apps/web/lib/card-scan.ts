/**
 * « Scan » d'une photo de carte prise au téléphone : la carte est repérée dans l'image, redressée (perspective
 * corrigée) et recadrée au format d'une carte (63 × 88 mm), comme une appli de numérisation de documents.
 * Le traitement se fait dans le navigateur avec OpenCV, chargé seulement au premier besoin (plusieurs Mo).
 * Si la carte n'est pas trouvée avec assez de certitude, la photo d'origine est gardée telle quelle.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- OpenCV.js n'a pas de types utiles ici */
type Cv = any;
type Mat = any;
export interface Point { x: number; y: number }

/** Proportion d'une carte : largeur ÷ hauteur. */
export const CARD_RATIO = 63 / 88;
/** En dessous, l'image est trop petite pour qu'un recadrage ait un sens (icônes, images de test). */
const MIN_EDGE = 300;
/** Taille de travail pour la détection : assez pour des bords nets, assez petit pour aller vite sur un téléphone. */
const DETECT_EDGE = 900;
/** Hauteur maximale de la carte redressée. */
const OUTPUT_HEIGHT = 1400;

/*
 * Le module OpenCV est un objet « thenable » (Emscripten) : le rendre tel quel depuis une promesse ferait appeler sa
 * méthode `then`, qui échoue dans le navigateur. Il circule donc emballé dans `{ cv }`.
 */
let loading: Promise<{ cv: Cv }> | null = null;
export function loadOpenCv(): Promise<{ cv: Cv }> {
  return (loading ??= import("./opencv-box").then(async ({ box }) => {
    const candidate = box.cv as any;
    if (candidate instanceof Promise) return { cv: await candidate };
    if (!candidate.Mat) {
      await new Promise<void>((resolve) => {
        candidate.onRuntimeInitialized = () => resolve();
      });
    }
    return { cv: candidate };
  }).catch((e) => {
    loading = null;
    throw e;
  }));
}

/**
 * Charge OpenCV en tâche de fond, quand le navigateur est libre : sur l'écran d'ajout, il est prêt avant la première
 * photo (quelques Mo, gardés ensuite en cache par le navigateur).
 */
export function preloadOpenCv() {
  if (typeof window === "undefined") return;
  const start = () => void loadOpenCv().catch(() => undefined);
  if ("requestIdleCallback" in window) window.requestIdleCallback(start, { timeout: 4000 });
  else setTimeout(start, 1500);
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Coins dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche. */
export function orderCorners(points: Point[]): [Point, Point, Point, Point] {
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...points].sort((a, b) => a.y - a.x - (b.y - b.x));
  return [bySum[0]!, byDiff[0]!, bySum[3]!, byDiff[3]!];
}

function polygonArea(p: Point[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/**
 * Un quadrilatère plausible pour une carte vue en photo : assez grand, aux proportions de carte, et à l'intérieur de
 * l'image (le cadre de la photo, aux proportions proches d'une carte, ne doit jamais être pris pour elle).
 */
function plausible(quad: [Point, Point, Point, Point], imageWidth: number, imageHeight: number): boolean {
  const imageArea = imageWidth * imageHeight;
  const margin = Math.max(imageWidth, imageHeight) * 0.012;
  if (quad.some((p) => p.x < margin || p.y < margin || p.x > imageWidth - margin || p.y > imageHeight - margin)) return false;
  const [tl, tr, br, bl] = quad;
  const width = (distance(tl, tr) + distance(bl, br)) / 2;
  const height = (distance(tl, bl) + distance(tr, br)) / 2;
  const ratio = Math.min(width, height) / Math.max(width, height);
  // Une carte vaut 0,716 ; la perspective d'une photo un peu de biais l'écarte de quelques dixièmes.
  if (ratio < 0.52 || ratio > 0.92) return false;
  const area = polygonArea(quad);
  if (area < imageArea * 0.1 || area > imageArea * 0.995) return false;
  // Côtés opposés de longueurs comparables : écarte les trapèzes trop déformés (reflets, ombres).
  const sides = [distance(tl, tr), distance(tr, br), distance(br, bl), distance(bl, tl)];
  return sides[0]! / sides[2]! < 1.6 && sides[2]! / sides[0]! < 1.6 && sides[1]! / sides[3]! < 1.6 && sides[3]! / sides[1]! < 1.6;
}

function quadsFromMask(cv: Cv, mask: Mat): Point[][] {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const quads: Point[][] = [];
  try {
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const hull = new cv.Mat();
      cv.convexHull(contour, hull, false, true);
      const perimeter = cv.arcLength(hull, true);
      // Tolérance croissante : un coin arrondi de carte se simplifie en un seul sommet.
      for (const epsilon of [0.02, 0.03, 0.045, 0.06]) {
        const approx = new cv.Mat();
        cv.approxPolyDP(hull, approx, epsilon * perimeter, true);
        if (approx.rows === 4) {
          const points: Point[] = [];
          for (let k = 0; k < 4; k++) points.push({ x: approx.data32S[k * 2], y: approx.data32S[k * 2 + 1] });
          quads.push(points);
          approx.delete();
          break;
        }
        approx.delete();
      }
      hull.delete();
      contour.delete();
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
  return quads;
}

/**
 * Repère la carte dans une image RGBA : plusieurs façons de séparer la carte du fond (bords, seuil clair ou foncé),
 * et le plus grand quadrilatère aux proportions de carte l'emporte. Coins en pixels de l'image donnée, ou null.
 */
export function findCardCorners(cv: Cv, rgba: Mat): [Point, Point, Point, Point] | null {
  const scale = Math.min(1, DETECT_EDGE / Math.max(rgba.cols, rgba.rows));
  const small = new cv.Mat();
  const gray = new cv.Mat();
  const masks: Mat[] = [];
  try {
    cv.resize(rgba, small, new cv.Size(Math.round(rgba.cols * scale), Math.round(rgba.rows * scale)), 0, 0, cv.INTER_AREA);
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));

    const edges = new cv.Mat();
    cv.Canny(gray, edges, 30, 90);
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);
    masks.push(edges);
    for (const type of [cv.THRESH_BINARY, cv.THRESH_BINARY_INV]) {
      const mask = new cv.Mat();
      cv.threshold(gray, mask, 0, 255, type + cv.THRESH_OTSU);
      cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel, new cv.Point(-1, -1), 2);
      masks.push(mask);
    }
    kernel.delete();

    let best: [Point, Point, Point, Point] | null = null;
    let bestArea = 0;
    for (const mask of masks) {
      for (const quad of quadsFromMask(cv, mask)) {
        const ordered = orderCorners(quad);
        if (!plausible(ordered, small.cols, small.rows)) continue;
        const area = polygonArea(ordered);
        if (area > bestArea) {
          best = ordered;
          bestArea = area;
        }
      }
    }
    if (!best) return null;
    return best.map((p) => ({ x: p.x / scale, y: p.y / scale })) as [Point, Point, Point, Point];
  } finally {
    small.delete();
    gray.delete();
    for (const m of masks) m.delete();
  }
}

/**
 * Redresse la carte délimitée par ses quatre coins : image en portrait au format carte. Une carte photographiée
 * couchée est tournée d'un quart de tour. Les coins sont resserrés d'un cheveu pour ne garder aucun liseré de fond.
 */
export function warpCard(cv: Cv, rgba: Mat, corners: [Point, Point, Point, Point]): Mat {
  let [tl, tr, br, bl] = corners;
  const width = Math.max(distance(tl, tr), distance(bl, br));
  const height = Math.max(distance(tl, bl), distance(tr, br));
  if (width > height) [tl, tr, br, bl] = [bl, tl, tr, br];
  const center = { x: (tl.x + tr.x + br.x + bl.x) / 4, y: (tl.y + tr.y + br.y + bl.y) / 4 };
  const inset = (p: Point) => ({ x: p.x + (center.x - p.x) * 0.008, y: p.y + (center.y - p.y) * 0.008 });
  [tl, tr, br, bl] = [inset(tl), inset(tr), inset(br), inset(bl)];

  const outHeight = Math.round(Math.min(OUTPUT_HEIGHT, Math.max(distance(tl, bl), distance(tr, br))));
  const outWidth = Math.round(outHeight * CARD_RATIO);
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outWidth, 0, outWidth, outHeight, 0, outHeight]);
  const transform = cv.getPerspectiveTransform(from, to);
  const out = new cv.Mat();
  cv.warpPerspective(rgba, out, transform, new cv.Size(outWidth, outHeight), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
  from.delete();
  to.delete();
  transform.delete();
  return out;
}

/**
 * Photo prise au téléphone → carte redressée et recadrée (JPEG). `cropped` dit si le recadrage a eu lieu ; sinon
 * le fichier d'origine est rendu tel quel (carte introuvable, image trop petite, OpenCV indisponible).
 */
export async function scanCardPhoto(file: Blob): Promise<{ blob: Blob; cropped: boolean }> {
  const original = { blob: file, cropped: false };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return original;
  }
  if (Math.min(bitmap.width, bitmap.height) < MIN_EDGE) {
    bitmap.close();
    return original;
  }
  let cv: Cv;
  try {
    ({ cv } = await Promise.race([loadOpenCv(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000))]));
  } catch (e) {
    console.warn("dexlane: recadrage indisponible (OpenCV)", e);
    bitmap.close();
    return original;
  }
  // Les photos de téléphone dépassent souvent 4000 px : 2400 suffisent largement pour une carte nette.
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const src = cv.imread(canvas);
  try {
    const corners = findCardCorners(cv, src);
    if (!corners) {
      console.info("dexlane: carte non repérée sur la photo, photo d'origine gardée");
      return original;
    }
    const card = warpCard(cv, src, corners);
    const out = document.createElement("canvas");
    cv.imshow(out, card);
    card.delete();
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.92));
    return blob ? { blob, cropped: true } : original;
  } catch (e) {
    console.warn("dexlane: recadrage en échec", e);
    return original;
  } finally {
    src.delete();
  }
}
