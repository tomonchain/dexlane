import type { Hono } from "hono";
import type { Db } from "@dexlane/db";
import type { Env } from "./env";
import { HttpError } from "./http";

/*
 * Inscriptions (#116). Une installation sert une boutique : par défaut, on n'y entre que sur invitation de son équipe.
 * `DEXLANE_SIGNUP=open` ouvre les inscriptions à tous (chaque inscription crée alors son propre compte). L'édition
 * hébergée y ajoute sa liste d'attente (apps/api/src/edition.ts).
 */

export type SignupMode = "open" | "invite";
export const signupModeFromEnv = (env: NodeJS.ProcessEnv = process.env): SignupMode => (env.DEXLANE_SIGNUP === "open" ? "open" : "invite");

/** Une invitation d'équipe en cours pour cette adresse : la personne peut s'inscrire même inscriptions fermées. */
export async function hasPendingInvitation(root: Db, email: string): Promise<boolean> {
  const [row] = await root`
    select 1 from account_invitations
     where lower(email) = lower(${email}) and accepted_at is null and revoked_at is null and expires_at > now()`;
  return !!row;
}

/**
 * Inscriptions sur invitation : la création d'un compte (route d'inscription de BetterAuth) est refusée, sauf pour une
 * adresse invitée dans une équipe.
 */
export async function guardSignup(root: Db, mode: SignupMode, request: Request): Promise<void> {
  if (mode === "open") return;
  const body = (await request.clone().json().catch(() => ({}))) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email && (await hasPendingInvitation(root, email))) return;
  throw new HttpError(403, "SIGNUP_CLOSED", "sign-ups are by invitation only");
}

export function registerSignupRoutes(app: Hono<Env>, deps: { mode: SignupMode }): void {
  /** Les inscriptions sont-elles ouvertes ? */
  app.get("/api/public/signup", (c) => c.json({ mode: deps.mode }));
}
