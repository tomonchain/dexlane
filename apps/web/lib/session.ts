import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Session du navigateur : un cookie httpOnly signé par le serveur web, illisible et infalsifiable côté page.
 * Il ne contient ni le mot de passe ni le jeton d'API, seulement la « version de session » en vigueur à la
 * connexion ; l'API refuse une version périmée, ce qui déconnecte tous les appareils au changement de mot de passe.
 */
export const SESSION_COOKIE = "dexlane_session";
export const SESSION_MAX_AGE_S = 30 * 24 * 3600;

export class ServerConfigError extends Error {}

/** Jeton d'API détenu par le serveur web : il authentifie ses appels à l'API et sert de clé de signature. */
export function serverToken(): string {
  const token = process.env.DEXLANE_API_TOKEN ?? "";
  if (token.length < 24) throw new ServerConfigError("DEXLANE_API_TOKEN must be set (at least 24 characters) on the web server");
  return token;
}

const signingKey = () => createHmac("sha256", serverToken()).update("dexlane-web-session-v1").digest();
const sign = (payload: string) => createHmac("sha256", signingKey()).update(payload).digest("base64url");
const digest = (s: string) => createHash("sha256").update(s).digest();

/** Comparaison à temps constant, y compris quand les longueurs diffèrent. */
export const secretEquals = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export function issueSession(sessionVersion: number): string {
  const payload = Buffer.from(JSON.stringify({ sv: sessionVersion, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_S })).toString("base64url");
  return `v1.${payload}.${sign(payload)}`;
}

export function readSession(req: NextRequest): { sessionVersion: number } | null {
  const [version, payload, signature] = (req.cookies.get(SESSION_COOKIE)?.value ?? "").split(".");
  if (version !== "v1" || !payload || !signature || !secretEquals(signature, sign(payload))) return null;
  try {
    const { sv, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { sv?: unknown; exp?: unknown };
    if (typeof sv !== "number" || typeof exp !== "number" || exp < Date.now() / 1000) return null;
    return { sessionVersion: sv };
  } catch {
    return null;
  }
}

export const jsonError = (status: number, code: string, message: string, details?: unknown) =>
  Response.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status });

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
