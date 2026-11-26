import type { NextRequest } from "next/server";
import { callApi } from "@/lib/backend";
import { isSameOrigin, jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Désinscription de l'e-mail du récap, depuis le lien d'un e-mail (sans session) : le lien porte une signature que
 * l'API vérifie. Un POST, après un clic : un antivirus qui suit les liens d'un e-mail ne désinscrit personne.
 */
export async function POST(req: NextRequest): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");
  const body = await req.text();
  try {
    const res = await callApi("/api/public/recap-email/unsubscribe", { method: "POST", body });
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error(e);
    return jsonError(502, "API_UNREACHABLE", "the dexlane API is not reachable");
  }
}
