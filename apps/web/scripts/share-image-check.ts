/**
 * Contrôle de l'image de partage des récaps (#85) : les deux formats ont les bonnes dimensions (1080 × 1350 et
 * 1080 × 1920), et par défaut l'image ne montre aucun montant. Lancé par `pnpm --filter @dexlane/web test`.
 * `--out <dossier>` écrit en plus les images générées.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultShareOptions, shareCardModel, SHARE_FORMATS, type ShareFormat } from "@dexlane/insights/share";
import type { RecapData } from "@dexlane/insights";
import { setCurrentLocale } from "../lib/i18n";
import { renderShareImage } from "../lib/share-image";
import { shareTexts } from "../lib/share-texts";

/** Un récap fictif : un mois de ventes avec une belle carte (25 000 €, montant qui ne doit pas sortir par défaut). */
export const SAMPLE_RECAP: RecapData = {
  version: 1, period: "2026-10", kind: "month", start: "2026-09-30T22:00:00.000Z", end: "2026-10-31T23:00:00.000Z", timezone: "Europe/Paris",
  listingsPublished: 184, cardsSold: 127, revenue: [{ currency: "EUR", cents: 2_513_200 }], timeSavedMinutes: 736,
  bestSale: { name: "Dracaufeu ex", setName: "Flammes Obsidiennes", unitPriceCents: 2_500_000, currency: "EUR", soldAt: "2026-10-20T10:00:00.000Z" },
  fastestSale: { name: "Pikachu", setName: "151", days: 0.2, soldAt: "2026-10-06T20:00:00.000Z" },
  achievements: [{ id: "sales_100", name: "Cent", unlockedAt: "2026-10-18T09:00:00.000Z" }, { id: "regular", name: "Régulier", unlockedAt: "2026-10-26T09:00:00.000Z" }],
  level: { level: 4, next: { level: 5, threshold: 400, salesNeeded: 52 }, progressPercent: 79, confirmedSales: 348 },
  recordMonth: null, achievementsCount: 2,
};

/** Largeur et hauteur lues dans l'en-tête IHDR d'un PNG. */
function pngSize(png: Buffer): { width: number; height: number } {
  if (png.toString("ascii", 1, 4) !== "PNG") throw new Error("not a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const failures: string[] = [];
setCurrentLocale("fr");
for (const format of Object.keys(SHARE_FORMATS) as ShareFormat[]) {
  const card = shareCardModel(SAMPLE_RECAP, defaultShareOptions(format), { shopName: "Ma boutique", showProgression: true });
  const texts = shareTexts(card);
  const shown = [texts.heading, ...card.metrics.map((m) => Object.values(texts.metric(m)).join(" ")), card.bestSale ? texts.bestSale(card.bestSale) : ""].join("\n");
  if (/€|\bEUR\b|25[\s .]?000|25[\s .]?132/.test(shown)) failures.push(`${format}: un montant apparaît par défaut :\n${shown}`);
  if (card.shopName !== null) failures.push(`${format}: le nom de la boutique apparaît par défaut`);
  const png = Buffer.from(await (await renderShareImage(card, texts)).arrayBuffer());
  const size = pngSize(png);
  if (size.width !== SHARE_FORMATS[format].width || size.height !== SHARE_FORMATS[format].height) {
    failures.push(`${format}: ${size.width} × ${size.height} au lieu de ${SHARE_FORMATS[format].width} × ${SHARE_FORMATS[format].height}`);
  }
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `recap-${format}.png`), png);
  }
  console.log(`${format} : ${size.width} × ${size.height}, ${card.metrics.map((m) => m.key).join(", ")}`);
}
if (failures.length) {
  console.log(`\nImage de partage :\n${failures.join("\n")}`);
  process.exit(1);
}
