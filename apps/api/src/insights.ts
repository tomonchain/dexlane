import { createHmac } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import { withAccount, withTx, type Db } from "@dexlane/db";
import {
  achievementsSince, applyReprice, bundleDormant, countDormantCards, evaluateProgress, generateDueRecaps, getPreferences, getProgress, getRecap,
  isPeriodId, isRecapPeriod, listDormantCards, listRecaps, markRecapEmailed, onboardingState, previewReprice, progressionConfig, rebuildJournal,
  recapsToEmail, resolvePeriod, savePreferences, sellerStats, withdrawDormant, type PerkHooks, type RecapData, type UserPreferences,
} from "@dexlane/insights";
import { accountPlan, plansEnforced, type ChannelAdapters } from "@dexlane/listings";
import { quotaMonth } from "@dexlane/shared";
import type { Env } from "./env";
import { HttpError, parseJsonBody, secretEquals } from "./http";
import { recapMail, type Mailer } from "./mailer";
import { getAppSettings } from "./settings";

/*
 * Statistiques (#83), parcours de démarrage (#84), récaps (#85), niveau et succès (#86).
 *
 * Tout est privé au compte : pas de profil public, pas de classement. Rien ne sort sans une action de l'utilisateur
 * (l'image de partage d'un récap est générée à sa demande, par l'application web).
 */

export interface InsightsRoutesDeps {
  root: Db;
  sql: Db;
  live: ChannelAdapters;
  /** Envoi des e-mails ; null : pas de service d'e-mail configuré (le récap reste dans l'application). */
  mailer: () => Mailer | null;
  baseUrl: () => string;
  /** Secret du serveur : signe les liens de désinscription des e-mails. */
  token: string;
  /** Point d'extension des avantages de niveau (bonus de cartes de la version hébergée). */
  perkHooks: PerkHooks;
  /** L'e-mail qui annonce le récap part-il ? Coupé pour le moment (configuration de la progression). */
  recapEmails: boolean;
  onError: (err: unknown) => void;
}

const offerIds = z.array(z.uuid()).min(1).max(500);
const percent = z.number().int().min(1).max(90);
const repriceBody = z.strictObject({ offerIds, percent, confirm: z.boolean().optional() });
const lotBody = z.strictObject({ offerIds, title: z.string().trim().min(1).max(80), priceCents: z.number().int().min(0).max(2_000_000_000) });
const withdrawBody = z.strictObject({ offerIds, confirm: z.boolean() });
const preferencesBody = z.strictObject({
  timezone: z.string().min(1).max(64).optional(),
  showProgression: z.boolean().optional(),
  recapEmail: z.boolean().optional(),
  onboardingHidden: z.boolean().optional(),
});
const seenBody = z.strictObject({ achievements: z.boolean().optional(), retroMessage: z.boolean().optional() });
const unsubscribeBody = z.strictObject({ a: z.guid(), u: z.string().min(1).max(100), s: z.string().min(1).max(100) });

/** Signature d'un lien de désinscription : le compte et l'utilisateur, signés avec le secret du serveur. */
export const unsubscribeSignature = (token: string, accountId: string, userId: string) =>
  createHmac("sha256", token).update(`recap-email:${accountId}:${userId}`).digest("base64url");

/** Bonus de cartes de la version hébergée : un pack gratuit sur le mois en cours, seulement là où les forfaits s'appliquent. */
export const hostedPerkHooks: PerkHooks = {
  grantBonusCards: async (sql, cards) => {
    if (!plansEnforced() || (await accountPlan(sql)).cardsPerMonth === null) return { skipped: "unlimited plan" };
    const [pack] = await sql<{ id: string }[]>`
      insert into quota_packs (month, cards, price_cents, automatic, actor) values (${quotaMonth()}, ${cards}, 0, true, 'progression')
      returning id`;
    return { quotaPackId: pack!.id, cards };
  },
};

/** Ce que l'utilisateur voit d'un récap : sans la partie progression s'il l'a masquée. */
function recapForUser(data: RecapData, prefs: UserPreferences) {
  if (prefs.showProgression) return data;
  return { ...data, achievements: [], achievementsCount: 0, level: null };
}

const monthName = (period: string) =>
  new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));

