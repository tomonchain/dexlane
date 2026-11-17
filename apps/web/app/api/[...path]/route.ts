import type { NextRequest } from "next/server";
import { callApi } from "@/lib/backend";
import { ServerConfigError, isSameOrigin, jsonError, readSession } from "@/lib/session";

export const dynamic = "force-dynamic";
/** Un scan attend le modèle de vision, une synchronisation de série télécharge des centaines de cartes : laisser de la marge. */
export const maxDuration = 300;

const FORWARDED_REQUEST_HEADERS = ["content-type", "idempotency-key", "accept"];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "idempotent-replay"];

/** Relais vers l'API métier (distante ou embarquée) pour une session navigateur valide. */
async function relay(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  let session: ReturnType<typeof readSession>;
  try {
    session = readSession(req);
  } catch (e) {
    if (e instanceof ServerConfigError) return jsonError(500, "SERVER_MISCONFIGURED", e.message);
    throw e;
  }
  if (!session) return jsonError(401, "UNAUTHORIZED", "session expired");
  if (req.method !== "GET" && !isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");

  const { path } = await ctx.params;
  // Les routes de mot de passe ne passent pas par ici : une session ne doit pas pouvoir réinitialiser
  // le mot de passe sans le connaître (voir /auth).
  if (path[0] === "auth" || path.some((segment) => segment === "." || segment === "..")) {
    return jsonError(404, "NOT_FOUND", "no such route");
  }
  const target = `/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await callApi(target, {
      method: req.method,
      headers,
      body: req.method === "GET" ? undefined : await req.arrayBuffer(),
      sessionVersion: session.sessionVersion,
    });
  } catch (e) {
    console.error(e);
    return jsonError(502, "API_UNREACHABLE", "the dexlane API is not reachable");
  }

  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { relay as GET, relay as POST, relay as PATCH, relay as DELETE };
