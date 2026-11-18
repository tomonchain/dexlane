import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { withTx, type Db } from "@dexlane/db";
import { HttpError } from "./http";

export const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 200;
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;

/** Au-delà de 5 échecs consécutifs : 30 s, puis le double à chaque nouvel échec, plafonné à 15 min. */
const FREE_ATTEMPTS = 5;
const lockSeconds = (failures: number) => Math.min(30 * 2 ** (failures - FREE_ATTEMPTS), 15 * 60);

const derive = (password: string, salt: Buffer, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key))),
  );

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

async function matches(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function assertAcceptable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(422, "WEAK_PASSWORD", `password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters long`);
  }
}

export async function passwordStatus(sql: Db): Promise<{ passwordSet: boolean; sessionVersion: number | null }> {
  const [row] = await sql<{ sessionVersion: number }[]>`select session_version from owner_credentials`;
  return { passwordSet: !!row, sessionVersion: row?.sessionVersion ?? null };
}

/** Définit ou remplace le mot de passe ; toutes les sessions ouvertes auparavant deviennent invalides. */
export async function setPassword(sql: Db, password: string, action: "password_reset" | "password_changed"): Promise<number> {
  assertAcceptable(password);
  const hash = await hashPassword(password);
  return withTx(sql, async (tx) => {
    const [row] = await tx<{ sessionVersion: number }[]>`
      insert into owner_credentials (password_hash) values (${hash})
      on conflict (id) do update set
        password_hash = excluded.password_hash, session_version = owner_credentials.session_version + 1,
        failed_attempts = 0, locked_until = null, updated_at = now()
      returning session_version`;
    await tx`insert into audit_events (actor, action, entity, entity_id) values ('owner', ${action}, 'owner_credentials', 'owner')`;
    return row!.sessionVersion;
  });
}

type Outcome =
  | { kind: "ok"; sessionVersion: number }
  | { kind: "unset" }
  | { kind: "locked"; retryAfterS: number }
  | { kind: "invalid"; lockedForS: number };

/** Vérifie le mot de passe en comptant les échecs. Le compteur est validé en base avant de signaler l'erreur. */
export async function verifyPassword(sql: Db, password: string): Promise<number> {
  const outcome = await withTx(sql, async (tx): Promise<Outcome> => {
    const [row] = await tx<{ passwordHash: string; sessionVersion: number; failedAttempts: number; lockedForS: number | null }[]>`
      select password_hash, session_version, failed_attempts,
             ceil(extract(epoch from locked_until - now()))::int as locked_for_s
        from owner_credentials for update`;
    if (!row) return { kind: "unset" };
    if (row.lockedForS !== null && row.lockedForS > 0) return { kind: "locked", retryAfterS: row.lockedForS };
    if (await matches(password, row.passwordHash)) {
      await tx`update owner_credentials set failed_attempts = 0, locked_until = null`;
      return { kind: "ok", sessionVersion: row.sessionVersion };
    }
    const failures = row.failedAttempts + 1;
    const lockedForS = failures >= FREE_ATTEMPTS ? lockSeconds(failures) : 0;
    await tx`
      update owner_credentials
         set failed_attempts = ${failures},
             locked_until = ${lockedForS > 0 ? tx`now() + make_interval(secs => ${lockedForS})` : null}`;
    return { kind: "invalid", lockedForS };
  });

  switch (outcome.kind) {
    case "ok":
      return outcome.sessionVersion;
    case "unset":
      throw new HttpError(409, "PASSWORD_NOT_SET", "no password has been set yet");
    case "locked":
      throw new HttpError(429, "TOO_MANY_ATTEMPTS", "too many failed attempts; try again later", { retryAfterS: outcome.retryAfterS });
    case "invalid":
      throw new HttpError(401, "INVALID_PASSWORD", "invalid password", outcome.lockedForS ? { retryAfterS: outcome.lockedForS } : undefined);
  }
}

export async function changePassword(sql: Db, currentPassword: string, newPassword: string): Promise<number> {
  assertAcceptable(newPassword);
  await verifyPassword(sql, currentPassword);
  return setPassword(sql, newPassword, "password_changed");
}