export function registerInsightsRoutes(app: Hono<Env>, deps: InsightsRoutesDeps): void {
  const { root, sql, live } = deps;
  const prefsOf = (c: { var: Env["Variables"] }) => getPreferences(sql, c.var.user?.id);

  // ───────────────────────── Statistiques et cartes dormantes ─────────────────────────

  app.get("/api/insights/stats", async (c) => {
    const id = c.req.query("period") ?? "this_month";
    if (!isPeriodId(id)) throw new HttpError(400, "VALIDATION_ERROR", "period must be this_month, last_month, 90d or 12m");
    const prefs = await prefsOf(c);
    return c.json(await sellerStats(sql, await resolvePeriod(sql, id, prefs.timezone)));
  });

  app.get("/api/insights/dormant", async (c) => {
    const cards = await listDormantCards(sql);
    return c.json({ cards, afterDays: progressionConfig.dormantAfterDays, canBundle: true });
  });

  /** Aperçu d'une baisse de prix : avant / après pour chaque carte. Rien ne change. */
  app.post("/api/insights/dormant/preview", async (c) => {
    const body = await parseJsonBody(c, repriceBody);
    return c.json({ lines: await previewReprice(sql, body) });
  });

  /** Applique la baisse de prix prévisualisée ; demande `confirm: true`. */
  app.post("/api/insights/dormant/reprice", async (c) => {
    const body = await parseJsonBody(c, repriceBody);
    return c.json(await applyReprice(sql, live, { ...body, confirm: body.confirm === true, actor: c.var.actor }));
  });

  app.post("/api/insights/dormant/lot", async (c) => {
    const body = await parseJsonBody(c, lotBody);
    return c.json(await bundleDormant(sql, live, { ...body, actor: c.var.actor }), 201);
  });

  app.post("/api/insights/dormant/withdraw", async (c) => {
    const body = await parseJsonBody(c, withdrawBody);
    return c.json(await withdrawDormant(sql, live, { ...body, actor: c.var.actor }));
  });

  // ───────────────────────── Accueil, démarrage, progression ─────────────────────────

  /**
   * Ce que l'accueil affiche : le parcours de démarrage (sauf masqué), le rappel des cartes dormantes, et les succès à
   * annoncer (notification groupée) ou le message unique de l'attribution rétroactive.
   */
  app.get("/api/insights/home", async (c) => {
    const prefs = await prefsOf(c);
    const [onboarding, dormant, progress] = await Promise.all([onboardingState(sql), countDormantCards(sql), getProgress(sql)]);
    const toAnnounce = prefs.showProgression && c.var.user ? await achievementsSince(sql, prefs.achievementsSeenAt) : [];
    return c.json({
      onboarding: { ...onboarding, hidden: prefs.onboardingHidden, completedAt: progress.onboardingCompletedAt },
      dormant: { count: dormant, remind: dormant >= progressionConfig.dormantReminderThreshold },
      progression: prefs.showProgression
        ? {
            level: progress.level,
            announce: toAnnounce.map((a) => ({ id: a.id, name: a.name, category: a.category })),
            retroactive: !prefs.retroMessageSeenAt && progress.retroactiveCount > 0 ? progress.unlockedCount : null,
          }
        : null,
    });
  });

  /** Ce que l'application annonce au fil de la navigation : les succès obtenus depuis la dernière annonce, groupés. */
  app.get("/api/insights/notifications", async (c) => {
    const prefs = await prefsOf(c);
    if (!prefs.showProgression || !c.var.user) return c.json({ announce: [], retroactive: null });
    const [announce, progress] = await Promise.all([achievementsSince(sql, prefs.achievementsSeenAt), getProgress(sql)]);
    return c.json({
      announce: announce.map((a) => ({ id: a.id, name: a.name, category: a.category })),
      retroactive: !prefs.retroMessageSeenAt && progress.retroactiveCount > 0 ? progress.unlockedCount : null,
    });
  });

  app.get("/api/insights/onboarding", async (c) => {
    const prefs = await prefsOf(c);
    return c.json({ ...(await onboardingState(sql)), hidden: prefs.onboardingHidden });
  });

  app.get("/api/insights/progress", async (c) => {
    const prefs = await prefsOf(c);
    if (!prefs.showProgression) return c.json({ hidden: true });
    const settings = await getAppSettings(sql);
    return c.json({
      hidden: false, ...(await getProgress(sql)), shopName: settings.seller.name || null,
      categories: progressionConfig.achievementCategories, rarities: progressionConfig.achievementRarities, levelNames: progressionConfig.levelNames,
    });
  });

  /** Les succès annoncés ont été vus (ou le message rétroactif) : ils ne reviennent plus. */
  app.post("/api/insights/notifications/seen", async (c) => {
    const user = c.var.user;
    if (!user) throw new HttpError(403, "FORBIDDEN", "this action needs a signed-in user");
    const body = await parseJsonBody(c, seenBody);
    await savePreferences(sql, user.id, { achievementsSeen: body.achievements, retroMessageSeen: body.retroMessage });
    return c.json({ ok: true });
  });

  app.get("/api/insights/preferences", async (c) => c.json({ ...(await prefsOf(c)), recapEmailAvailable: deps.recapEmails }));

  app.put("/api/insights/preferences", async (c) => {
    const user = c.var.user;
    if (!user) throw new HttpError(403, "FORBIDDEN", "this action needs a signed-in user");
    const body = await parseJsonBody(c, preferencesBody);
    // Masquer la progression puis la réafficher n'annonce pas d'un coup tout ce qui s'est débloqué entre-temps.
    const turningOn = body.showProgression === true && !(await prefsOf(c)).showProgression;
    return c.json(await savePreferences(sql, user.id, { ...body, achievementsSeen: turningOn || undefined }));
  });

  // ───────────────────────── Récaps ─────────────────────────

  app.get("/api/insights/recaps", async (c) => c.json({ recaps: await listRecaps(sql) }));

  app.get("/api/insights/recaps/:period", async (c) => {
    const period = c.req.param("period");
    if (!isRecapPeriod(period)) throw new HttpError(400, "VALIDATION_ERROR", "a period is YYYY-MM or YYYY");
    const recap = await getRecap(sql, period);
    if (!recap) throw new HttpError(404, "RECAP_NOT_FOUND", "no recap for this period");
    const prefs = await prefsOf(c);
    const settings = await getAppSettings(sql);
    return c.json({
      period: recap.period, createdAt: recap.createdAt, data: recapForUser(recap.data, prefs),
      showProgression: prefs.showProgression, shopName: settings.seller.name || null,
      // Parrainage pas encore en place (progressionConfig.referral) : ni lien `/r/{CODE}` ni suggestion.
      referral: null,
    });
  });

  // ───────────────────────── Tâche quotidienne ─────────────────────────

  /**
   * Pour le compte désigné (tâche planifiée) : reconstruit le journal d'après l'historique (rattrapage), confirme les
   * ventes et recalcule niveau, succès et avantages, génère les récaps dus et les annonce par e-mail.
   */
  app.post("/api/insights/daily", async (c) => {
    const timezone = await accountTimezone(root, sql, c.var.accountId);
    const rebuilt = await rebuildJournal(sql);
    const progress = await evaluateProgress(sql, { timezone, hooks: deps.perkHooks });
    const recaps = await generateDueRecaps(sql, { timezone });
    const emailed = await emailRecaps(c.var.accountId).catch((e: unknown) => {
      deps.onError(e);
      return 0;
    });
    return c.json({ rebuilt, progress, recaps, emailed });
  });

  /** Annonce par e-mail les récaps pas encore envoyés, à chaque utilisateur qui ne s'en est pas désinscrit. */
  async function emailRecaps(accountId: string): Promise<number> {
    // E-mail du récap coupé : rien ne part, les récaps restent dans l'application.
    if (!deps.recapEmails) return 0;
    const pending = await recapsToEmail(sql);
    if (pending.length === 0) return 0;
    const mailer = deps.mailer();
    // Sans service d'e-mail (Community sans configuration) : le récap reste dans l'application.
    if (!mailer) return 0;
    const members = await root<{ id: string; email: string }[]>`select id, email from auth_users where "accountId" = ${accountId}`;
    let sent = 0;
    for (const recap of pending) {
      for (const member of members) {
        if (!(await getPreferences(sql, member.id)).recapEmail) continue;
        const base = deps.baseUrl();
        const url = new URL(`/recap/${recap.period}`, base).toString();
        const unsubscribe = new URL(`/email/unsubscribe?a=${accountId}&u=${encodeURIComponent(member.id)}&s=${unsubscribeSignature(deps.token, accountId, member.id)}`, base).toString();
        await mailer.send(recapMail(member.email, {
          period: recap.data.kind === "year" ? recap.period : monthName(recap.period),
          cardsSold: recap.data.cardsSold, timeSavedMinutes: recap.data.timeSavedMinutes, url, unsubscribe,
        }));
        sent++;
      }
      await markRecapEmailed(sql, recap.period);
    }
    return sent;
  }

  /** Désinscription de l'e-mail du récap depuis le lien d'un e-mail, sans session : le lien est signé. */
  app.post("/api/public/recap-email/unsubscribe", async (c) => {
    const body = await parseJsonBody(c, unsubscribeBody);
    if (!secretEquals(body.s, unsubscribeSignature(deps.token, body.a, body.u))) {
      throw new HttpError(403, "INVALID_LINK", "this unsubscribe link is not valid");
    }
    await withAccount(root, body.a, (tx) => savePreferences(tx, body.u, { recapEmail: false }));
    return c.json({ ok: true });
  });
}

/**
 * Le fuseau du compte : celui que son propriétaire (le premier utilisateur inscrit) a choisi, sinon celui par défaut.
 * Il découpe les semaines de régularité et les mois des récaps.
 */
export async function accountTimezone(root: Db, sql: Db, accountId: string): Promise<string> {
  const [owner] = await root<{ id: string }[]>`select id from auth_users where "accountId" = ${accountId} order by "createdAt", id limit 1`;
  return (await getPreferences(sql, owner?.id)).timezone;
}

/** Réévalue niveau et succès après un changement qui peut en débloquer (publication, vente, stock). */
export async function evaluateAfterChange(root: Db, sql: Db, accountId: string, hooks: PerkHooks) {
  const timezone = await accountTimezone(root, sql, accountId);
  return withTx(sql, () => evaluateProgress(sql, { timezone, hooks }));
}

