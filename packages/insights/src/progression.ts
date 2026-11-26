import { withTx, type Db } from "@dexlane/db";
import { EBAY_MARKETPLACES, getEbaySettings } from "@dexlane/listings";
import {
  achievements as ACHIEVEMENTS, defaultSellerCountry, levelPerks, levelThresholds, saleConfirmationDays, type AchievementCondition, type AchievementDef, type LevelPerk,
} from "./config/progression";
import { onboardingState } from "./onboarding";
import { countedOrder } from "./sql";

/**
 * Niveau et succès du compte (#86).
 *
 * Le niveau dépend des seules ventes confirmées : une vente compte quand elle a passé `saleConfirmationDays` jours sans
 * annulation, retour ni remboursement. Une vente confirmée est écrite une fois (sale_confirmations) et n'est jamais
 * retirée : le niveau ne descend pas. Les annonces publiées ne donnent aucun point.
 */

// ───────────────────────── Ventes confirmées ─────────────────────────

/**
 * Confirme les ventes qui ont passé le délai sans être annulées, remboursées ni retournées. Une vente est une unité
 * vendue d'une annonce : les ventes directes (sans annonce) ne comptent pas, un lot compte pour 1.
 */
export async function confirmSales(sql: Db, now = new Date()): Promise<number> {
  const rows = await sql`
    insert into sale_confirmations (order_line_id, units, sold_at)
    select ol.id, ol.qty, o.ordered_at
      from order_lines ol join orders o on o.id = ol.order_id
     where o.channel <> 'direct' and ${countedOrder(sql)}
       and o.ordered_at <= ${now}::timestamptz - make_interval(days => ${saleConfirmationDays})
    on conflict (account_id, order_line_id) do nothing`;
  return rows.count;
}

