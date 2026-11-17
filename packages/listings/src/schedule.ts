import { withTx, type Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";
import { isChannel, type ChannelId } from "./channel-ids";
import { publishListing, type ChannelAdapters } from "./channels";

/** Date du jour à Paris, « 2026-11-18 » : c'est le calendrier du vendeur qui fait foi, pas celui du serveur. */
export function todayInParis(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface PlanInput {
  /** Offres à mettre en ligne, dans l'ordre voulu ; sinon toutes les offres prêtes, dans l'ordre d'entrée en stock. */
  offerIds?: string[];
  channel: ChannelId;
  /** Premier jour de publication, « AAAA-MM-JJ ». */
  startOn: string;
  perDay: number;
  actor: string;
}

export interface PlanResult {
  planned: number;
  days: number;
  firstDay: string | null;
  lastDay: string | null;
  /** Offres laissées de côté : déjà en ligne sur ce canal, sans prix ou sans stock vendable. */
  skipped: number;
}

/**
 * Répartit des offres sur des jours consécutifs, `perDay` par jour. Une offre déjà planifiée sur ce canal change de date ;
 * une offre déjà en ligne, sans prix ou sans stock vendable est laissée de côté.
 */
export async function planPublications(sql: Db, input: PlanInput): Promise<PlanResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startOn) || input.startOn < todayInParis()) {
    throw new DomainError("INVALID_SCHEDULE", "the first day must be today or later");
  }
  if (!Number.isInteger(input.perDay) || input.perDay < 1 || input.perDay > 500) {
    throw new DomainError("INVALID_SCHEDULE", "between 1 and 500 listings a day");
  }
  return withTx(sql, async (tx) => {
    const [channel] = await tx<{ mode: string }[]>`select mode from channel_settings where channel = ${input.channel}`;
    if (!channel || channel.mode === "OFF") throw new DomainError("CHANNEL_DISABLED", `channel ${input.channel} is switched off`);

    const eligible = await tx<{ id: string }[]>`
      select o.id from offers o
        join lateral (
          select coalesce(sum(i.on_hand - i.reserved - i.inspection - i.quarantine) filter (where i.lifecycle = 'ACTIVE'), 0) as available,
                 min(i.created_at) as received_at, min(i.unit_sku) as first_sku
            from stock_items i where i.offer_id = o.id and i.lifecycle <> 'ARCHIVED') s on true
       where s.available > 0 and o.target_price_cents is not null
         and not exists (select 1 from listings l where l.offer_id = o.id and l.channel = ${input.channel} and l.status <> 'ENDED')
         ${input.offerIds ? tx`and o.id in ${tx(input.offerIds.length ? input.offerIds : [null])}` : tx``}
       order by s.first_sku`;
    // L'ordre demandé par l'appelant prime ; à défaut, l'ordre d'entrée en stock (celui du scan).
    const ordered = input.offerIds ? input.offerIds.filter((id) => eligible.some((e) => e.id === id)) : eligible.map((e) => e.id);
    for (const [index, offerId] of ordered.entries()) {
      const plannedOn = addDays(input.startOn, Math.floor(index / input.perDay));
      await tx`
        insert into scheduled_publications (offer_id, channel, planned_on, rank) values (${offerId}, ${input.channel}, ${plannedOn}, ${index})
        on conflict (offer_id, channel) where status = 'PENDING' do update set planned_on = excluded.planned_on, rank = excluded.rank`;
    }
    const days = Math.ceil(ordered.length / input.perDay);
    await tx`
      insert into audit_events (actor, action, entity, entity_id, after)
      values (${input.actor}, 'publications_planned', 'channel', ${input.channel}, ${tx.json({ planned: ordered.length, startOn: input.startOn, perDay: input.perDay })})`;
    return {
      planned: ordered.length, days, firstDay: ordered.length ? input.startOn : null, lastDay: ordered.length ? addDays(input.startOn, days - 1) : null,
      skipped: (input.offerIds?.length ?? ordered.length) - ordered.length,
    };
  });
}

