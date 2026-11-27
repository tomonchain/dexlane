import type { Hono } from "hono";
import { z } from "zod";
import type { Db } from "@dexlane/db";
import type { Env } from "./env";
import { HttpError, parseJsonBody } from "./http";

/*
 * Inscriptions et liste d'attente (#103). Tant que les e-mails (vérification de l'adresse) et le paiement des forfaits
 * ne sont pas branchés, les inscriptions sont fermées : un vendeur intéressé laisse son adresse sur la liste d'attente.
 * `DEXLANE_SIGNUP=open` les rouvre (en auto-hébergé aussi).
 */

export type SignupMode = "open" | "waitlist";
export const signupModeFromEnv = (env: NodeJS.ProcessEnv = process.env): SignupMode => (env.DEXLANE_SIGNUP === "open" ? "open" : "waitlist");

const VOLUMES = ["lt50", "50-200", "200-1000", "gt1000"] as const;
const waitlistBody = z.strictObject({
  email: z.email().max(254),
  plan: z.string().trim().max(30).optional(),
  code: z.string().trim().max(40).optional(),
  volume: z.enum(VOLUMES).optional(),
});

/** Une invitation d'équipe en cours pour cette adresse : la personne peut s'inscrire même inscriptions fermées. */
export async function hasPendingInvitation(root: Db, email: string): Promise<boolean> {
  const [row] = await root`
    select 1 from account_invitations
     where lower(email) = lower(${email}) and accepted_at is null and revoked_at is null and expires_at > now()`;
  return !!row;
}

/**
 * Inscriptions fermées : la création d'un compte (route d'inscription de BetterAuth) est refusée, sauf pour une adresse
 * invitée dans une équipe.
 */
export async function guardSignup(root: Db, mode: SignupMode, request: Request): Promise<void> {
  if (mode === "open") return;
  const body = (await request.clone().json().catch(() => ({}))) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email && (await hasPendingInvitation(root, email))) return;
  throw new HttpError(403, "SIGNUP_CLOSED", "sign-ups are closed for now: join the waitlist");
}

export function registerWaitlistRoutes(app: Hono<Env>, deps: { root: Db; mode: SignupMode }): void {
  const { root } = deps;

  /** Les inscriptions sont-elles ouvertes ? */
  app.get("/api/public/signup", (c) => c.json({ mode: deps.mode }));

  /** Une adresse laissée sur la liste d'attente. La réponse est la même qu'elle y soit déjà ou non. */
  app.post("/api/public/waitlist", async (c) => {
    const body = await parseJsonBody(c, waitlistBody);
    await root`
      insert into waitlist (email, plan, signup_code, volume)
      values (${body.email.trim().toLowerCase()}, ${body.plan || null}, ${body.code || null}, ${body.volume ?? null})
      on conflict (lower(email)) do update set
        plan = coalesce(excluded.plan, waitlist.plan), signup_code = coalesce(excluded.signup_code, waitlist.signup_code),
        volume = coalesce(excluded.volume, waitlist.volume)`;
    return c.json({ ok: true }, 201);
  });

  /** La liste d'attente, pour les administrateurs de l'installation (et les scripts du serveur). */
  app.get("/api/admin/waitlist", async (c) => {
    if (c.var.user && c.var.user.role !== "admin") throw new HttpError(403, "FORBIDDEN", "administrators only");
    const entries = await root<{ id: string; email: string; plan: string | null; signupCode: string | null; volume: string | null; createdAt: Date; invitedAt: Date | null }[]>`
      select id, email, plan, signup_code, volume, created_at, invited_at from waitlist order by created_at desc`;
    return c.json({ mode: deps.mode, entries });
  });
}
