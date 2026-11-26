import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Les sessions sont tenues par BetterAuth, dans l'API : un cookie httpOnly dont seule l'API connaît la valeur. Le
 * serveur web ne fait que regarder s'il est présent (pour choisir entre la landing et l'application) ; c'est l'API qui
 * le vérifie à chaque requête.
 */
const SESSION_COOKIES = ["dexlane.session_token", "__Secure-dexlane.session_token"];

/** Un cookie de session est-il présenté ? Indication seulement : sa validité est vérifiée par l'API. */
export const hasSessionCookie = (cookies: { get(name: string): { value: string } | undefined }) =>
  SESSION_COOKIES.some((name) => !!cookies.get(name)?.value);

export class ServerConfigError extends Error {}

/** Jeton d'API détenu par le serveur web : il authentifie ses appels à l'API. */
export function serverToken(): string {
  const token = process.env.DEXLANE_API_TOKEN ?? "";
  if (token.length < 24) throw new ServerConfigError("DEXLANE_API_TOKEN must be set (at least 24 characters) on the web server");
  return token;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Comparaison à temps constant, y compris quand les longueurs diffèrent. */
export const secretEquals = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export const jsonError = (status: number, code: string, message: string, details?: unknown) =>
  Response.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status });

/**
 * Refuse les requêtes modifiantes venant d'un autre site (en plus de l'attribut SameSite du cookie de session).
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