export interface ScheduleDay {
  plannedOn: string;
  channel: ChannelId;
  count: number;
  /** Premières cartes du jour, pour s'y retrouver. */
  cardNames: string[];
}

export interface Schedule {
  days: ScheduleDay[];
  pending: number;
  /** Publications qui n'ont pas pu se faire, à corriger puis replanifier. */
  failed: { id: string; offerId: string; cardName: string; offerSku: string; channel: ChannelId; plannedOn: string; errorCode: string | null }[];
}

export async function getSchedule(sql: Db): Promise<Schedule> {
  const days = await sql<ScheduleDay[]>`
    select to_char(sp.planned_on, 'YYYY-MM-DD') as planned_on, sp.channel, count(*)::int as count,
           (array_agg(c.name order by sp.rank, sp.id))[1:3] as card_names
      from scheduled_publications sp
      join offers o on o.id = sp.offer_id
      join card_variants v on v.id = o.variant_id
      join catalog_cards c on c.id = v.catalog_card_id
     where sp.status = 'PENDING'
     group by sp.planned_on, sp.channel order by sp.planned_on, sp.channel`;
  const failed = await sql<Schedule["failed"]>`
    select sp.id, sp.offer_id, c.name as card_name, o.offer_sku, sp.channel, to_char(sp.planned_on, 'YYYY-MM-DD') as planned_on, sp.error_code
      from scheduled_publications sp
      join offers o on o.id = sp.offer_id
      join card_variants v on v.id = o.variant_id
      join catalog_cards c on c.id = v.catalog_card_id
     where sp.status = 'FAILED' and sp.done_at >= now() - interval '14 days'
       and not exists (select 1 from scheduled_publications later where later.offer_id = sp.offer_id and later.channel = sp.channel and later.created_at > sp.created_at)
       and not exists (select 1 from listings l where l.offer_id = sp.offer_id and l.channel = sp.channel and l.status <> 'ENDED')
     order by sp.done_at desc limit 50`;
  return { days, failed, pending: days.reduce((sum, d) => sum + d.count, 0) };
}

/** Annule les publications en attente : d'un jour donné, d'une offre, ou toutes. */
export async function cancelPublications(sql: Db, filter: { plannedOn?: string; channel?: ChannelId; offerId?: string } = {}): Promise<number> {
  const rows = await sql`
    update scheduled_publications set status = 'CANCELLED', done_at = now()
     where status = 'PENDING'
       ${filter.plannedOn ? sql`and planned_on = ${filter.plannedOn}` : sql``}
       ${filter.channel ? sql`and channel = ${filter.channel}` : sql``}
       ${filter.offerId ? sql`and offer_id = ${filter.offerId}` : sql``}
    returning id`;
  return rows.length;
}

/**
 * Publie tout ce qui est dû (jour planifié atteint). Une publication impossible est marquée en échec avec son motif,
 * sans bloquer les autres : elle réapparaît dans le planning pour être corrigée.
 */
export async function runDuePublications(sql: Db, live: ChannelAdapters, actor: string, today = todayInParis()): Promise<{ published: number; failed: number }> {
  const due = await sql<{ id: string; offerId: string; channel: string }[]>`
    select id, offer_id, channel from scheduled_publications
     where status = 'PENDING' and planned_on <= ${today} order by planned_on, rank, id`;
  let published = 0;
  let failed = 0;
  for (const item of due) {
    try {
      if (!isChannel(item.channel)) throw new DomainError("CHANNEL_DISABLED", "unknown channel");
      const listing = await publishListing(sql, live, { offerId: item.offerId, channel: item.channel, actor });
      await sql`update scheduled_publications set status = 'DONE', listing_id = ${listing.id}, done_at = now() where id = ${item.id}`;
      published++;
    } catch (e) {
      await sql`
        update scheduled_publications set status = 'FAILED', error_code = ${e instanceof DomainError ? e.code : "PUBLISH_FAILED"}, done_at = now()
         where id = ${item.id}`;
      failed++;
    }
  }
  return { published, failed };
}
