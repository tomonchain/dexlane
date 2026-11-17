import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { callApi } from "@/lib/backend";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Tâche quotidienne (Vercel Cron, voir vercel.json) : relève les cotations des cartes en stock,
 * publie les annonces planifiées pour aujourd'hui, puis synchronise les canaux de vente. Vercel présente `CRON_SECRET` en jeton porteur ; sans lui, rien ne s'exécute.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET ?? "";
  const presented = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "cron secret required" } }, { status: 401 });
  }
  const run = async (path: string) => {
    try {
      const res = await callApi(path, { method: "POST" });
      return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
    } catch (e) {
      console.error(e);
      return { status: 502, body: null };
    }
  };
  const prices = await run("/api/prices/refresh");
  const publications = await run("/api/publications/run");
  const channels = await run("/api/channels/sync");
  const ok = [prices, publications, channels].every((r) => r.status === 200);
  return Response.json({ prices, publications, channels }, { status: ok ? 200 : 502 });
}
