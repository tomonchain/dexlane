import "server-only";
import type { Hono } from "hono";
import { serverToken } from "./session";

/**
 * Accès à l'API métier, de deux façons :
 * - `DEXLANE_API_URL` défini : l'API tourne à part (apps/api), on la joint en HTTP ;
 * - sinon : l'API est embarquée dans ce serveur Next (un seul déploiement, p. ex. Vercel) et lit
 *   `DATABASE_URL` et les identifiants Anthropic directement.
 * Dans les deux cas le serveur web s'authentifie avec `DEXLANE_API_TOKEN`. `sessionVersion` accompagne les
 * appels faits pour une session navigateur : l'API rejette une session antérieure au mot de passe courant.
 */
export async function callApi(
  pathAndQuery: string,
  init: { method?: string; headers?: Headers; body?: ArrayBuffer | string; sessionVersion?: number } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${serverToken()}`);
  if (init.sessionVersion !== undefined) headers.set("X-Dexlane-Session-Version", String(init.sessionVersion));
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  const request = { method: init.method ?? "GET", headers, body: init.body };

  const remote = process.env.DEXLANE_API_URL;
  if (remote) return fetch(new URL(pathAndQuery, remote), { ...request, cache: "no-store" });
  const app = await embeddedApp();
  return app.fetch(new Request(new URL(pathAndQuery, "http://dexlane.internal"), request));
}

// Une seule instance (et un seul pool de connexions) par processus, y compris après rechargement à chaud.
const globals = globalThis as { __dexlaneApp?: Promise<Pick<Hono, "fetch">> };

function embeddedApp(): Promise<Pick<Hono, "fetch">> {
  return (globals.__dexlaneApp ??= (async () => {
    const [{ createApp }, { createDb }, { createClaudeRecognizer }] = await Promise.all([
      import("@dexlane/api"),
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
      recognizer: () => (recognizer ??= createClaudeRecognizer({ model: process.env.SCAN_MODEL || undefined })),
    });
  })().catch((e) => {
    globals.__dexlaneApp = undefined; // une configuration corrigée est reprise au prochain appel
    throw e;
  }));
}
