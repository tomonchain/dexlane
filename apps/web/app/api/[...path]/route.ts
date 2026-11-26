import type { NextRequest } from "next/server";
import { callApi } from "@/lib/backend";
import { hasSessionCookie, isHttps, isSameOrigin, jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";
/** Un scan attend le modèle de vision, une synchronisation de série télécharge des centaines de cartes : laisser de la marge. */
export const maxDuration = 300;

// Jamais « x-dexlane-account » : un navigateur ne choisit pas son compte, c'est sa session qui le dit.
const FORWARDED_REQUEST_HEADERS = ["content-type", "idempotency-key", "accept", "cookie", "origin", "user-agent"];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "content-disposition", "idempotent-replay", "location"];
/** Réservé au serveur : installation (jeton d'installation, voir /auth) et liste des comptes (tâches planifiées). */
const SERVER_ONLY = ["setup", "accounts"];

/**
 * Relais du navigateur vers l'API métier (distante ou embarquée). Les routes de BetterAuth (/api/auth/* : connexion,
 * inscription, lien de vérification, mot de passe) passent telles quelles, cookies compris ; toutes les autres
 * demandent une session, que l'API vérifie.
 */
async function relay(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  if (req.method !== "GET" && !isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");
  const { path } = await ctx.params;
  if (SERVER_ONLY.includes(path[0] ?? "") || path.some((segment) => segment === "." || segment === "..")) {
    return jsonError(404, "NOT_FOUND", "no such route");
  }
  const authRoute = path[0] === "auth";
  if (!authRoute && !hasSessionCookie(req.cookies)) return jsonError(401, "UNAUTHORIZED", "session expired");

  const target = `/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  // BetterAuth compare l'origine de la requête aux origines de confiance. Un client sans en-tête Origin (script, test)
  // a déjà passé le contrôle de même origine ci-dessus : son origine est celle du site.
  if (!headers.has("origin")) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host) headers.set("origin", `${isHttps(req) ? "https" : "http"}://${host}`);
  }
  headers.set("X-Dexlane-Browser", "1");
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);

  let upstream: Response;
  try {
    upstream = await callApi(target, { method: req.method, headers, body: req.method === "GET" ? undefined : await req.arrayBuffer() });
  } catch (e) {
    console.error(e);
    return jsonError(502, "API_UNREACHABLE", "the dexlane API is not reachable");
  }

  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  // La session s'ouvre et se ferme par les cookies que pose BetterAuth.
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append("Set-Cookie", cookie);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { relay as GET, relay as POST, relay as PUT, relay as PATCH, relay as DELETE };
