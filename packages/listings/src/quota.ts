import type { Db } from "@dexlane/db";
import {
  DomainError, OVERAGE_PACK, PLAN_RULES, SCANS_PER_MINUTE, cheapestPlanWith, planRule, quotaMonth, type PlanFeature, type PlanRule,
} from "@dexlane/shared";

/**
 * Forfait du compte et quota de cartes publiées. Tout se lit dans la transaction du compte en cours (row-level security) :
 * sans compte désigné — scripts, tests des paquets —, c'est le compte d'installation, sans limite.
 */

/** Forfaits coupés pour toute l'installation (version Community auto-hébergée) : `DEXLANE_PLANS=off`. */
export const plansEnforced = (env: NodeJS.ProcessEnv = process.env) => env.DEXLANE_PLANS !== "off";

/** Le forfait qui s'applique au compte en cours. */
export async function accountPlan(sql: Db): Promise<PlanRule> {
  if (!plansEnforced()) return PLAN_RULES.community;
  // Le compte d'installation (le propriétaire du serveur) n'a jamais de limite.
  const [row] = await sql<{ plan: string }[]>`
    select case when id = owner_account_id() then 'community' else plan end as plan from accounts where id = current_account_id()`;
  if (!row) return PLAN_RULES.community;
  return planRule(row?.plan);
}

/** Refuse ce que le forfait ne comprend pas, en disant quel forfait le comprend. */
export async function requireFeature(sql: Db, feature: PlanFeature, what: string): Promise<void> {
  const plan = await accountPlan(sql);
  if (plan.features.includes(feature)) return;
  const needed = cheapestPlanWith(feature);
  throw new DomainError("FEATURE_NOT_IN_PLAN", `${what} : disponible à partir du forfait ${needed.name}`, { feature, plan: plan.id, requiredPlan: needed.id });
}

export async function hasFeature(sql: Db, feature: PlanFeature): Promise<boolean> {
  return (await accountPlan(sql)).features.includes(feature);
}

export interface QuotaState {
  plan: PlanRule;
  /** Premier jour du mois du quota (AAAA-MM-JJ). */
  month: string;
  /** Cartes publiées ce mois-ci. */
  used: number;
  /** Cartes comprises dans le forfait ; null : sans limite. */
  included: number | null;
  /** Cartes des packs ajoutés ce mois-ci. */
  packCards: number;
  packs: { id: string; cards: number; priceCents: number; automatic: boolean; createdAt: Date }[];
  /** Forfait + packs ; null : sans limite. */
  limit: number | null;
  /** Ce qui reste à publier ce mois-ci ; null : sans limite. */
  remaining: number | null;
}

export async function quotaState(sql: Db, now = new Date()): Promise<QuotaState> {
  const plan = await accountPlan(sql);
  const month = quotaMonth(now);
  const [[usage], packs] = await Promise.all([
    sql<{ used: number }[]>`select count(*)::int as used from publication_usage where month = ${month}`,
    sql<QuotaState["packs"]>`select id, cards, price_cents, automatic, created_at from quota_packs where month = ${month} order by created_at`,
  ]);
  const packCards = packs.reduce((n, p) => n + p.cards, 0);
  const limit = plan.cardsPerMonth === null ? null : plan.cardsPerMonth + packCards;
  return {
    plan, month, used: usage!.used, included: plan.cardsPerMonth, packCards, packs, limit,
    remaining: limit === null ? null : Math.max(0, limit - usage!.used),
  };
}

/** L'offre a-t-elle déjà été comptée sur ce canal (une première publication, un jour) ? */
async function alreadyCounted(sql: Db, offerId: string, channel: string): Promise<boolean> {
  const [row] = await sql`select 1 from publication_usage where offer_id = ${offerId} and channel = ${channel}`;
  return !!row;
}

/**
 * Une publication en masse (la mise en ligne du jour, une sélection publiée d'un coup). Commencée sous le quota, elle
 * va au bout : on ne bloque jamais une publication en cours. Sur un forfait payant, ce qui dépasse est couvert par des
 * packs ajoutés automatiquement à la fin ; sur le forfait gratuit, ce qui dépasse attend le mois suivant.
 */
export interface PublicationBatch {
  /** Le quota restait ouvert quand la publication a commencé. */
  startedUnderQuota: boolean;
  /** Forfait payant : le dépassement est couvert par des packs ; sinon il est reporté. */
  coverOverage: boolean;
}

export async function startPublicationBatch(sql: Db): Promise<PublicationBatch> {
  const state = await quotaState(sql);
  return { startedUnderQuota: state.remaining === null || state.remaining > 0, coverOverage: state.plan.monthlyPriceEur > 0 };
}

export type QuotaDecision = { count: boolean; overQuota: boolean };

/**
 * Avant de publier : la publication compte-t-elle, et le quota la permet-il ? Une révision, une remise en ligne ou une
 * annonce simulée ne compte pas. Hors quota, une publication isolée est refusée ; dans une publication en masse commencée
 * sous le quota, elle passe (forfait payant) ou attend le mois suivant (`QUOTA_POSTPONED`).
 */
export async function checkQuota(
  sql: Db,
  input: { offerId: string; channel: string; simulated: boolean; revision: boolean; batch?: PublicationBatch },
): Promise<QuotaDecision> {
  if (input.simulated || input.revision || (await alreadyCounted(sql, input.offerId, input.channel))) return { count: false, overQuota: false };
  const state = await quotaState(sql);
  if (state.remaining === null || state.remaining > 0) return { count: true, overQuota: false };
  if (input.batch?.startedUnderQuota && input.batch.coverOverage) return { count: true, overQuota: true };
  const details = { used: state.used, limit: state.limit, plan: state.plan.id, pack: OVERAGE_PACK };
  if (input.batch?.startedUnderQuota) throw new DomainError("QUOTA_POSTPONED", "quota du mois atteint : la carte sera publiée le mois prochain", details);
  throw new DomainError(
    "QUOTA_EXCEEDED",
    `tu as publié tes ${state.limit} cartes du mois : ajoute un pack de ${OVERAGE_PACK.cards} cartes ou passe au forfait supérieur`,
    details,
  );
}

