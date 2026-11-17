import type { NextRequest } from "next/server";

/** Cookie httpOnly portant le jeton du propriétaire : illisible par le JavaScript de la page. */
export const SESSION_COOKIE = "dexlane_session";
export const SESSION_MAX_AGE_S = 90 * 24 * 3600;

export const jsonError = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

/**
 * Refuse les requêtes modifiantes venant d'un autre site (en plus du cookie SameSite=Strict).
 * Compare l'en-tête Origin à l'hôte demandé, tel que vu par le navigateur (derrière un reverse proxy).
 */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return (req.headers.get("sec-fetch-site") ?? "same-origin") === "same-origin";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const isHttps = (req: NextRequest) =>
  (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https";