export async function confirmedSales(sql: Db): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select coalesce(sum(units), 0)::int as n from sale_confirmations`;
  return row!.n;
}

// ───────────────────────── Niveau ─────────────────────────

export interface LevelState {
  level: number;
  confirmedSales: number;
  /** Le niveau suivant et les ventes confirmées qui manquent ; null au dernier niveau. */
  next: { level: number; threshold: number; salesNeeded: number } | null;
  /** Avancement vers le niveau suivant, de 0 à 100. */
  progressPercent: number;
}

/**
 * Le niveau que valent les ventes confirmées. Le niveau 1 (seuil 0) s'obtient en terminant le démarrage ou à la
 * première vente confirmée ; les suivants d'après les seuils de ventes.
 */
export function levelFor(confirmed: number, onboardingComplete: boolean): number {
  let level = 0;
  levelThresholds.forEach((threshold, i) => {
    if (confirmed >= threshold) level = i + 1;
  });
  if (level === 1 && !onboardingComplete && confirmed === 0) return 0;
  return level;
}

export function levelState(level: number, confirmed: number): LevelState {
  const max = levelThresholds.length;
  if (level >= max) return { level, confirmedSales: confirmed, next: null, progressPercent: 100 };
  const threshold = Math.max(levelThresholds[level]!, level === 0 ? 1 : 0);
  const from = level === 0 ? 0 : levelThresholds[level - 1]!;
  const salesNeeded = Math.max(0, threshold - confirmed);
  const progressPercent = threshold === from ? 100 : Math.min(100, Math.max(0, Math.round(((confirmed - from) / (threshold - from)) * 100)));
  return { level, confirmedSales: confirmed, next: { level: level + 1, threshold, salesNeeded }, progressPercent };
}

// ───────────────────────── Faits mesurés ─────────────────────────

export interface ProgressFacts {
  onboardingComplete: boolean;
  listingsPublished: number;
  inStockCards: number;
  unlocatedCards: number;
  confirmedSales: number;
  confirmedGradedSale: boolean;
  confirmedExportSale: boolean;
  /** Plus longue suite de jours (fuseau de l'utilisateur) avec au moins `minPerDay` annonces publiées et aucune en échec. */
  flawlessDays: (minPerDay: number) => Promise<number>;
  /** Le plus d'annonces publiées en moins de `withinMinutes` minutes. */
  publishBurst: (withinMinutes: number) => Promise<number>;
  /** Plus longue suite de semaines ISO avec au moins une annonce publiée. */
  weeklyStreak: number;
  referralsQualified: number;
  referralFullDiscount: boolean;
}

export async function progressFacts(sql: Db, timezone: string): Promise<ProgressFacts> {
  const onboarding = await onboardingState(sql);
  const ebay = await getEbaySettings(sql);
  const sellerCountry = EBAY_MARKETPLACES[ebay.marketplaceId]?.country ?? defaultSellerCountry;
  const [f] = await sql<Omit<ProgressFacts, "onboardingComplete" | "flawlessDays" | "publishBurst">[]>`
    select (select count(*)::int from account_events where type = 'listing_published') as listings_published,
           (select coalesce(sum(on_hand), 0)::int from stock_items where kind <> 'BULK' and lifecycle <> 'ARCHIVED' and on_hand > 0) as in_stock_cards,
           (select count(*)::int from stock_items where kind <> 'BULK' and lifecycle <> 'ARCHIVED' and on_hand > 0 and location_id is null) as unlocated_cards,
           (select coalesce(sum(units), 0)::int from sale_confirmations) as confirmed_sales,
           exists (select 1 from sale_confirmations sc join order_lines ol on ol.id = sc.order_line_id join offers off on off.id = ol.offer_id
                    where off.grader is not null) as confirmed_graded_sale,
           exists (select 1 from sale_confirmations sc join order_lines ol on ol.id = sc.order_line_id join orders o on o.id = ol.order_id
                    where upper(o.shipping_address->>'country') <> ${sellerCountry}) as confirmed_export_sale,
           (select coalesce(max(n), 0)::int from (
              select count(*) as n from (
                select w, w - (row_number() over (order by w) * interval '7 days') as grp
                  from (select distinct date_trunc('week', occurred_at at time zone ${timezone}) as w
                          from account_events where type = 'listing_published') weeks
              ) islands group by grp) streaks) as weekly_streak,
           (select count(*)::int from account_events where type = 'referral_qualified') as referrals_qualified,
           exists (select 1 from account_events where type = 'referral_discount_full') as referral_full_discount`;
  return {
    ...f!,
    onboardingComplete: onboarding.complete,
    flawlessDays: async (minPerDay) => {
      const [row] = await sql<{ n: number }[]>`
        select coalesce(max(n), 0)::int as n from (
          select count(*) as n from (
            select d, d - (row_number() over (order by d))::int as grp
              from (select (occurred_at at time zone ${timezone})::date as d,
                           count(*) filter (where type = 'listing_published') as published,
                           count(*) filter (where type = 'listing_failed') as failed
                      from account_events where type in ('listing_published', 'listing_failed')
                     group by 1) days
             where published >= ${minPerDay} and failed = 0
          ) islands group by grp) streaks`;
      return row!.n;
    },
    publishBurst: async (withinMinutes) => {
      // « En moins d'une heure » : la fenêtre s'arrête juste avant la soixantième minute.
      const [row] = await sql<{ n: number }[]>`
        select coalesce(max(n), 0)::int as n from (
          select count(*) over (order by occurred_at range between current row
                                and make_interval(mins => ${withinMinutes}) - interval '1 microsecond' following) as n
            from account_events where type = 'listing_published') w`;
      return row!.n;
    },
  };
}

async function satisfied(c: AchievementCondition, f: ProgressFacts): Promise<boolean> {
  switch (c.kind) {
    case "onboardingComplete": return f.onboardingComplete;
    case "listingsPublished": return f.listingsPublished >= c.atLeast;
    case "allStockLocated": return f.inStockCards >= c.minCards && f.unlocatedCards === 0;
    case "confirmedSales": return f.confirmedSales >= c.atLeast;
    case "confirmedGradedSale": return f.confirmedGradedSale;
    case "confirmedExportSale": return f.confirmedExportSale;
    case "flawlessDays": return (await f.flawlessDays(c.minPerDay)) >= c.days;
    case "publishBurst": return (await f.publishBurst(c.withinMinutes)) >= c.count;
    case "weeklyStreak": return f.weeklyStreak >= c.weeks;
    case "referralsQualified": return f.referralsQualified >= c.atLeast;
    case "referralFullDiscount": return f.referralFullDiscount;
  }
}

// ───────────────────────── Évaluation ─────────────────────────

/**
 * Point d'extension des avantages de niveau : les bonus de cartes passent par la facturation et le quota, qui n'existent
 * que dans la version hébergée. Sans `grantBonusCards` (Community), seul l'accès anticipé s'applique.
 */
export interface PerkHooks {
  /** Ajoute des cartes de bonus sur le mois en cours ; renvoie ce qui a été fait (gardé avec l'avantage). */
  grantBonusCards?: (sql: Db, cards: number) => Promise<Record<string, unknown>>;
}

export interface EvaluationResult {
  level: number;
  previousLevel: number;
  /** Succès obtenus par cette évaluation. */
  unlocked: string[];
  perksApplied: { level: number; perk: LevelPerk["kind"] }[];
  confirmed: number;
  /** Cette évaluation était l'attribution rétroactive (compte existant au lancement) : aucune notification. */
  retroactive: boolean;
}

/**
 * Évalue niveau, succès et avantages du compte en cours. Idempotent : une évaluation rejouée (ou deux en même temps)
 * n'attribue rien de plus, grâce aux clés uniques (compte, succès) et (compte, niveau, avantage).
 */
export async function evaluateProgress(sql: Db, opts: { timezone: string; now?: Date; hooks?: PerkHooks }): Promise<EvaluationResult> {
  return withTx(sql, async (tx) => {
    await tx`insert into account_progress default values on conflict (account_id) do nothing`;
    const [progress] = await tx<{ level: number; retroactivePending: boolean; onboardingCompletedAt: Date | null }[]>`
      select level, retroactive_pending, onboarding_completed_at from account_progress for update`;
    const retroactive = progress!.retroactivePending;
    const source = retroactive ? "retroactive" : "live";

    await confirmSales(tx, opts.now);
    const confirmed = await confirmedSales(tx);
    const facts = await progressFacts(tx, opts.timezone);

    const unlocked: string[] = [];
    for (const def of ACHIEVEMENTS) {
      if (!(await satisfied(def.condition, facts))) continue;
      const inserted = await tx`
        insert into account_achievements (achievement, source) values (${def.id}, ${source})
        on conflict (account_id, achievement) do nothing returning achievement`;
      if (inserted.length) unlocked.push(def.id);
    }

    // Le niveau ne descend jamais : on garde le plus haut atteint.
    const level = Math.max(progress!.level, levelFor(confirmed, facts.onboardingComplete));
    const perksApplied: EvaluationResult["perksApplied"] = [];
    for (const [perkLevel, perks] of Object.entries(levelPerks).map(([l, p]) => [Number(l), p] as const)) {
      if (perkLevel > level) continue;
      for (const perk of perks) {
        const [row] = await tx`
          insert into account_perks (level, perk) values (${perkLevel}, ${perk.kind})
          on conflict (account_id, level, perk) do nothing returning level`;
        if (!row) continue;
        let detail: Record<string, unknown> = {};
        if (perk.kind === "beta") await tx`update account_progress set beta = true`;
        if (perk.kind === "bonusCards") {
          detail = opts.hooks?.grantBonusCards ? await opts.hooks.grantBonusCards(tx, perk.cards) : { skipped: "no billing in this installation" };
        }
        await tx`update account_perks set detail = ${tx.json(detail as never)} where level = ${perkLevel} and perk = ${perk.kind}`;
        perksApplied.push({ level: perkLevel, perk: perk.kind });
      }
    }

    await tx`
      update account_progress set
        level = ${level},
        level_reached_at = case when ${level} > level then now() else level_reached_at end,
        onboarding_completed_at = case when ${facts.onboardingComplete} then coalesce(onboarding_completed_at, now()) else onboarding_completed_at end,
        retroactive_pending = false,
        retroactive_at = case when retroactive_pending then now() else retroactive_at end,
        evaluated_at = now()`;
    return { level, previousLevel: progress!.level, unlocked, perksApplied, confirmed, retroactive };
  });
}

// ───────────────────────── Lecture ─────────────────────────

export interface AchievementState extends AchievementDef {
  unlockedAt: Date | null;
  source: "live" | "retroactive" | null;
}

export interface ProgressView {
  level: LevelState;
  beta: boolean;
  achievements: AchievementState[];
  /** Succès obtenus, les plus récents d'abord. */
  recent: AchievementState[];
  unlockedCount: number;
  retroactiveCount: number;
  onboardingCompletedAt: Date | null;
}

export async function getProgress(sql: Db): Promise<ProgressView> {
  const [progress] = await sql<{ level: number; beta: boolean; onboardingCompletedAt: Date | null }[]>`
    select level, beta, onboarding_completed_at from account_progress`;
  const owned = await sql<{ achievement: string; unlockedAt: Date; source: "live" | "retroactive" }[]>`
    select achievement, unlocked_at, source from account_achievements where revoked_at is null`;
  const byId = new Map(owned.map((a) => [a.achievement, a]));
  const all = ACHIEVEMENTS.map((def) => ({ ...def, unlockedAt: byId.get(def.id)?.unlockedAt ?? null, source: byId.get(def.id)?.source ?? null }));
  const recent = all.filter((a) => a.unlockedAt).sort((a, b) => b.unlockedAt!.getTime() - a.unlockedAt!.getTime());
  return {
    level: levelState(progress?.level ?? 0, await confirmedSales(sql)),
    beta: progress?.beta ?? false,
    achievements: all,
    recent: recent.slice(0, 5),
    unlockedCount: recent.length,
    retroactiveCount: recent.filter((a) => a.source === "retroactive").length,
    onboardingCompletedAt: progress?.onboardingCompletedAt ?? null,
  };
}

/** Succès obtenus au fil de l'eau après `since` (notification groupée dans l'application ; jamais d'e-mail). */
export async function achievementsSince(sql: Db, since: Date | null): Promise<AchievementState[]> {
  const rows = await sql<{ achievement: string; unlockedAt: Date }[]>`
    select achievement, unlocked_at from account_achievements
     where revoked_at is null and source = 'live' ${since ? sql`and unlocked_at > ${since}` : sql``}
     order by unlocked_at`;
  return rows.flatMap((r) => {
    const def = ACHIEVEMENTS.find((a) => a.id === r.achievement);
    return def ? [{ ...def, unlockedAt: r.unlockedAt, source: "live" as const }] : [];
  });
}

/** Retire un succès pour fraude constatée : action manuelle d'un administrateur, auditée. */
export async function revokeAchievement(sql: Db, input: { achievement: string; reason: string; actor: string }): Promise<boolean> {
  const rows = await sql`
    update account_achievements set revoked_at = now(), revoked_reason = ${input.reason}
     where achievement = ${input.achievement} and revoked_at is null returning achievement`;
  if (rows.length) {
    await sql`
      insert into audit_events (actor, action, entity, entity_id, after)
      values (${input.actor}, 'achievement_revoked', 'achievement', ${input.achievement}, ${sql.json({ reason: input.reason })})`;
  }
  return rows.length > 0;
}
