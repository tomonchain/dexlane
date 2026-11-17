import "server-only";
import type { Hono } from "hono";

/**
 * Accès à l'API métier, de deux façons :
 * - `DEXLANE_API_URL` défini : l'API tourne à part (apps/api), on la joint en HTTP ;
 * - sinon : l'API est embarquée dans ce serveur Next (un seul déploiement, p. ex. Vercel) et lit
 *   `DATABASE_URL`, `DEXLANE_API_TOKEN` et les identifiants Anthropic directement.
 * Dans les deux cas le jeton présenté est vérifié par l'API elle-même.
 */
export async function callApi(
  pathAndQuery: string,
  token: string,
  init: { method?: string; headers?: Headers; body?: ArrayBuffer } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
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
    const token = process.env.DEXLANE_API_TOKEN ?? "";
    if (token.length < 24) throw new Error("DEXLANE_API_TOKEN must be set to a secret of at least 24 characters");
    // prepare: false → compatible avec un pooler en mode transaction (Supabase, PgBouncer) ;
    // petit pool et connexions inactives relâchées : adapté aux fonctions serverless.
    const sql = createDb(process.env.DATABASE_URL, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 });
    let recognizer: ReturnType<typeof createClaudeRecognizer> | undefined;
    return createApp({
      sql,
      token,
      recognizer: () => (recognizer ??= createClaudeRecognizer({ model: process.env.SCAN_MODEL || undefined })),
    });
  })().catch((e) => {
    globals.__dexlaneApp = undefined; // une configuration corrigée est reprise au prochain appel
    throw e;
  }));
}
