import { createHash, randomBytes } from "node:crypto";
import type { Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";

/**
 * Jetons des agents (serveur MCP) : un par agent ou par outil, révocable à tout moment. Seule l'empreinte est gardée ;
 * le jeton n'est montré qu'une fois, à sa création. Un jeton d'agent n'ouvre que le serveur MCP, jamais le reste de l'API.
 */

export const AGENT_TOKEN_PREFIX = "dxl_";

export interface AgentToken {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function listAgentTokens(sql: Db): Promise<AgentToken[]> {
  return sql<AgentToken[]>`
    select id, name, prefix, last_used_at, created_at from agent_tokens where revoked_at is null order by created_at desc`;
}

export async function createAgentToken(sql: Db, name: string, actor: string): Promise<AgentToken & { token: string }> {
  const [active] = await sql<{ n: number }[]>`select count(*)::int as n from agent_tokens where revoked_at is null`;
  if (active!.n >= 20) throw new DomainError("TOO_MANY_TOKENS", "revoke an unused agent token first (20 at most)");
  const token = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const [row] = await sql<AgentToken[]>`
    insert into agent_tokens (name, token_hash, prefix) values (${name.trim()}, ${hash(token)}, ${token.slice(0, 10)})
    returning id, name, prefix, last_used_at, created_at`;
  await sql`insert into audit_events (actor, action, entity, entity_id, after)
            values (${actor}, 'agent_token_created', 'agent_token', ${row!.id}, ${sql.json({ name: row!.name })})`;
  return { ...row!, token };
}

export async function revokeAgentToken(sql: Db, id: string, actor: string): Promise<void> {
  const [row] = await sql`update agent_tokens set revoked_at = now() where id = ${id} and revoked_at is null returning id`;
  if (!row) throw new DomainError("AGENT_TOKEN_NOT_FOUND", "agent token not found");
  await sql`insert into audit_events (actor, action, entity, entity_id) values (${actor}, 'agent_token_revoked', 'agent_token', ${id})`;
}

/** L'agent qui présente ce jeton, ou null ; la date de dernière utilisation est tenue à la minute près. */
export async function verifyAgentToken(sql: Db, token: string): Promise<{ id: string; name: string; accountId: string } | null> {
  if (!token.startsWith(AGENT_TOKEN_PREFIX) || token.length > 200) return null;
  const [row] = await sql<{ id: string; name: string; accountId: string }[]>`
    update agent_tokens set last_used_at = case when last_used_at is null or last_used_at < now() - interval '1 minute' then now() else last_used_at end
     where token_hash = ${hash(token)} and revoked_at is null
     returning id, name, account_id`;
  return row ?? null;
}