/** Après une publication réussie qui compte. */
export async function recordPublication(sql: Db, input: { offerId: string; channel: string; overQuota: boolean }): Promise<void> {
  await sql`
    insert into publication_usage (offer_id, channel, month, over_quota) values (${input.offerId}, ${input.channel}, ${quotaMonth()}, ${input.overQuota})
    on conflict (account_id, offer_id, channel) do nothing`;
}

/** Ajoute un pack de cartes pour le mois en cours. */
export async function addQuotaPack(sql: Db, input: { actor: string; automatic?: boolean; packs?: number }): Promise<QuotaState> {
  const n = Math.max(1, Math.min(input.packs ?? 1, 20));
  const month = quotaMonth();
  for (let i = 0; i < n; i++) {
    await sql`
      insert into quota_packs (month, cards, price_cents, automatic, actor)
      values (${month}, ${OVERAGE_PACK.cards}, ${OVERAGE_PACK.priceEur * 100}, ${input.automatic ?? false}, ${input.actor})`;
  }
  await sql`
    insert into audit_events (actor, action, entity, entity_id, after)
    values (${input.actor}, 'quota_pack_added', 'account', current_account_id()::text,
            ${sql.json({ month, packs: n, cards: n * OVERAGE_PACK.cards, priceEur: n * OVERAGE_PACK.priceEur, automatic: input.automatic ?? false })})`;
  return quotaState(sql);
}

/** Fin d'une publication en masse sur un forfait payant : les packs nécessaires couvrent ce qui a dépassé. */
export async function coverOverage(sql: Db, actor: string): Promise<number> {
  const state = await quotaState(sql);
  if (state.limit === null || state.used <= state.limit) return 0;
  const packs = Math.ceil((state.used - state.limit) / OVERAGE_PACK.cards);
  await addQuotaPack(sql, { actor, automatic: true, packs });
  return packs;
}

/** Seuil d'alerte franchi pour la première fois ce mois-ci (80 puis 100 %) ; null sinon. */
export async function takeQuotaAlert(sql: Db): Promise<{ level: 80 | 100; state: QuotaState } | null> {
  const state = await quotaState(sql);
  if (state.limit === null || state.limit === 0) return null;
  const ratio = (state.used / state.limit) * 100;
  const level = ratio >= 100 ? 100 : ratio >= 80 ? 80 : null;
  if (!level) return null;
  const [inserted] = await sql`
    insert into quota_alerts (month, level) values (${state.month}, ${level}) on conflict do nothing returning level`;
  return inserted ? { level, state } : null;
}

// ───────────────────────── Scans ─────────────────────────

export interface ScanQuotaState {
  month: string;
  /** Photos lues ce mois-ci. */
  used: number;
  /** Forfait + scans des packs du mois ; null : sans limite. */
  limit: number | null;
  remaining: number | null;
}

export async function scanQuotaState(sql: Db, now = new Date()): Promise<ScanQuotaState> {
  const plan = await accountPlan(sql);
  const month = quotaMonth(now);
  const [[usage], [packs]] = await Promise.all([
    sql<{ used: number }[]>`select count(*)::int as used from scan_usage where month = ${month}`,
    sql<{ n: number }[]>`select count(*)::int as n from quota_packs where month = ${month}`,
  ]);
  const limit = plan.scansPerMonth === null ? null : plan.scansPerMonth + packs!.n * OVERAGE_PACK.scans;
  return { month, used: usage!.used, limit, remaining: limit === null ? null : Math.max(0, limit - usage!.used) };
}

/**
 * Avant d'envoyer une photo à Claude : réserve un scan, ou refuse. Le plafond du mois vient du forfait (le compte
 * d'installation n'en a pas) ; la limite par minute vaut pour tous, contre une boucle ou un script qui s'emballe.
 * Renvoie l'identifiant du scan, pour y noter le coût une fois la lecture faite.
 */
export async function reserveScan(sql: Db, source: "single" | "batch", now = new Date()): Promise<string> {
  const [recent] = await sql<{ n: number }[]>`
    select count(*)::int as n from scan_usage where created_at > ${new Date(now.getTime() - 60_000)}`;
  if (recent!.n >= SCANS_PER_MINUTE) {
    throw new DomainError("SCAN_RATE_LIMITED", `plus de ${SCANS_PER_MINUTE} scans en une minute : réessaie dans un instant`, { perMinute: SCANS_PER_MINUTE });
  }
  const state = await scanQuotaState(sql, now);
  if (state.remaining !== null && state.remaining <= 0) {
    const plan = await accountPlan(sql);
    throw new DomainError(
      "SCAN_QUOTA_EXCEEDED",
      `tu as utilisé tes ${state.limit} scans du mois : ajoute un pack ou passe au forfait supérieur`,
      { used: state.used, limit: state.limit, plan: plan.id, pack: OVERAGE_PACK },
    );
  }
  const [row] = await sql<{ id: string }[]>`
    insert into scan_usage (month, source, created_at) values (${state.month}, ${source}, ${now}) returning id`;
  return row!.id;
}

/** Coût estimé d'une lecture terminée (null : inconnu). */
export async function recordScanCost(sql: Db, scanId: string, costUsd: number | null): Promise<void> {
  if (costUsd === null) return;
  await sql`update scan_usage set cost_usd = ${costUsd} where id = ${scanId}`;
}
