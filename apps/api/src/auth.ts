import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { OWNER_ACCOUNT_ID, withTx, type Db } from "@dexlane/db";
import { HttpError } from "./http";
import { alreadyRegisteredMail, passwordResetMail, verificationMail, type Mailer } from "./mailer";

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

/*
 * Comptes. Ces fonctions s'adressent directement à la base, hors du cloisonnement par compte : elles servent justement
 * à établir de quel compte il s'agit. Le compte d'installation (sans adresse e-mail) se connecte avec son seul mot de
 * passe ; les autres avec leur adresse, une fois celle-ci vérifiée.
 */

export interface Session {
  accountId: string;
  sessionVersion: number;
}

export async function passwordStatus(sql: Db, accountId = OWNER_ACCOUNT_ID): Promise<{ passwordSet: boolean; sessionVersion: number | null }> {
  const [row] = await sql<{ passwordHash: string | null; sessionVersion: number }[]>`
    select password_hash, session_version from accounts where id = ${accountId}`;
  return { passwordSet: !!row?.passwordHash, sessionVersion: row?.passwordHash ? row.sessionVersion : null };
}

/** Définit ou remplace le mot de passe d'un compte ; toutes ses sessions ouvertes auparavant deviennent invalides. */
export async function setPassword(sql: Db, accountId: string, password: string, action: "password_reset" | "password_changed"): Promise<number> {
  assertAcceptable(password);
  const hash = await hashPassword(password);
  return withTx(sql, async (tx) => {
    const [row] = await tx<{ sessionVersion: number }[]>`
      update accounts set
        password_hash = ${hash}, session_version = case when password_hash is null then session_version else session_version + 1 end,
        failed_attempts = 0, locked_until = null, updated_at = now()
       where id = ${accountId}
      returning session_version`;
    if (!row) throw new HttpError(404, "ACCOUNT_NOT_FOUND", "no such account");
    await tx`
      insert into audit_events (account_id, actor, action, entity, entity_id)
      values (${accountId}, 'owner', ${action}, 'account', ${accountId})`;
    return row.sessionVersion;
  });
}

type Outcome =
  | { kind: "ok"; accountId: string; sessionVersion: number }
  | { kind: "unset" }
  | { kind: "unknown" }
  | { kind: "unverified" }
  | { kind: "locked"; retryAfterS: number }
  | { kind: "invalid"; lockedForS: number };

/**
 * Vérifie un mot de passe en comptant les échecs (le compteur est validé en base avant de signaler l'erreur).
 * Sans adresse, c'est le compte d'installation ; une adresse inconnue répond comme un mauvais mot de passe.
 */
export async function verifyPassword(sql: Db, password: string, who: { email?: string; accountId?: string } = {}): Promise<Session> {
  const outcome = await withTx(sql, async (tx): Promise<Outcome> => {
    const [row] = await tx<{ id: string; passwordHash: string | null; sessionVersion: number; failedAttempts: number; lockedForS: number | null; verified: boolean }[]>`
      select id, password_hash, session_version, failed_attempts, email_verified_at is not null as verified,
             ceil(extract(epoch from locked_until - now()))::int as locked_for_s
        from accounts
       where ${who.email ? tx`lower(email) = ${normalizeEmail(who.email)}` : tx`id = ${who.accountId ?? OWNER_ACCOUNT_ID}`}
         for update`;
    if (!row) {
      // Même durée de réponse qu'un compte existant : l'adresse ne se devine pas au temps de calcul.
      await hashPassword(password);
      return { kind: "unknown" };
    }
    if (!row.passwordHash) return { kind: "unset" };
    if (row.lockedForS !== null && row.lockedForS > 0) return { kind: "locked", retryAfterS: row.lockedForS };
    if (await matches(password, row.passwordHash)) {
      await tx`update accounts set failed_attempts = 0, locked_until = null where id = ${row.id}`;
      return row.verified ? { kind: "ok", accountId: row.id, sessionVersion: row.sessionVersion } : { kind: "unverified" };
    }
    const failures = row.failedAttempts + 1;
    const lockedForS = failures >= FREE_ATTEMPTS ? lockSeconds(failures) : 0;
    await tx`
      update accounts
         set failed_attempts = ${failures},
             locked_until = ${lockedForS > 0 ? tx`now() + make_interval(secs => ${lockedForS})` : null}
       where id = ${row.id}`;
    return { kind: "invalid", lockedForS };
  });

  switch (outcome.kind) {
    case "ok":
      return { accountId: outcome.accountId, sessionVersion: outcome.sessionVersion };
    case "unset":
      throw new HttpError(409, "PASSWORD_NOT_SET", "no password has been set yet");
    case "unverified":
      throw new HttpError(403, "EMAIL_NOT_VERIFIED", "this email address has not been verified yet");
    case "locked":
      throw new HttpError(429, "TOO_MANY_ATTEMPTS", "too many failed attempts; try again later", { retryAfterS: outcome.retryAfterS });
    case "unknown":
      throw new HttpError(401, "INVALID_PASSWORD", "invalid password");
    case "invalid":
      throw new HttpError(401, "INVALID_PASSWORD", "invalid password", outcome.lockedForS ? { retryAfterS: outcome.lockedForS } : undefined);
  }
}

