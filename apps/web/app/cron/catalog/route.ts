import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { callApi } from "@/lib/backend";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Tâche de nuit (Vercel Cron, voir vercel.json) : importe les séries françaises qui manquent encore au catalogue, les plus
 * récentes d'abord, pendant quatre minutes. En quelques nuits, tout le catalogue est là. Protégée par `CRON_SECRET`.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET ?? "";
  const presented = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "cron secret required" } }, { status: 401 });
  }
  try {
    const res = await callApi("/api/catalog/import/next", { method: "POST", body: JSON.stringify({ language: "fr", budgetSeconds: 240 }) });
    return Response.json(await res.json().catch(() => null), { status: res.status });
  } catch (e) {
    console.error(e);
    return Response.json({ error: { code: "API_UNREACHABLE", message: "the dexlane API is not reachable" } }, { status: 502 });
  }
}
