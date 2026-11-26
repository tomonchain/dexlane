import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { HERO_VARIANT, HERO_VARIANTS } from "@/components/landing/content";

/** Image de partage du site (/og.png) : le titre du hero sur le fond de la marque, sans logo tiers. Générée au build. */
export const dynamic = "force-static";
const size = { width: 1200, height: 630 };

const font = (file: string) => readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans", file));

export async function GET() {
  const [medium, semibold] = await Promise.all([font("Geist-Medium.ttf"), font("Geist-SemiBold.ttf")]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(135deg, #ffb86b 0%, #f18a1f 45%, #c4521a 100%)",
          color: "#1d1a17",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", position: "relative", width: 44, height: 44 }}>
            <div style={{ position: "absolute", left: 6, top: 6, width: 24, height: 33, borderRadius: 5, background: "rgba(29,26,23,0.25)", transform: "rotate(-12deg)" }} />
            <div style={{ position: "absolute", left: 15, top: 5, width: 24, height: 33, borderRadius: 5, background: "#1d1a17", transform: "rotate(6deg)" }} />
          </div>
          <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: -1 }}>dexlane</div>
        </div>
        <div style={{ display: "flex", fontSize: 76, fontWeight: 500, lineHeight: 1.05, letterSpacing: -3, maxWidth: 1000 }}>
          {HERO_VARIANTS[HERO_VARIANT].h1}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: medium, style: "normal", weight: 500 },
        { name: "Geist", data: semibold, style: "normal", weight: 600 },
      ],
    },
  );
}