export async function changePassword(sql: Db, accountId: string, currentPassword: string, newPassword: string): Promise<number> {
  assertAcceptable(newPassword);
  await verifyPassword(sql, currentPassword, { accountId });
  return setPassword(sql, accountId, newPassword, "password_changed");
}

// ───────────────────────── Inscription ─────────────────────────

const VERIFY_TTL_HOURS = 24;
const RESET_TTL_HOURS = 1;
/** Pas plus d'un e-mail du même type par minute pour un compte. */
const MAIL_COOLDOWN_S = 60;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Crée un lien à usage unique ; null si un lien du même type vient d'être envoyé. */
async function issueToken(sql: Db, accountId: string, kind: "VERIFY_EMAIL" | "RESET_PASSWORD", ttlHours: number): Promise<string | null> {
  const [recent] = await sql`
    select 1 from account_tokens
     where account_id = ${accountId} and kind = ${kind} and created_at > now() - make_interval(secs => ${MAIL_COOLDOWN_S})`;
  if (recent) return null;
  const token = randomBytes(32).toString("base64url");
  await sql`
    insert into account_tokens (account_id, kind, token_hash, expires_at)
    values (${accountId}, ${kind}, ${hashToken(token)}, now() + make_interval(hours => ${ttlHours}))`;
  return token;
}

/** Consomme un lien : le compte auquel il appartient, ou une erreur s'il est inconnu, expiré ou déjà utilisé. */
async function consumeToken(tx: Db, token: string, kind: "VERIFY_EMAIL" | "RESET_PASSWORD"): Promise<string> {
  const [row] = await tx<{ accountId: string }[]>`
    update account_tokens set used_at = now()
     where token_hash = ${hashToken(token)} and kind = ${kind} and used_at is null and expires_at > now()
    returning account_id`;
  if (!row) throw new HttpError(410, "LINK_EXPIRED", "this link is invalid, expired or already used");
  return row.accountId;
}

const link = (baseUrl: string, path: string, token?: string) => {
  const url = new URL(path, baseUrl);
  if (token) url.searchParams.set("token", token);
  return url.toString();
};

export interface SignUpInput {
  email: string;
  password: string;
  plan?: string;
  code?: string;
  /** Adresse publique du site, pour les liens des e-mails. */
  baseUrl: string;
}

/**
 * Inscription : crée le compte et envoie le lien de vérification. La réponse est la même que l'adresse soit nouvelle
 * ou déjà inscrite — dans ce cas, c'est l'e-mail qui le dit à son propriétaire.
 */
