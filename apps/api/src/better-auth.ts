import { createHmac, randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { Pool } from "pg";
import { OWNER_ACCOUNT_ID, withTx, type Db } from "@dexlane/db";
import { HttpError } from "./http";
import { alreadyRegisteredMail, passwordResetMail, verificationMail, type Mailer } from "./mailer";

/**
 * Comptes et sessions : BetterAuth (https://better-auth.com). Il tient les utilisateurs, leurs mots de passe, les
 * sessions (cookie httpOnly), la vérification de l'adresse e-mail, le mot de passe oublié et l'administration (rôles,
 * bannissement, « se connecter en tant que »). Ses routes sont servies sous /api/auth/*.
 *
 * Chaque utilisateur est rattaché à un compte (`accounts`, l'espace de données cloisonné par Postgres) : `accountId`.
 * Aujourd'hui, un utilisateur par compte ; plusieurs utilisateurs pourront partager un compte sans toucher aux données.
 */

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Adresse publique du site : `DEXLANE_PUBLIC_URL` ou `NEXT_PUBLIC_SITE_URL`, sinon l'adresse du déploiement (preview) ou
 * de production sur Vercel, sinon l'adresse locale de développement.
 */
export function publicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DEXLANE_PUBLIC_URL) return env.DEXLANE_PUBLIC_URL;
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL;
  if (env.VERCEL_ENV === "preview" && env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

/** Les autres adresses sous lesquelles ce déploiement répond (alias de branche et de production sur Vercel). */
const deploymentOrigins = (env: NodeJS.ProcessEnv = process.env) =>
  [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map((host) => `https://${host}`);

export interface AuthDeps {
  /** Base de données (hors cloisonnement) : création du compte d'un nouvel utilisateur. */
  sql: Db;
  databaseUrl: string;
  /** Adresse publique du site : liens des e-mails, origine de confiance, cookies. */
  baseUrl: string;
  /** Secret du serveur : la clé de signature des cookies en est dérivée. */
  token: string;
  /** Envoi des e-mails ; lève une erreur lisible s'il n'est pas configuré. */
  mailer: () => Mailer;
}

export function createAuth(deps: AuthDeps) {
  const { sql } = deps;
  return betterAuth({
    appName: "Dexlane",
    baseURL: deps.baseUrl,
    basePath: "/api/auth",
    secret: process.env.BETTER_AUTH_SECRET ?? createHmac("sha256", deps.token).update("dexlane-better-auth-v1").digest("base64url"),
    trustedOrigins: [new URL(deps.baseUrl).origin, ...deploymentOrigins()],
    // prepare/transaction : compatible avec un pooler en mode transaction (Neon, PgBouncer) ; petit pool pour le serverless.
    database: new Pool({ connectionString: deps.databaseUrl, max: 3, idleTimeoutMillis: 20_000 }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 200,
      // Le compte ne s'ouvre qu'une fois l'adresse vérifiée ; l'inscription ne dit jamais si une adresse est déjà prise.
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: async ({ user, url }) => deps.mailer().send(passwordResetMail(user.email, url)),
      onExistingUserSignUp: async ({ user }) => deps.mailer().send(alreadyRegisteredMail(user.email, new URL("/login", deps.baseUrl).toString())),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      expiresIn: 24 * 3600,
      sendVerificationEmail: async ({ user, url }) => deps.mailer().send(verificationMail(user.email, url)),
    },
    user: {
      modelName: "auth_users",
      additionalFields: {
        // Le compte (espace de données) de l'utilisateur ; posé à la création, jamais par le client.
        accountId: { type: "string", required: false, input: false },
        // Forfait choisi et code du flyer saisis à l'inscription (indicatifs : pas encore de facturation).
        plan: { type: "string", required: false, input: true },
        signupCode: { type: "string", required: false, input: true },
      },
    },
    session: {
      modelName: "auth_sessions",
      expiresIn: 30 * 24 * 3600,
      updateAge: 24 * 3600,
    },
    account: { modelName: "auth_credentials" },
    verification: { modelName: "auth_verifications" },
    rateLimit: { enabled: process.env.NODE_ENV === "production", storage: "database", modelName: "auth_rate_limits", window: 60, max: 100 },
    advanced: {
      cookiePrefix: "dexlane",
      // Derrière le relais du serveur web : l'adresse du visiteur est celle qu'il transmet.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    databaseHooks: {
      user: {
        create: {
          // Un nouvel utilisateur reçoit son propre compte, vide.
          before: async (user) => {
            const existing = (user as { accountId?: string | null }).accountId;
            if (existing) return { data: user };
            const [account] = await sql<{ id: string }[]>`insert into accounts default values returning id`;
            return { data: { ...user, accountId: account!.id } };
          },
        },
      },
    },
    plugins: [admin()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** L'installation a-t-elle déjà son propriétaire (l'utilisateur du compte d'installation) ? */
export async function ownerExists(sql: Db): Promise<boolean> {
  const [row] = await sql`select 1 from auth_users where "accountId" = ${OWNER_ACCOUNT_ID} limit 1`;
  return !!row;
}

/**
 * Crée le propriétaire de l'installation, ou remplace son adresse et son mot de passe. Réservé au porteur du jeton
 * d'installation : c'est la première connexion, et la clé de secours. Le propriétaire est administrateur, son adresse
 * est tenue pour vérifiée, et ses sessions ouvertes auparavant sont fermées.
 */
export async function setupOwner(auth: Auth, sql: Db, input: { email: string; password: string }): Promise<void> {
  if (input.password.length < MIN_PASSWORD_LENGTH || input.password.length > 200) {
    throw new HttpError(422, "WEAK_PASSWORD", `password must be ${MIN_PASSWORD_LENGTH} to 200 characters long`);
  }
  const email = input.email.trim().toLowerCase();
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(input.password);
  const [owner] = await sql<{ id: string }[]>`select id from auth_users where "accountId" = ${OWNER_ACCOUNT_ID} order by "createdAt" limit 1`;
  const [taken] = await sql<{ id: string }[]>`select id from auth_users where lower(email) = ${email}`;
  if (taken && taken.id !== owner?.id) throw new HttpError(409, "EMAIL_TAKEN", "this email address belongs to another account");

  // Écrit directement dans les tables de BetterAuth (leur schéma est celui de la migration 0033) : aucun e-mail de
  // vérification ne part, et le compte n'est pas créé par le crochet d'inscription.
  await withTx(sql, async (tx) => {
    if (!owner) {
      const id = randomUUID();
      await tx`
        insert into auth_users (id, name, email, "emailVerified", role, "accountId")
        values (${id}, ${email.split("@")[0]!}, ${email}, true, 'admin', ${OWNER_ACCOUNT_ID})`;
      await tx`
        insert into auth_credentials (id, "accountId", "providerId", "userId", password, "updatedAt")
        values (${randomUUID()}, ${id}, 'credential', ${id}, ${hash}, now())`;
    } else {
      await tx`update auth_users set email = ${email}, "emailVerified" = true, role = 'admin', "updatedAt" = now() where id = ${owner.id}`;
      await tx`update auth_credentials set password = ${hash}, "updatedAt" = now() where "userId" = ${owner.id} and "providerId" = 'credential'`;
      await tx`delete from auth_sessions where "userId" = ${owner.id}`;
    }
  });
  await sql`
    insert into audit_events (account_id, actor, action, entity, entity_id)
    values (${OWNER_ACCOUNT_ID}, 'owner', 'owner_setup', 'account', ${OWNER_ACCOUNT_ID})`;
}

/** Les comptes actifs (un utilisateur à l'adresse vérifiée, non banni) : ceux pour lesquels tournent les tâches planifiées. */
export async function activeAccountIds(sql: Db): Promise<string[]> {
  const rows = await sql<{ accountId: string }[]>`
    select "accountId" from auth_users
     where "accountId" is not null and "emailVerified" and coalesce(banned, false) = false
     group by "accountId" order by min("createdAt")`;
  return rows.map((r) => r.accountId);
}
