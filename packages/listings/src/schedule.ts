import { recordEvent, withTx, type Db } from "@dexlane/db";
import { coverOverage, requireFeature, startPublicationBatch } from "./quota";
import { DomainError, nextQuotaMonth, quotaMonth } from "@dexlane/shared";
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
  // Planifier plusieurs cartes d'un coup, c'est la publication en masse.
  if (!input.offerIds || input.offerIds.length > 1) await requireFeature(sql, "bulk", "publication en masse");
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

/**
 * Ajoute des offres à la file de mise en ligne, sans toucher à ce qui est déjà planifié : le jour même si `perDay` est null,
 * sinon au premier jour qui a encore de la place (`perDay` publications par jour, déjà faites ou en attente).
 * C'est ce qu'utilise le pilote automatique, carte après carte. Une offre déjà en ligne, déjà en file, sans prix ou sans
 * stock vendable est laissée de côté.
 */
export async function queuePublications(
  sql: Db,
  input: { offerIds: string[]; channel: ChannelId; perDay: number | null; actor: string; today?: string },
): Promise<{ queued: number; lastDay: string | null }> {
  if (input.offerIds.length === 0) return { queued: 0, lastDay: null };
  if (input.perDay !== null && (!Number.isInteger(input.perDay) || input.perDay < 1 || input.perDay > 500)) {
    throw new DomainError("INVALID_SCHEDULE", "between 1 and 500 listings a day");
  }
  if (input.offerIds.length > 1) await requireFeature(sql, "bulk", "publication en masse");
  const today = input.today ?? todayInParis();
  return withTx(sql, async (tx) => {
    // Une seule file par canal à la fois : deux lots en parallèle ne dépassent pas le rythme du jour.
    await tx`select pg_advisory_xact_lock(hashtext(${`publications:${input.channel}`}))`;
    const [channel] = await tx<{ mode: string }[]>`select mode from channel_settings where channel = ${input.channel}`;
    if (!channel || channel.mode === "OFF") throw new DomainError("CHANNEL_DISABLED", `channel ${input.channel} is switched off`);
    const eligible = await tx<{ id: string }[]>`
      select o.id from offers o
       where o.id in ${tx(input.offerIds)} and o.target_price_cents is not null
         and (select coalesce(sum(i.on_hand - i.reserved - i.inspection - i.quarantine) filter (where i.lifecycle = 'ACTIVE'), 0)
                from stock_items i where i.offer_id = o.id and i.lifecycle <> 'ARCHIVED') > 0
         and not exists (select 1 from listings l where l.offer_id = o.id and l.channel = ${input.channel} and l.status <> 'ENDED')
         and not exists (select 1 from scheduled_publications sp where sp.offer_id = o.id and sp.channel = ${input.channel} and sp.status = 'PENDING')`;
    const ordered = input.offerIds.filter((id, index) => input.offerIds.indexOf(id) === index && eligible.some((e) => e.id === id));
    const load = new Map((await tx<{ day: string; count: number; rank: number }[]>`
      select to_char(planned_on, 'YYYY-MM-DD') as day, count(*)::int as count, coalesce(max(rank), -1)::int as rank
        from scheduled_publications
       where channel = ${input.channel} and planned_on >= ${today} and status in ('PENDING', 'DONE')
       group by planned_on`).map((d) => [d.day, d]));
    let day = today;
    for (const offerId of ordered) {
      while (input.perDay !== null && (load.get(day)?.count ?? 0) >= input.perDay) day = addDays(day, 1);
      const slot = load.get(day) ?? { day, count: 0, rank: -1 };
      load.set(day, { day, count: slot.count + 1, rank: slot.rank + 1 });
      await tx`insert into scheduled_publications (offer_id, channel, planned_on, rank) values (${offerId}, ${input.channel}, ${day}, ${slot.rank + 1})`;
    }
    if (ordered.length > 0) {
      await tx`
        insert into audit_events (actor, action, entity, entity_id, after)
        values (${input.actor}, 'publications_queued', 'channel', ${input.channel}, ${tx.json({ queued: ordered.length, perDay: input.perDay, lastDay: day })})`;
    }
    return { queued: ordered.length, lastDay: ordered.length ? day : null };
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
 *
 * C'est une publication en masse : commencée sous le quota du forfait, elle va au bout. Sur un forfait payant, des packs
 * couvrent ensuite ce qui a dépassé ; sur le forfait gratuit, ce qui dépasse est reporté au premier jour du mois suivant.
 */
export async function runDuePublications(
  sql: Db, live: ChannelAdapters, actor: string, today = todayInParis(),
): Promise<{ published: number; failed: number; postponed: number; packsAdded: number }> {
  const due = await sql<{ id: string; offerId: string; channel: string }[]>`
    select id, offer_id, channel from scheduled_publications
     where status = 'PENDING' and planned_on <= ${today} order by planned_on, rank, id`;
  let published = 0;
  let failed = 0;
  let postponed = 0;
  const batch = due.length > 0 ? await startPublicationBatch(sql) : undefined;
  for (const item of due) {
    try {
      if (!isChannel(item.channel)) throw new DomainError("CHANNEL_DISABLED", "unknown channel");
      const listing = await publishListing(sql, live, { offerId: item.offerId, channel: item.channel, actor, batch });
      await sql`update scheduled_publications set status = 'DONE', listing_id = ${listing.id}, done_at = now() where id = ${item.id}`;
      published++;
    } catch (e) {
      if (e instanceof DomainError && (e.code === "QUOTA_POSTPONED" || e.code === "QUOTA_EXCEEDED")) {
        await sql`update scheduled_publications set planned_on = ${nextQuotaMonth(quotaMonth())} where id = ${item.id}`;
        postponed++;
        continue;
      }
      const errorCode = e instanceof DomainError ? e.code : "PUBLISH_FAILED";
      await sql`
        update scheduled_publications set status = 'FAILED', error_code = ${errorCode}, done_at = now()
         where id = ${item.id}`;
      await recordEvent(sql, { type: "listing_failed", key: `listing_failed:${item.id}`, payload: { offerId: item.offerId, channel: item.channel, errorCode } });
      failed++;
    }
  }
  const packsAdded = batch?.coverOverage ? await coverOverage(sql, actor) : 0;
  return { published, failed, postponed, packsAdded };
}

// ───────────────────────── Calendrier ─────────────────────────

export interface CalendarDay {
  /** « AAAA-MM-JJ » */
  date: string;
  /** Mises en ligne prévues ce jour-là (en attente), par canal. */
  planned: Partial<Record<ChannelId, number>>;
  /** Annonces publiées ce jour-là (planifiées ou à la main). */
  published: number;
  /** Publications planifiées ce jour-là qui ont échoué. */
  failed: number;
}

/** Le calendrier des mises en ligne entre deux dates (incluses) : prévues, publiées, en échec, jour par jour. */
export async function getPublicationCalendar(sql: Db, from: string, to: string): Promise<{ from: string; to: string; days: CalendarDay[] }> {
  const rows = await sql<{ date: string; kind: "PLANNED" | "PUBLISHED" | "FAILED"; channel: string | null; n: number }[]>`
    select to_char(planned_on, 'YYYY-MM-DD') as date, 'PLANNED' as kind, channel, count(*)::int as n
      from scheduled_publications where status = 'PENDING' and planned_on between ${from} and ${to}
     group by planned_on, channel
    union all
    select to_char(planned_on, 'YYYY-MM-DD'), 'FAILED', null, count(*)::int
      from scheduled_publications where status = 'FAILED' and planned_on between ${from} and ${to}
     group by planned_on
    union all
    select to_char((created_at at time zone 'Europe/Paris')::date, 'YYYY-MM-DD'), 'PUBLISHED', null, count(*)::int
      from listings where (created_at at time zone 'Europe/Paris')::date between ${from} and ${to}
     group by (created_at at time zone 'Europe/Paris')::date`;
  const days = new Map<string, CalendarDay>();
  const day = (date: string) => days.get(date) ?? (days.set(date, { date, planned: {}, published: 0, failed: 0 }), days.get(date)!);
  for (const r of rows) {
    const d = day(r.date);
    if (r.kind === "PLANNED" && r.channel && isChannel(r.channel)) d.planned[r.channel] = (d.planned[r.channel] ?? 0) + r.n;
    if (r.kind === "PUBLISHED") d.published += r.n;
    if (r.kind === "FAILED") d.failed += r.n;
  }
  return { from, to, days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

export interface CalendarEntry {
  /** Publication planifiée ; null pour une annonce publiée à la main ce jour-là. */
  id: string | null;
  offerId: string;
  offerSku: string;
  cardName: string;
  setCode: string;
  condition: string;
  priceCents: number | null;
  photoUrl: string | null;
  channel: ChannelId;
  status: "PENDING" | "DONE" | "FAILED" | "PUBLISHED";
  errorCode: string | null;
}

/** Ce qui est prévu, publié ou en échec un jour donné, carte par carte. */
export async function getPublicationDay(sql: Db, date: string): Promise<{ date: string; entries: CalendarEntry[] }> {
  const offer = (alias: string) => sql`
    o.offer_sku, c.name as card_name, set_code(c.set_id, c.language, st.code_override, st.abbreviation) as set_code,
    o.condition::text as condition, coalesce(o.target_price_cents, o.suggested_price_cents) as price_cents,
    (select p.url from photos p where p.offer_id = o.id and p.kind in ('LISTING', 'SCAN_FRONT')
      order by (p.kind = 'LISTING') desc, p.created_at limit 1) as photo_url
    from offers o
    join card_variants v on v.id = o.variant_id
    join catalog_cards c on c.id = v.catalog_card_id
    left join catalog_sets st on st.id = c.set_id and st.language = c.language
    where o.id = ${sql(alias)}.offer_id`;
  const entries = await sql<CalendarEntry[]>`
    select sp.id, sp.offer_id, sp.channel, sp.status, sp.error_code, x.*
      from scheduled_publications sp, lateral (select ${offer("sp")}) x
     where sp.planned_on = ${date} and sp.status in ('PENDING', 'DONE', 'FAILED')
    union all
    select null, l.offer_id, l.channel, 'PUBLISHED', null, x.*
      from listings l, lateral (select ${offer("l")}) x
     where (l.created_at at time zone 'Europe/Paris')::date = ${date}
       and not exists (select 1 from scheduled_publications sp where sp.listing_id = l.id)
     order by 4, 7`;
  return { date, entries };
}

/**
 * Déplace une publication à un autre jour (elle passe en dernier ce jour-là). Une publication en échec est replanifiée :
 * une nouvelle publication en attente est créée au jour choisi.
 */
export async function reschedulePublication(sql: Db, id: string, plannedOn: string): Promise<void> {
  if (plannedOn < todayInParis()) throw new DomainError("DATE_IN_PAST", "a publication cannot be planned in the past");
  await withTx(sql, async (tx) => {
    const [row] = await tx<{ offerId: string; channel: string; status: string }[]>`
      select offer_id, channel, status from scheduled_publications where id = ${id} for update`;
    if (!row) throw new DomainError("PUBLICATION_NOT_FOUND", "publication not found");
    const [next] = await tx<{ rank: number }[]>`
      select coalesce(max(rank), -1) + 1 as rank from scheduled_publications
       where planned_on = ${plannedOn} and channel = ${row.channel} and status = 'PENDING'`;
    const rank = next!.rank;
    if (row.status === "PENDING") {
      await tx`update scheduled_publications set planned_on = ${plannedOn}, rank = ${rank} where id = ${id}`;
    } else if (row.status === "FAILED") {
      await tx`
        insert into scheduled_publications (offer_id, channel, planned_on, rank)
        values (${row.offerId}, ${row.channel}, ${plannedOn}, ${rank})
        on conflict (offer_id, channel) where status = 'PENDING' do update set planned_on = excluded.planned_on, rank = excluded.rank`;
    } else {
      throw new DomainError("PUBLICATION_DONE", "this publication already happened");
    }
  });
}
