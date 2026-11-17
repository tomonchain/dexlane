import { createHash, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { withTx, type Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";

/** Erreur à renvoyer telle quelle au client. */
export class HttpError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const errorBody = (code: string, message: string, details?: unknown) => ({
  error: { code, message, ...(details === undefined ? {} : { details }) },
});

/** Règle métier violée → 404 (introuvable), 409 (état courant incompatible) ou 422 (demande invalide). */
const CONFLICTS = new Set([
  "INSUFFICIENT_STOCK", "ADJUST_BELOW_COMMITTED", "NOT_DRAFT", "NOT_BULK", "ALREADY_SHIPPED", "INVALID_STATE",
]);
export function statusOfDomainError(e: DomainError): ContentfulStatusCode {
  if (e.code.endsWith("_NOT_FOUND")) return 404;
  return CONFLICTS.has(e.code) ? 409 : 422;
}

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw new HttpError(
    400,
    "VALIDATION_ERROR",
    "request does not match the expected format",
    r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}

export async function parseJsonBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let data: unknown;
  try {
    data = JSON.parse(await c.req.text());
  } catch {
    throw new HttpError(400, "INVALID_JSON", "request body is not valid JSON");
  }
  return parse(schema, data);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/** Comparaison à temps constant, y compris quand les longueurs diffèrent. */
export const secretEquals = (a: string, b: string) => timingSafeEqual(sha256(a), sha256(b));

/**
 * Exécute une mutation au plus une fois par `Idempotency-Key`.
 * La clé, la mutation et la réponse sont écrites dans la même transaction : soit tout est validé et un
 * rejeu renvoie la réponse d'origine, soit rien ne l'est et un rejeu réexécute. Deux requêtes simultanées
 * portant la même clé se sérialisent sur la clé primaire.
 */
export async function idempotent(
  c: Context,
  sql: Db,
  run: (tx: Db) => Promise<{ status: 200 | 201; body: unknown }>,
): Promise<Response> {
  const key = c.req.header("Idempotency-Key")?.trim();
  if (!key || key.length < 8 || key.length > 200) {
    throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "this request needs an Idempotency-Key header (8 to 200 characters)");
  }
  const scope = `${c.req.method} ${c.req.path}`;
  const requestHash = sha256(await c.req.text()).toString("hex");

  const outcome = await withTx(sql, async (tx) => {
    const [claimed] = await tx`
      insert into idempotency_keys (key, scope, request_hash, status, response)
      values (${key}, ${scope}, ${requestHash}, 0, '{}')
      on conflict (key) do nothing
      returning key`;
    if (!claimed) {
      const [previous] = await tx<{ scope: string; requestHash: string; status: number; response: unknown }[]>`
        select scope, request_hash, status, response from idempotency_keys where key = ${key}`;
      if (previous!.scope !== scope || previous!.requestHash !== requestHash) {
        throw new HttpError(422, "IDEMPOTENCY_KEY_REUSED", "this Idempotency-Key was already used for a different request");
      }
      return { status: previous!.status as 200 | 201, body: previous!.response, replayed: true };
    }
    const result = await run(tx);
    const body: unknown = JSON.parse(JSON.stringify(result.body));
    await tx`update idempotency_keys set status = ${result.status}, response = ${tx.json(body as never)} where key = ${key}`;
    return { status: result.status, body, replayed: false };
  });

  if (outcome.replayed) c.header("Idempotent-Replay", "true");
  return c.json(outcome.body as object, outcome.status);
}
