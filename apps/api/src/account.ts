import { createHash, randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { withTx, type Db } from "@dexlane/db";
import { PLAN_RULES, SELECTABLE_PLANS, planRule, type PlanId } from "@dexlane/shared";
import { accountPlan, addQuotaPack, plansEnforced, quotaState, requireFeature } from "@dexlane/listings";
import type { Env } from "./env";
import { HttpError, parse, parseJsonBody } from "./http";
import { invitationMail, supportMail, type Mailer } from "./mailer";
import * as s from "./schemas";

/*
 * Le compte : son forfait (quota du mois, packs, changement de forfait), son équipe (invitations, membres) et le support.
 *
 * La facturation n'est pas encore branchée : un changement de forfait ou un pack prend effet tout de suite et reste dans
 * le journal (audit_events), d'où il sera facturé.
 */

export interface AccountRoutesDeps {
  /** Base sans cloisonnement : les utilisateurs (tables de BetterAuth) et les invitations reçues. */
  root: Db;
  /** Base du compte en cours. */
  sql: Db;
  mailer: () => Mailer;
  baseUrl: () => string;
  /** Adresse qui reçoit les demandes de support (`SUPPORT_EMAIL`) ; null : elles restent en base. */
  supportEmail: string | null;
  onError: (err: unknown) => void;
}

const INVITATION_DAYS = 7;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

interface Member { id: string; email: string; name: string; createdAt: Date }

/** Les utilisateurs du compte, le premier inscrit (le propriétaire) en tête. */
const membersOf = (root: Db, accountId: string) =>
  root<Member[]>`select id, email, name, "createdAt" as created_at from auth_users where "accountId" = ${accountId} order by "createdAt", id`;

export function registerAccountRoutes(app: Hono<Env>, deps: AccountRoutesDeps): void {
  const { root, sql } = deps;

  const sessionUser = (c: { var: Env["Variables"] }) => {
    if (!c.var.user) throw new HttpError(403, "FORBIDDEN", "this action needs a signed-in user");
    return c.var.user;
  };
  /**
   * Le propriétaire du compte : le premier utilisateur inscrit. Lui seul gère le forfait et l'équipe. Un appel du serveur
   * lui-même (script, tâche planifiée, désigné par X-Dexlane-Account) agit pour le propriétaire.
   */
  const requireOwner = async (c: { var: Env["Variables"] }): Promise<{ id: string | null; email: string }> => {
    const user = c.var.user;
    if (!user) return { id: null, email: c.var.actor };
    const [owner] = await membersOf(root, c.var.accountId);
    if (owner && owner.id !== user.id) throw new HttpError(403, "OWNER_ONLY", "seul le propriétaire du compte peut faire ça");
    return user;
  };

  async function summary(c: { var: Env["Variables"] }) {
    const [plan, quota, members] = await Promise.all([accountPlan(sql), quotaState(sql), membersOf(root, c.var.accountId)]);
    const user = c.var.user;
    return {
      accountId: c.var.accountId,
      email: user?.email ?? null,
      role: user?.role ?? "user",
      /** Forfait choisi sur le site avant l'inscription (proposé au changement de forfait). */
      requestedPlan: user?.plan ?? null,
      isOwner: !user || members[0]?.id === user.id || members.length === 0,
      plansEnforced: plansEnforced(),
      plan: { ...plan, features: plan.features },
      quota: { month: quota.month, used: quota.used, included: quota.included, packCards: quota.packCards, limit: quota.limit, remaining: quota.remaining, packs: quota.packs },
      members: members.length,
      plans: SELECTABLE_PLANS.map((id) => PLAN_RULES[id]),
    };
  }

  /** L'utilisateur de la session, son compte, son forfait et le quota du mois. */
  app.get("/api/account", async (c) => c.json(await summary(c)));

  /** Change de forfait. La montée est immédiate ; la descente aussi, mais une équipe doit d'abord être réduite à une personne. */
  app.put("/api/account/plan", async (c) => {
    const user = await requireOwner(c);
    const { plan } = await parseJsonBody(c, s.planBodyAccount);
    const current = await accountPlan(sql);
    if (current.id === "community") throw new HttpError(409, "INSTALLATION_PLAN", "le compte d'installation n'a pas de forfait : il est sans limite");
    if (!planRule(plan).features.includes("team") && (await membersOf(root, c.var.accountId)).length > 1) {
      throw new HttpError(409, "TEAM_HAS_MEMBERS", "retire d'abord les autres membres de l'équipe : ce forfait n'a qu'un utilisateur");
    }
    if (current.id !== plan) {
      await sql`update accounts set plan = ${plan}, plan_changed_at = now() where id = current_account_id()`;
      await sql`
        insert into audit_events (actor, action, entity, entity_id, before, after)
        values (${user.email}, 'plan_changed', 'account', current_account_id()::text, ${sql.json({ plan: current.id })},
                ${sql.json({ plan, monthlyPriceEur: PLAN_RULES[plan as PlanId].monthlyPriceEur })})`;
    }
    return c.json(await summary(c));
  });

  /** Ajoute un ou plusieurs packs de cartes pour le mois en cours. */
  app.post("/api/account/packs", async (c) => {
    const user = await requireOwner(c);
    const { packs } = await parseJsonBody(c, s.packBody);
    if ((await accountPlan(sql)).cardsPerMonth === null) throw new HttpError(409, "UNLIMITED_PLAN", "ce forfait est déjà sans limite");
    await addQuotaPack(sql, { actor: user.email, packs });
    return c.json(await summary(c));
  });

  // ───────────────────────── Équipe ─────────────────────────

  app.get("/api/team", async (c) => {
    const user = c.var.user;
    const [members, invitations] = await Promise.all([
      membersOf(root, c.var.accountId),
      sql<{ id: string; email: string; invitedBy: string; createdAt: Date; expiresAt: Date }[]>`
        select id, email, invited_by, created_at, expires_at from account_invitations
         where accepted_at is null and revoked_at is null and expires_at > now() order by created_at desc`,
    ]);
    return c.json({
      members: members.map((m, i) => ({ ...m, isOwner: i === 0, isYou: m.id === user?.id })),
      invitations,
      canManage: !user || members[0]?.id === user.id,
    });
  });

  /** Invite quelqu'un à rejoindre le compte : un lien valable 7 jours, envoyé par e-mail. */
  app.post("/api/team/invitations", async (c) => {
    const user = await requireOwner(c);
    await requireFeature(sql, "team", "plusieurs utilisateurs");
    const email = (await parseJsonBody(c, s.invitationBody)).email.trim().toLowerCase();
    if ((await membersOf(root, c.var.accountId)).some((m) => m.email.toLowerCase() === email)) {
      throw new HttpError(409, "ALREADY_MEMBER", "cette personne fait déjà partie de l'équipe");
    }
    const token = randomBytes(24).toString("base64url");
    // Un nouveau lien remplace le précédent pour la même adresse.
    await sql`update account_invitations set revoked_at = now() where lower(email) = ${email} and accepted_at is null and revoked_at is null`;
    const [invitation] = await sql<{ id: string }[]>`
      insert into account_invitations (email, token_hash, invited_by, expires_at)
      values (${email}, ${hashToken(token)}, ${user.email}, now() + make_interval(days => ${INVITATION_DAYS}))
      returning id`;
    const url = new URL(`/join?token=${token}`, deps.baseUrl()).toString();
    await deps.mailer().send(invitationMail(email, user.email, url));
    await sql`insert into audit_events (actor, action, entity, entity_id, after) values (${user.email}, 'member_invited', 'account', current_account_id()::text, ${sql.json({ email })})`;
    return c.json({ id: invitation!.id, email }, 201);
  });

  app.delete("/api/team/invitations/:id", async (c) => {
    await requireOwner(c);
    await sql`update account_invitations set revoked_at = now() where id = ${parse(s.invitationId, c.req.param("id"))} and accepted_at is null`;
    return c.json({ ok: true });
  });

  /** Ce que propose un lien d'invitation (avant de l'accepter). */
  app.post("/api/team/invitations/preview", async (c) => {
    const { token } = await parseJsonBody(c, s.acceptInvitationBody);
    const invitation = await findInvitation(token);
    return c.json({ email: invitation.email, invitedBy: invitation.invitedBy, matches: invitation.email === c.var.user?.email.toLowerCase() });
  });

  async function findInvitation(token: string) {
    const [invitation] = await root<{ id: string; accountId: string; email: string; invitedBy: string }[]>`
      select id, account_id, lower(email) as email, invited_by from account_invitations
       where token_hash = ${hashToken(token)} and accepted_at is null and revoked_at is null and expires_at > now()`;
    if (!invitation) throw new HttpError(404, "INVITATION_NOT_FOUND", "cette invitation n'est plus valable : demande un nouveau lien");
    return invitation;
  }

  /**
   * Rejoint le compte qui invite. L'adresse de la session doit être celle de l'invitation. Le compte qu'on quitte doit être
   * celui d'une personne seule : un propriétaire avec une équipe ne peut pas partir sans elle.
   */
  app.post("/api/team/invitations/accept", async (c) => {
    const user = sessionUser(c);
    const { token } = await parseJsonBody(c, s.acceptInvitationBody);
    const invitation = await findInvitation(token);
    if (invitation.email !== user.email.toLowerCase()) {
      throw new HttpError(403, "INVITATION_OTHER_EMAIL", `cette invitation est pour ${invitation.email} : connecte-toi avec cette adresse`);
    }
    if (invitation.accountId === c.var.accountId) throw new HttpError(409, "ALREADY_MEMBER", "tu fais déjà partie de ce compte");
    if ((await membersOf(root, c.var.accountId)).length > 1) {
      throw new HttpError(409, "TEAM_HAS_MEMBERS", "ton compte actuel a une équipe : retire ses membres avant d'en rejoindre un autre");
    }
    await withTx(root, async (tx) => {
      await tx`update auth_users set "accountId" = ${invitation.accountId}, "updatedAt" = now() where id = ${user.id}`;
      await tx`update account_invitations set accepted_at = now() where id = ${invitation.id}`;
      await tx`
        insert into audit_events (account_id, actor, action, entity, entity_id, after)
        values (${invitation.accountId}, ${user.email}, 'member_joined', 'account', ${invitation.accountId}, ${tx.json({ email: user.email })})`;
    });
    return c.json({ ok: true, accountId: invitation.accountId });
  });

  /** Retire un membre : il garde son identifiant, mais repart sur un compte vide à lui ; ses sessions sont fermées. */
  app.delete("/api/team/members/:id", async (c) => {
    const owner = await requireOwner(c);
    const memberId = parse(s.memberId, c.req.param("id"));
    if (memberId === owner.id) throw new HttpError(409, "CANNOT_REMOVE_OWNER", "le propriétaire ne peut pas se retirer de son compte");
    const member = (await membersOf(root, c.var.accountId)).find((m) => m.id === memberId);
    if (!member) throw new HttpError(404, "MEMBER_NOT_FOUND", "ce membre ne fait pas partie de l'équipe");
    await withTx(root, async (tx) => {
      const [fresh] = await tx<{ id: string }[]>`insert into accounts default values returning id`;
      await tx`update auth_users set "accountId" = ${fresh!.id}, "updatedAt" = now() where id = ${member.id}`;
      await tx`delete from auth_sessions where "userId" = ${member.id}`;
      await tx`
        insert into audit_events (account_id, actor, action, entity, entity_id, after)
        values (${c.var.accountId}, ${owner.email}, 'member_removed', 'account', ${c.var.accountId}, ${tx.json({ email: member.email })})`;
    });
    return c.json({ ok: true });
  });

  // ───────────────────────── Support ─────────────────────────

  app.get("/api/support", async (c) => c.json({
    requests: await sql`select id, subject, message, priority, status, created_at from support_requests order by created_at desc limit 50`,
    priority: (await accountPlan(sql)).features.includes("support"),
  }));

  /** Une question au support. Sur le forfait Boutique, elle arrive marquée prioritaire. */
  app.post("/api/support", async (c) => {
    const body = await parseJsonBody(c, s.supportBody);
    const plan = await accountPlan(sql);
    const priority = plan.features.includes("support");
    const email = c.var.user?.email ?? c.var.actor;
    const [request] = await sql<{ id: string }[]>`
      insert into support_requests (email, subject, message, plan, priority) values (${email}, ${body.subject}, ${body.message}, ${plan.id}, ${priority})
      returning id`;
    if (deps.supportEmail) {
      await deps.mailer().send(supportMail(deps.supportEmail, { from: email, subject: body.subject, message: body.message, plan: plan.name, priority }))
        .catch(deps.onError);
    }
    return c.json({ id: request!.id, priority }, 201);
  });
}
