import type { NextRequest } from "next/server";
import { callApi } from "@/lib/backend";
import { ServerConfigError, hasSessionCookie, isSameOrigin, jsonError, secretEquals, serverToken } from "@/lib/session";

export const dynamic = "force-dynamic";

type ApiError = { error?: { code?: string; message?: string; details?: unknown } };

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

/**
 * L'installation a-t-elle déjà son propriétaire ? Sinon, l'assistant de démarrage le crée. Avec une session ouverte (un
 * compte inscrit), la question ne se pose pas.
 */
export async function GET(req: NextRequest): Promise<Response> {
  if (hasSessionCookie(req.cookies)) return Response.json({ passwordSet: true });
  const status = await api<{ passwordSet: boolean }>("/api/setup/status");
  return status.ok ? Response.json({ passwordSet: status.data.passwordSet }) : status.response;
}

/**
 * Propriétaire de l'installation : `{ setupToken, email, newPassword }`. Le jeton d'installation (`DEXLANE_API_TOKEN`)
 * prouve qu'on administre le serveur : il crée le propriétaire à la première connexion, et sert de clé de secours pour
 * remplacer son adresse et son mot de passe. La connexion elle-même passe ensuite par /api/auth/sign-in/email.
 */
export async function POST(req: NextRequest): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, "CROSS_ORIGIN", "cross-origin request refused");
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const text = (key: string) => (typeof body?.[key] === "string" ? (body[key] as string) : "");
  try {
    if (!secretEquals(text("setupToken").trim(), serverToken())) return jsonError(401, "INVALID_SETUP_TOKEN", "invalid setup token");
  } catch (e) {
    if (e instanceof ServerConfigError) return jsonError(500, "SERVER_MISCONFIGURED", e.message);
    throw e;
  }
  const done = await api<{ ok: true }>("/api/setup/owner", { method: "POST", body: JSON.stringify({ email: text("email"), password: text("newPassword") }) });
  return done.ok ? Response.json({ ok: true }) : done.response;
}
