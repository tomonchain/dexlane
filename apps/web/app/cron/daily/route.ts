import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { callApi } from "@/lib/backend";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Tâche quotidienne (Vercel Cron, voir vercel.json), pour chaque compte actif : relève les cotations des cartes en stock,
 * publie les annonces planifiées pour aujourd'hui, synchronise les canaux de vente, suit les colis en route et rappelle
 * les avis à demander, recalcule la progression (ventes confirmées, niveau, succès) et génère les récaps dus, puis envoie
 * le résumé du matin sur les téléphones abonnés. Vercel présente `CRON_SECRET` en jeton porteur ; sans lui, rien ne s'exécute.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET ?? "";
  const presented = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "cron secret required" } }, { status: 401 });
  }
  const run = async (path: string, accountId: string) => {
    try {
      const res = await callApi(path, { method: "POST", accountId });
      return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
    } catch (e) {
      console.error(e);
      return { status: 502, body: null };
    }
  };
  // Chaque compte actif a ses cartes, son planning, ses canaux et ses abonnements : la tâche tourne pour chacun.
  let accountIds: string[];
  try {
    const res = await callApi("/api/accounts/active");
    accountIds = ((await res.json()) as { accountIds: string[] }).accountIds;
  } catch (e) {
    console.error(e);
    return Response.json({ error: { code: "API_UNREACHABLE", message: "could not list accounts" } }, { status: 502 });
  }
  const accounts = [];
  for (const accountId of accountIds) {
    const prices = await run("/api/prices/refresh", accountId);
    const publications = await run("/api/publications/run", accountId);
    const channels = await run("/api/channels/sync", accountId);
    // Où en sont les colis, puis les avis à demander pour les ventes livrées depuis 24 h.
    const tracking = await run("/api/shipments/tracking/refresh", accountId);
    const reviews = await run("/api/sales/reviews/remind", accountId);
    // Journal rattrapé, ventes confirmées, niveau et succès recalculés ; le 1er du mois, le récap du mois écoulé.
    const progression = await run("/api/insights/daily", accountId);
    // En dernier : le résumé envoyé sur le téléphone compte ce que les étapes précédentes viennent de faire.
    const notifications = await run("/api/notifications/digest", accountId);
    accounts.push({ accountId, prices, publications, channels, tracking, reviews, progression, notifications });
  }
  const ok = accounts.every((a) => [a.prices, a.publications, a.channels, a.tracking, a.reviews, a.progression, a.notifications].every((r) => r.status === 200));
  return Response.json({ accounts }, { status: ok ? 200 : 502 });
}
