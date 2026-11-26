import type { NextRequest } from "next/server";
import { defaultShareOptions, isShareFormat, shareCardModel, type ShareOptions } from "@dexlane/insights/share";
import type { RecapData } from "@dexlane/insights";
import { callApi } from "@/lib/backend";
import { LOCALE_COOKIE, resolveLocale, setCurrentLocale } from "@/lib/i18n";
import { hasSessionCookie, jsonError } from "@/lib/session";
import { renderShareImage } from "@/lib/share-image";
import { shareTexts } from "@/lib/share-texts";

export const dynamic = "force-dynamic";

/**
 * Image de partage d'un récap (#85), générée à la demande de l'utilisateur, sur le serveur, sans service externe. Elle
 * n'est stockée nulle part : la réponse est l'image, téléchargée telle quelle, jamais mise en cache.
 *
 * ?format=post|story, puis les interrupteurs choisis avant la génération : revenue=1 (chiffre d'affaires, désactivé
 * par défaut), shop=1 (nom de la boutique, désactivé par défaut), referral=0|1 (lien de parrainage).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ period: string }> }): Promise<Response> {
  if (!hasSessionCookie(req.cookies)) return jsonError(401, "UNAUTHORIZED", "session expired");
  const { period } = await ctx.params;
  if (!/^\d{4}(-\d{2})?$/.test(period)) return jsonError(400, "VALIDATION_ERROR", "a period is YYYY-MM or YYYY");
  const query = req.nextUrl.searchParams;
  const format = query.get("format") ?? "post";
  if (!isShareFormat(format)) return jsonError(400, "VALIDATION_ERROR", "format is post or story");

  // Le récap, lu pour la session du navigateur (l'API vérifie la session et cloisonne le compte).
  const headers = new Headers({ "X-Dexlane-Browser": "1", origin: req.nextUrl.origin });
  for (const name of ["cookie", "user-agent"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const res = await callApi(`/api/insights/recaps/${period}`, { headers });
  if (!res.ok) return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
  const recap = (await res.json()) as { data: RecapData; showProgression: boolean; shopName: string | null; referral: { link: string } | null };

  const defaults = defaultShareOptions(format);
  const flag = (name: string, fallback: boolean) => (query.has(name) ? query.get(name) === "1" : fallback);
  const options: ShareOptions = {
    format,
    showRevenue: flag("revenue", defaults.showRevenue),
    showShopName: flag("shop", defaults.showShopName),
    showReferral: flag("referral", defaults.showReferral),
  };
  const card = shareCardModel(recap.data, options, { shopName: recap.shopName, showProgression: recap.showProgression, referralLink: recap.referral?.link ?? null });
  // Les textes sont calculés d'un coup, dans la langue de l'utilisateur, avant le rendu.
  setCurrentLocale(resolveLocale(req.cookies.get(LOCALE_COOKIE)?.value, req.headers.get("accept-language")));
  const texts = shareTexts(card);
  const image = await renderShareImage(card, texts);
  return new Response(image.body, {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="dexlane-recap-${period}-${format}.png"`,
    },
  });
}
