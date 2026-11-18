import type { PhotoStyle } from "./types";

/** Proportion d'une carte : rayon des coins rapporté à sa largeur (3 mm sur 63). */
const CORNER_RATIO = 0.047;

export const BACKGROUND_PRESETS: { name: string; background: PhotoStyle["background"] }[] = [
  { name: "Ardoise", background: { type: "gradient", from: "#1e293b", to: "#0f172a", angle: 135 } },
  { name: "Studio", background: { type: "gradient", from: "#fafaf9", to: "#d6d3d1", angle: 180 } },
  { name: "Blanc", background: { type: "color", color: "#ffffff" } },
  { name: "Noir", background: { type: "color", color: "#0a0a0a" } },
  { name: "Nuit", background: { type: "gradient", from: "#3730a3", to: "#0f172a", angle: 160 } },
  { name: "Forêt", background: { type: "gradient", from: "#166534", to: "#052e16", angle: 150 } },
  { name: "Sable", background: { type: "gradient", from: "#f5e6d3", to: "#dcc19b", angle: 160 } },
  { name: "Rubis", background: { type: "gradient", from: "#991b1b", to: "#450a0a", angle: 150 } },
];

/** Aperçu CSS d'un fond (pastilles de choix). */
export function backgroundCss(b: PhotoStyle["background"]): string {
  if (b.type === "color") return b.color;
  if (b.type === "gradient") return `linear-gradient(${b.angle}deg, ${b.from}, ${b.to})`;
  return "repeating-conic-gradient(#d4d4d8 0% 25%, #f4f4f5 0% 50%) 50% / 16px 16px";
}

const luminance = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};

/** Charge une image de la même origine (photo servie par l'API) ou un fichier local. */
export async function loadBitmap(source: string | Blob): Promise<ImageBitmap> {
  if (typeof source !== "string") return createImageBitmap(source, { imageOrientation: "from-image" });
  const res = await fetch(source, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Photo introuvable dans le stockage.");
  return createImageBitmap(await res.blob());
}

/** Carte factice pour l'aperçu quand aucun scan n'est encore disponible. */
export function placeholderCard(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 630;
  canvas.height = 880;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#facc15";
  ctx.fillRect(0, 0, 630, 880);
  ctx.fillStyle = "#fef9c3";
  ctx.fillRect(34, 34, 562, 812);
  ctx.fillStyle = "#94a3b8";
  ctx.fillRect(64, 110, 502, 330);
  ctx.fillStyle = "#334155";
  ctx.font = "600 40px system-ui, sans-serif";
  ctx.fillText("Aperçu", 64, 86);
  ctx.fillStyle = "#cbd5e1";
  for (let i = 0; i < 4; i++) ctx.fillRect(64, 500 + i * 70, 502 - i * 60, 26);
  return canvas;
}

/**
 * Compose le visuel d'annonce : la carte scannée, rognée et arrondie, posée sur le fond choisi.
 * Le même dessin sert à l'aperçu des réglages et au fichier envoyé, donc ce qu'on voit est ce qui est publié.
 */
export function drawListingPhoto(
  canvas: HTMLCanvasElement,
  card: CanvasImageSource & { width: number; height: number },
  style: PhotoStyle,
  backgroundImage: ImageBitmap | null,
): void {
  const size = style.size;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const b = style.background;

  // Fond
  let dark = true;
  if (b.type === "image" && backgroundImage) {
    const scale = Math.max(size / backgroundImage.width, size / backgroundImage.height);
    const w = backgroundImage.width * scale;
    const h = backgroundImage.height * scale;
    ctx.drawImage(backgroundImage, (size - w) / 2, (size - h) / 2, w, h);
  } else if (b.type === "gradient") {
    const angle = ((b.angle - 90) * Math.PI) / 180;
    const dx = (Math.cos(angle) * size) / 2;
    const dy = (Math.sin(angle) * size) / 2;
    const gradient = ctx.createLinearGradient(size / 2 - dx, size / 2 - dy, size / 2 + dx, size / 2 + dy);
    gradient.addColorStop(0, b.from);
    gradient.addColorStop(1, b.to);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    dark = (luminance(b.from) + luminance(b.to)) / 2 < 0.55;
  } else {
    ctx.fillStyle = b.type === "color" ? b.color : "#e4e4e7";
    ctx.fillRect(0, 0, size, size);
    dark = b.type === "color" ? luminance(b.color) < 0.55 : false;
  }

  // Carte : rognage du liseré du scanner, puis mise à l'échelle dans la zone utile.
  const trimX = (card.width * style.trimPercent) / 100;
  const trimY = (card.height * style.trimPercent) / 100;
  const sw = card.width - 2 * trimX;
  const sh = card.height - 2 * trimY;
  const captionSpace = style.caption ? size * 0.045 : 0;
  const box = size * (1 - (2 * style.marginPercent) / 100);
  const scale = Math.min(box / sw, (box - captionSpace) / sh);
  const w = sw * scale;
  const h = sh * scale;
  const x = (size - w) / 2;
  const y = (size - captionSpace - h) / 2;
  const radius = style.roundCorners ? w * CORNER_RATIO : 0;

  const outline = new Path2D();
  outline.roundRect(x, y, w, h, radius);
  if (style.shadow) {
    ctx.save();
    ctx.shadowColor = `rgba(0, 0, 0, ${dark ? 0.55 : 0.3})`;
    ctx.shadowBlur = size * 0.035;
    ctx.shadowOffsetY = size * 0.014;
    ctx.fillStyle = "#000";
    ctx.fill(outline);
    ctx.restore();
  }
  ctx.save();
  ctx.clip(outline);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(card, trimX, trimY, sw, sh, x, y, w, h);
  ctx.restore();

  if (style.caption) {
    ctx.font = `500 ${Math.round(size * 0.024)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (b.type === "image") {
      ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
      ctx.shadowBlur = size * 0.008;
    }
    ctx.fillStyle = dark ? "rgba(255, 255, 255, 0.82)" : "rgba(15, 23, 42, 0.72)";
    ctx.fillText(style.caption, size / 2, size - (size * style.marginPercent) / 200 - captionSpace / 2, size * 0.9);
    ctx.shadowColor = "transparent";
  }
}

export async function composeListingPhoto(card: ImageBitmap, style: PhotoStyle, backgroundImage: ImageBitmap | null): Promise<Blob> {
  const canvas = document.createElement("canvas");
  drawListingPhoto(canvas, card, style, backgroundImage);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("Impossible de composer la photo.");
  return blob;
}
