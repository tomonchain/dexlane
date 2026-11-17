import type { NextRequest } from "next/server";
import { API_URL, SESSION_COOKIE, isSameOrigin, jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

const FORWARDED_REQUEST_HEADERS = ["content-type", "idempotency-key", "accept"];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "idempotent-replay"];

/** Relais vers l'API métier : ajoute le jeton du cookie de session, ne transmet rien d'autre du navigateur. */
async function relay(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return jsonError(401, "UNAUTHORIZED", "session expired");
  if (req.method !== "GET" && !isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");

  const { path } = await ctx.params;
  if (path.some((segment) => segment === "." || segment === "..")) return jsonError(404, "NOT_FOUND", "no such route");
  const url = new URL(`/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`, API_URL);
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === "GET" ? undefined : await req.arrayBuffer(),
      cache: "no-store",
    });
  } catch {
    return jsonError(502, "API_UNREACHABLE", "the dexlane API is not reachable");
  }

  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { relay as GET, relay as POST };
