import { NextResponse, type NextRequest } from "next/server";
import { callApi } from "@/lib/backend";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, isHttps, isSameOrigin, jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Connexion : vérifie le jeton auprès de l'API puis le range dans un cookie httpOnly. */
export async function POST(req: NextRequest): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return jsonError(400, "TOKEN_REQUIRED", "token is required");

  let check: Response;
  try {
    check = await callApi("/api/locations", token);
  } catch (e) {
    console.error(e);
    return jsonError(502, "API_UNREACHABLE", "the dexlane API is not reachable");
  }
  if (check.status === 401) return jsonError(401, "UNAUTHORIZED", "invalid token");
  if (!check.ok) return jsonError(502, "API_ERROR", `the dexlane API answered ${check.status}`);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps(req),
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}

export async function DELETE(req: NextRequest): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
