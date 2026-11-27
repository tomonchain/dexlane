import type { NextRequest } from "next/server";
import { callApi } from "@/lib/backend";
import { isSameOrigin, jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Liste d'attente (#103) : une adresse laissée depuis /signup, relayée à l'API (route publique, sans session). */
export async function POST(req: NextRequest): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");
  const body = await req.text();
  if (body.length > 2000) return jsonError(413, "TOO_LARGE", "request too large");
  try {
    const res = await callApi("/api/public/waitlist", { method: "POST", body });
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error(e);
    return jsonError(502, "API_UNREACHABLE", "the dexlane API is not reachable");
  }
}
