import "server-only";
import type { Hono } from "hono";
import { serverToken } from "./session";

/**
 * Accès à l'API métier, de deux façons :
 * - `DEXLANE_API_URL` défini : l'API tourne à part (apps/api), on la joint en HTTP ;
 * - sinon : l'API est embarquée dans ce serveur Next (un seul déploiement, p. ex. Vercel) et lit
 *   `DATABASE_URL` et les identifiants Anthropic directement.
 * Dans les deux cas le serveur web s'authentifie avec `DEXLANE_API_TOKEN`. Pour un navigateur, il transmet son cookie
 * de session : c'est l'API (BetterAuth) qui dit de quel compte il s'agit.
 */
export async function callApi(
  pathAndQuery: string,
  init: {
    method?: string; headers?: Headers; body?: ArrayBuffer | string; accountId?: string;
    /** Lecture publique mise en cache (secondes) : sans elle, l'appel distant n'est jamais mis en cache. */
    revalidate?: number;
  } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${serverToken()}`);
  // Le compte pour lequel l'API travaille : elle cloisonne ses données. Sans lui, c'est le compte d'installation.
  if (init.accountId !== undefined) headers.set("X-Dexlane-Account", init.accountId);
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  const request = { method: init.method ?? "GET", headers, body: init.body };

  const remote = process.env.DEXLANE_API_URL;
  // Les redirections (lien de vérification d'adresse) sont rendues telles quelles au navigateur.
  if (remote) {
    const caching = init.revalidate === undefined ? { cache: "no-store" as const } : { next: { revalidate: init.revalidate } };
    return fetch(new URL(pathAndQuery, remote), { ...request, ...caching, redirect: "manual" });
  }
  const app = await embeddedApp();
  return app.fetch(new Request(new URL(pathAndQuery, "http://dexlane.internal"), request));
}

/**
 * Relaie une requête telle quelle, avec l'en-tête `Authorization` de l'appelant (jeton d'agent du serveur MCP) au lieu
 * du jeton du serveur web : c'est l'API qui vérifie le jeton.
 */
export async function forwardToApi(pathAndQuery: string, req: Request): Promise<Response> {
  const headers = new Headers();
  for (const name of ["authorization", "content-type", "accept", "mcp-protocol-version"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const init = { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer() };
  const remote = process.env.DEXLANE_API_URL;
  if (remote) return fetch(new URL(pathAndQuery, remote), { ...init, cache: "no-store" });
  const app = await embeddedApp();
  return app.fetch(new Request(new URL(pathAndQuery, "http://dexlane.internal"), init));
}

// Une seule instance (et un seul pool de connexions) par processus, y compris après rechargement à chaud.
const globals = globalThis as { __dexlaneApp?: Promise<Pick<Hono, "fetch">> };

function embeddedApp(): Promise<Pick<Hono, "fetch">> {
  return (globals.__dexlaneApp ??= (async () => {
    const [{ createApp }, { createBlobPhotoStore }, { createDb }, { createClaudeRecognizer }] = await Promise.all([
      import("@dexlane/api"),
      import("@dexlane/api/photos"),
      import("@dexlane/db"),
      import("@dexlane/scan"),
    ]);
    // prepare: false → compatible avec un pooler en mode transaction (Supabase, PgBouncer) ;
    // petit pool et connexions inactives relâchées : adapté aux fonctions serverless.
    const sql = createDb(process.env.DATABASE_URL, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 });
    let recognizer: ReturnType<typeof createClaudeRecognizer> | undefined;
    return createApp({
      sql,
      token: serverToken(),
      photos: createBlobPhotoStore(),
      recognizer: () => (recognizer ??= createClaudeRecognizer({ model: process.env.SCAN_MODEL || undefined })),
    });
  })().catch((e) => {
    globals.__dexlaneApp = undefined; // une configuration corrigée est reprise au prochain appel
    throw e;
  }));
}
