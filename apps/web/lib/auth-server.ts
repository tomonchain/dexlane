import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { callApi } from "@/lib/backend";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, ServerConfigError, isHttps, issueSession, jsonError } from "@/lib/session";

type ApiError = { error?: { code?: string; message?: string; details?: unknown } };

/** Appelle l'API et renvoie soit le corps JSON, soit une réponse d'erreur prête à être retournée au navigateur. */
export async function authApi<T>(path: string, init?: Parameters<typeof callApi>[1]): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
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

/** Ce que l'API renvoie quand une session peut s'ouvrir. */
export interface Granted {
  accountId: string;
  sessionVersion: number;
}

/** Ouvre la session du compte : cookie httpOnly signé. */
export function withSession(req: NextRequest, granted: Granted): Response {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, issueSession(granted.sessionVersion, granted.accountId), {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps(req),
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}

/**
 * Adresse publique du site, pour les liens des e-mails : `NEXT_PUBLIC_SITE_URL`, sinon l'adresse du déploiement
 * (preview) ou de production sur Vercel, sinon l'origine de la requête (développement).
 */
export function publicBaseUrl(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return req.nextUrl.origin;
}
