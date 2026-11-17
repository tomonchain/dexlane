import { NextResponse, type NextRequest } from "next/server";
import { callApi } from "@/lib/backend";
import {
  SESSION_COOKIE, SESSION_MAX_AGE_S, ServerConfigError, isHttps, isSameOrigin, issueSession, jsonError, readSession,
  secretEquals, serverToken,
} from "@/lib/session";

export const dynamic = "force-dynamic";

type ApiError = { error?: { code?: string; message?: string; details?: unknown } };

/** Appelle l'API et renvoie soit le corps JSON, soit une réponse d'erreur prête à être retournée au navigateur. */
async function api<T>(path: string, init?: Parameters<typeof callApi>[1]): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let res: Response;
  try {
    res = await callApi(path, init);
  } catch (e) {
    if (e instanceof ServerConfigError) return { ok: false, response: jsonError(500, "SERVER_MISCONFIGURED", e.message) };
    console.error(e);
    return { ok: false, response: jsonError(502, "API_UNREACHABLE", "the dexlane API is not reachable") };
  }
  const data = (await res.json().catch(() => null)) as (T & ApiError) | null;
  if (res.ok && data) return { ok: true, data };
  const error = data?.error;
  return { ok: false, response: jsonError(res.status >= 400 ? res.status : 502, error?.code ?? "API_ERROR", error?.message ?? `the dexlane API answered ${res.status}`, error?.details) };
}

function withSession(req: NextRequest, sessionVersion: number): Response {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, issueSession(sessionVersion), {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps(req),
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}

/** État de l'écran de connexion : un mot de passe existe-t-il déjà ? */
export async function GET(): Promise<Response> {
  const status = await api<{ passwordSet: boolean }>("/api/auth/status");
  return status.ok ? Response.json({ passwordSet: status.data.passwordSet }) : status.response;
}

/**
 * Connexion par mot de passe : `{ password }`.
 * Première connexion ou mot de passe oublié : `{ setupToken, newPassword }`, où le jeton d'installation est
 * `DEXLANE_API_TOKEN` — la preuve qu'on administre le serveur.
 */
export async function POST(req: NextRequest): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const text = (key: string) => (typeof body?.[key] === "string" ? (body[key] as string) : "");

  if (text("setupToken") || text("newPassword")) {
    try {
      if (!secretEquals(text("setupToken").trim(), serverToken())) return jsonError(401, "INVALID_SETUP_TOKEN", "invalid setup token");
    } catch (e) {
      if (e instanceof ServerConfigError) return jsonError(500, "SERVER_MISCONFIGURED", e.message);
      throw e;
    }
    const reset = await api<{ sessionVersion: number }>("/api/auth/password/reset", {
      method: "POST",
      body: JSON.stringify({ newPassword: text("newPassword") }),
    });
    return reset.ok ? withSession(req, reset.data.sessionVersion) : reset.response;
  }

  if (!text("password")) return jsonError(400, "PASSWORD_REQUIRED", "password is required");
  const verified = await api<{ sessionVersion: number }>("/api/auth/password/verify", {
    method: "POST",
    body: JSON.stringify({ password: text("password") }),
  });
  return verified.ok ? withSession(req, verified.data.sessionVersion) : verified.response;
}

/** Changement de mot de passe depuis une session ouverte ; la session courante est renouvelée, les autres tombent. */
export async function PUT(req: NextRequest): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");
  try {
    if (!readSession(req)) return jsonError(401, "UNAUTHORIZED", "session expired");
  } catch (e) {
    if (e instanceof ServerConfigError) return jsonError(500, "SERVER_MISCONFIGURED", e.message);
    throw e;
  }
  const body = (await req.json().catch(() => null)) as { currentPassword?: unknown; newPassword?: unknown } | null;
  if (typeof body?.currentPassword !== "string" || typeof body.newPassword !== "string") {
    return jsonError(400, "PASSWORD_REQUIRED", "currentPassword and newPassword are required");
  }
  const changed = await api<{ sessionVersion: number }>("/api/auth/password/change", {
    method: "POST",
    body: JSON.stringify({ currentPassword: body.currentPassword, newPassword: body.newPassword }),
  });
  return changed.ok ? withSession(req, changed.data.sessionVersion) : changed.response;
}

export async function DELETE(req: NextRequest): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
