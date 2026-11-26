import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ShareCard, ShareMetric } from "@dexlane/insights/share";

/**
 * Rendu de l'image de partage d'un récap (#85), côté serveur et sans service externe : `next/og` (Satori et Resvg,
 * embarqués dans Next) et la police Geist lue sur le disque. Aucune image de carte : du texte seulement.
 */

export interface ShareTexts {
  /** « Mon récap du mois », « Mon récap de l'année ». */
  eyebrow: string;
  /** « Novembre 2026 », « 2026 ». */
  heading: string;
  metric: (m: ShareMetric) => { value: string; label: string };
  /** « Meilleure vente : Dracaufeu », avec son prix seulement si le chiffre d'affaires est affiché. */
  bestSale: (sale: NonNullable<ShareCard["bestSale"]>) => string;
}

const BG = "#1d1a17";
const FG = "#fbfaf8";
const MUTED = "rgba(251,250,248,0.62)";
const BRAND = "#f18a1f";

/** La police Geist du paquet `geist` (le dossier courant est celui de l'application, pour Next comme pour les scripts). */
const font = (file: string) => readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans", file));

export async function renderShareImage(card: ShareCard, texts: ShareTexts): Promise<ImageResponse> {
  const [medium, semibold] = await Promise.all([font("Geist-Medium.ttf"), font("Geist-SemiBold.ttf")]);
  const story = card.height > 1500;
  const metrics = card.metrics.map((m) => ({ key: m.key, ...texts.metric(m) }));
  const best = card.bestSale ? texts.bestSale(card.bestSale) : null;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: story ? "140px 96px" : "96px 88px", background: BG, color: FG, fontFamily: "Geist" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", width: 72, height: 8, borderRadius: 4, background: BRAND }} />
          <div style={{ display: "flex", fontSize: 34, fontWeight: 500, color: MUTED }}>{texts.eyebrow}</div>
          <div style={{ display: "flex", fontSize: story ? 76 : 68, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05 }}>{texts.heading}</div>
          {card.shopName && <div style={{ display: "flex", fontSize: 36, fontWeight: 500, color: MUTED }}>{card.shopName}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: story ? 64 : 44 }}>
          {metrics.map((m) => (
            <div key={m.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", fontSize: story ? 120 : 104, fontWeight: 600, letterSpacing: -4, lineHeight: 1 }}>{m.value}</div>
              <div style={{ display: "flex", fontSize: 36, fontWeight: 500, color: MUTED }}>{m.label}</div>
            </div>
          ))}
          {best && <div style={{ display: "flex", fontSize: 34, fontWeight: 500, color: MUTED, maxWidth: 880 }}>{best}</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: 30, fontWeight: 500, color: MUTED }}>
          <div style={{ display: "flex" }}>dexlane</div>
          {card.referralLink && <div style={{ display: "flex" }}>{card.referralLink}</div>}
        </div>
      </div>
    ),
    {
      width: card.width,
      height: card.height,
      fonts: [
        { name: "Geist", data: medium, style: "normal", weight: 500 },
        { name: "Geist", data: semibold, style: "normal", weight: 600 },
      ],
    },
  );
}