export async function signUp(sql: Db, mailer: Mailer, input: SignUpInput): Promise<void> {
  assertAcceptable(input.password);
  const email = normalizeEmail(input.email);
  const [existing] = await sql<{ id: string; verified: boolean }[]>`
    select id, email_verified_at is not null as verified from accounts where lower(email) = ${email}`;
  if (existing?.verified) {
    await mailer.send(alreadyRegisteredMail(email, link(input.baseUrl, "/login")));
    return;
  }
  const hash = await hashPassword(input.password);
  const accountId = existing
    ? existing.id
    : (await sql<{ id: string }[]>`
        insert into accounts (email, password_hash, plan, signup_code)
        values (${email}, ${hash}, ${input.plan ?? null}, ${input.code ?? null})
        returning id`)[0]!.id;
  // Une inscription jamais confirmée peut être recommencée : le dernier mot de passe choisi fait foi.
  if (existing) await sql`update accounts set password_hash = ${hash}, plan = coalesce(${input.plan ?? null}, plan), signup_code = coalesce(${input.code ?? null}, signup_code), updated_at = now() where id = ${accountId}`;
  const token = await issueToken(sql, accountId, "VERIFY_EMAIL", VERIFY_TTL_HOURS);
  if (token) await mailer.send(verificationMail(email, link(input.baseUrl, "/signup/verify", token)));
}

/** Renvoie le lien de vérification d'une inscription pas encore confirmée. Ne dit jamais si l'adresse est connue. */
export async function resendVerification(sql: Db, mailer: Mailer, emailInput: string, baseUrl: string): Promise<void> {
  const email = normalizeEmail(emailInput);
  const [account] = await sql<{ id: string }[]>`select id from accounts where lower(email) = ${email} and email_verified_at is null`;
  if (!account) return;
  const token = await issueToken(sql, account.id, "VERIFY_EMAIL", VERIFY_TTL_HOURS);
  if (token) await mailer.send(verificationMail(email, link(baseUrl, "/signup/verify", token)));
}

/** Lien de vérification suivi : l'adresse est confirmée et la session peut s'ouvrir. */
export function verifyEmail(sql: Db, token: string): Promise<Session> {
  return withTx(sql, async (tx) => {
    const accountId = await consumeToken(tx, token, "VERIFY_EMAIL");
    const [row] = await tx<{ sessionVersion: number }[]>`
      update accounts set email_verified_at = coalesce(email_verified_at, now()), updated_at = now() where id = ${accountId}
      returning session_version`;
    await tx`insert into audit_events (account_id, actor, action, entity, entity_id) values (${accountId}, 'owner', 'email_verified', 'account', ${accountId})`;
    return { accountId, sessionVersion: row!.sessionVersion };
  });
}

/** Mot de passe oublié : envoie un lien de réinitialisation. Ne dit jamais si l'adresse est connue. */
export async function requestPasswordReset(sql: Db, mailer: Mailer, emailInput: string, baseUrl: string): Promise<void> {
  const email = normalizeEmail(emailInput);
  const [account] = await sql<{ id: string }[]>`select id from accounts where lower(email) = ${email}`;
  if (!account) return;
  const token = await issueToken(sql, account.id, "RESET_PASSWORD", RESET_TTL_HOURS);
  if (token) await mailer.send(passwordResetMail(email, link(baseUrl, "/reset-password", token)));
}

/** Nouveau mot de passe choisi depuis le lien reçu par e-mail ; suivre ce lien prouve aussi l'adresse. */
export async function resetPasswordWithToken(sql: Db, token: string, newPassword: string): Promise<Session> {
  assertAcceptable(newPassword);
  const accountId = await withTx(sql, async (tx) => {
    const id = await consumeToken(tx, token, "RESET_PASSWORD");
    await tx`update accounts set email_verified_at = coalesce(email_verified_at, now()) where id = ${id}`;
    return id;
  });
  return { accountId, sessionVersion: await setPassword(sql, accountId, newPassword, "password_reset") };
}

/** Les comptes actifs (adresse vérifiée, ou compte d'installation) : ceux pour lesquels tournent les tâches planifiées. */
export async function activeAccountIds(sql: Db): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`select id from accounts where email_verified_at is not null and password_hash is not null order by created_at`;
  return rows.map((r) => r.id);
}

/** Ce que l'écran Compte affiche. */
export async function accountProfile(sql: Db, accountId: string): Promise<{ email: string | null; plan: string | null; createdAt: Date }> {
  const [row] = await sql<{ email: string | null; plan: string | null; createdAt: Date }[]>`
    select email, plan, created_at from accounts where id = ${accountId}`;
  if (!row) throw new HttpError(404, "ACCOUNT_NOT_FOUND", "no such account");
  return row;
}
