import type { Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";
import { latestQuotes } from "./offers";
import { latestReading, salesEstimate, type Quote, type SalesEstimate } from "./rules";
import { getAlertSettings } from "./stats";

/** Ce qu'il faut pour reconnaître une carte du catalogue dans une liste. */
export interface WatchCard {
  catalogCardId: string;
  name: string;
  setId: string;
  setName: string | null;
  localNumber: string;
  language: string;
  rarity: string | null;
  imageUrl: string | null;
  finish: string;
  edition: string;
  subtype: string;
  stamp: string;
}

/** Les prix d'une carte sur chaque plateforme, au dernier relevé. */
export interface PlatformPrices {
  cardmarket: {
    /** Estimation d'après les ventes réussies ; null sans vente récente. */
    sales: SalesEstimate | null;
    /** Annonce la moins chère (tous états et toutes langues confondus). */
    lowCents: number | null;
    trendCents: number | null;
    observedAt: Date | null;
    /** La source ne distingue pas cette variante d'une autre : prix à prendre avec prudence. */
    ambiguous: boolean;
  };
  /** Prix du marché TCGplayer (États-Unis), en cents de dollar. */
  tcgplayer: { marketCents: number; observedAt: Date } | null;
}

export type WatchAlert = "TARGET_REACHED" | "PRICE_MOVE";

export interface WatchedCard extends PlatformPrices {
  id: string;
  variantId: string;
  targetCents: number | null;
  note: string | null;
  createdAt: Date;
  card: WatchCard;
  /** Exemplaires déjà en stock. */
  owned: number;
  /** Variation sur la fenêtre des alertes : ventes sur 7 jours, à défaut tendance des annonces. */
  change: { fromCents: number; toCents: number; percent: number; windowDays: number; basis: "SOLD_AVG_7D" | "LISTED_TREND" } | null;
  alerts: WatchAlert[];
}

const cardColumns = (sql: Db) => sql`
  jsonb_build_object('catalogCardId', c.id, 'name', c.name, 'setId', c.set_id, 'setName', st.name, 'localNumber', c.local_number,
    'language', c.language, 'rarity', c.rarity, 'imageUrl', c.image_url, 'finish', v.finish, 'edition', v.edition, 'subtype', v.subtype, 'stamp', v.stamp) as card,
  coalesce((select sum(s.on_hand)::int from offers o join stock_items s on s.offer_id = o.id
             where o.variant_id = v.id and s.lifecycle <> 'ARCHIVED'), 0) as owned`;

/** Dernier prix TCGplayer de chaque variante. */
async function tcgplayerPrices(sql: Db, variantIds: string[]): Promise<Map<string, { marketCents: number; observedAt: Date }>> {
  if (variantIds.length === 0) return new Map();
  const rows = await sql<{ variantId: string; amountCents: number; observedAt: Date }[]>`
    select distinct on (variant_id) variant_id, amount_cents, observed_at from price_snapshots
     where variant_id in ${sql(variantIds)} and quote_type = 'MARKET' and condition is null
     order by variant_id, observed_at desc`;
  return new Map(rows.map((r) => [r.variantId, { marketCents: r.amountCents, observedAt: r.observedAt }]));
}

function cardmarketOf(quotes: Quote[]): PlatformPrices["cardmarket"] {
  const reading = quotes.length ? latestReading(quotes) : [];
  const amount = (type: Quote["quoteType"]) => reading.find((q) => q.quoteType === type)?.amountCents ?? null;
  const newest = reading.length ? new Date(Math.max(...reading.map((q) => q.observedAt.getTime()))) : null;
  return {
    sales: salesEstimate(reading),
    lowCents: amount("LISTED_LOW"),
    trendCents: amount("LISTED_TREND"),
    observedAt: newest,
    ambiguous: reading.some((q) => q.variantAmbiguous),
  };
}

/** Prix de chaque variante sur chaque plateforme, au dernier relevé. */
export async function platformPrices(sql: Db, variantIds: string[]): Promise<Map<string, PlatformPrices>> {
  const [quotes, tcgplayer] = await Promise.all([latestQuotes(sql, variantIds), tcgplayerPrices(sql, variantIds)]);
  return new Map(variantIds.map((id) => [id, { cardmarket: cardmarketOf(quotes.get(id) ?? []), tcgplayer: tcgplayer.get(id) ?? null }]));
}

// ───────────────────────── Cartes suivies ─────────────────────────

export async function listWatched(sql: Db): Promise<{ items: WatchedCard[]; alerts: number }> {
  const rows = await sql<(Omit<WatchedCard, keyof PlatformPrices | "change" | "alerts">)[]>`
    select w.id, w.variant_id, w.target_cents, w.note, w.created_at, ${cardColumns(sql)}
      from watched_cards w
      join card_variants v on v.id = w.variant_id
      join catalog_cards c on c.id = v.catalog_card_id
      left join catalog_sets st on st.id = c.set_id and st.language = c.language
     order by w.created_at desc, w.id`;
  const ids = rows.map((r) => r.variantId);
  const settings = await getAlertSettings(sql);
  const [quotes, tcgplayer, before] = await Promise.all([
    latestQuotes(sql, ids),
    tcgplayerPrices(sql, ids),
    // Valeur au début de la fenêtre d'alerte, pour les deux bases possibles.
    ids.length === 0 ? [] : sql<{ variantId: string; quoteType: "SOLD_AVG_7D" | "LISTED_TREND"; amountCents: number }[]>`
      select distinct on (variant_id, quote_type) variant_id, quote_type, amount_cents from price_snapshots
       where variant_id in ${sql(ids)} and quote_type in ('SOLD_AVG_7D', 'LISTED_TREND') and condition is null and currency = 'EUR'
         and observed_at <= now() - make_interval(days => ${settings.windowDays})
       order by variant_id, quote_type, observed_at desc`,
  ]);

  const items = rows.map((row): WatchedCard => {
    const cardmarket = cardmarketOf(quotes.get(row.variantId) ?? []);
    const basis = cardmarket.sales?.sales.some((s) => s.quoteType === "SOLD_AVG_7D") ? "SOLD_AVG_7D" : "LISTED_TREND";
    const now = basis === "SOLD_AVG_7D" ? cardmarket.sales!.sales.find((s) => s.quoteType === "SOLD_AVG_7D")!.amountCents : cardmarket.trendCents;
    const then = before.find((b) => b.variantId === row.variantId && b.quoteType === basis)?.amountCents ?? null;
    const change = now !== null && then !== null && then > 0
      ? { fromCents: then, toCents: now, percent: Math.round(((now - then) / then) * 1000) / 10, windowDays: settings.windowDays, basis: basis as "SOLD_AVG_7D" | "LISTED_TREND" }
      : null;
    const alerts: WatchAlert[] = [];
    if (row.targetCents !== null && cardmarket.lowCents !== null && cardmarket.lowCents <= row.targetCents) alerts.push("TARGET_REACHED");
    if (change && Math.abs(change.percent) >= settings.percent && Math.abs(change.toCents - change.fromCents) >= settings.minChangeCents) alerts.push("PRICE_MOVE");
    return { ...row, cardmarket, tcgplayer: tcgplayer.get(row.variantId) ?? null, change, alerts };
  });
  return { items, alerts: items.filter((i) => i.alerts.length > 0).length };
}

const validTarget = (cents: number | null | undefined) => {
  if (cents !== null && cents !== undefined && (!Number.isInteger(cents) || cents <= 0)) {
    throw new DomainError("INVALID_PRICE", "the target price must be a positive amount in cents");
  }
};

/** Suit une carte (une variante précise) ; la suivre à nouveau met seulement à jour le prix cible. */
export async function watchCard(sql: Db, input: { variantId: string; targetCents?: number | null; note?: string | null }): Promise<{ id: string }> {
  validTarget(input.targetCents);
  const [variant] = await sql`select 1 from card_variants where id = ${input.variantId}`;
  if (!variant) throw new DomainError("VARIANT_NOT_FOUND", `card variant ${input.variantId} does not exist`);
  const [row] = await sql<{ id: string }[]>`
    insert into watched_cards (variant_id, target_cents, note) values (${input.variantId}, ${input.targetCents ?? null}, ${input.note?.trim() || null})
    on conflict (account_id, variant_id) do update set target_cents = coalesce(excluded.target_cents, watched_cards.target_cents),
                                           note = coalesce(excluded.note, watched_cards.note)
    returning id`;
  return row!;
}

export async function updateWatched(sql: Db, id: string, change: { targetCents?: number | null; note?: string | null }): Promise<void> {
  validTarget(change.targetCents);
  const [row] = await sql`
    update watched_cards set
      target_cents = case when ${change.targetCents === undefined} then target_cents else ${change.targetCents ?? null}::int end,
      note = case when ${change.note === undefined} then note else ${change.note?.trim() || null} end
     where id = ${id} returning id`;
  if (!row) throw new DomainError("WATCHED_CARD_NOT_FOUND", "this card is not watched");
}

export async function unwatchCard(sql: Db, id: string): Promise<void> {
  const [row] = await sql`delete from watched_cards where id = ${id} returning id`;
  if (!row) throw new DomainError("WATCHED_CARD_NOT_FOUND", "this card is not watched");
}

// ───────────────────────── Bonnes affaires ─────────────────────────

export interface Deal extends PlatformPrices {
  variantId: string;
  card: WatchCard;
  owned: number;
  /** Carte déjà suivie : l'identifiant de son suivi. */
  watchedId: string | null;
  /** Prix des ventes réussies, l'annonce la moins chère, et l'écart entre les deux. */
  estimateCents: number;
  lowCents: number;
  discountPercent: number;
  gainCents: number;
}

export interface DealQuery {
  /** Valeur minimale d'après les ventes : on ne cherche pas d'affaires sur les cartes à quelques centimes. */
  minCents?: number;
  /** Écart minimal entre l'annonce la moins chère et le prix des ventes, en pourcentage. */
  minDiscount?: number;
  /** Seuls les relevés de moins de `freshDays` jours comptent : une affaire d'il y a une semaine est sans doute partie. */
  freshDays?: number;
  limit?: number;
}

/**
 * Cartes dont l'annonce la moins chère de Cardmarket est nettement sous le prix auquel la carte se vend.
 * Ne retient que des ventes régulières (semaine et mois renseignés) et des cotes propres à la variante.
 * La source ne distingue ni l'état ni la langue de l'annonce : c'est une piste à vérifier, pas un achat sûr.
 */
export async function findDeals(sql: Db, query: DealQuery = {}): Promise<{ deals: Deal[]; examined: number; freshDays: number; minCents: number; minDiscount: number }> {
  const minCents = query.minCents ?? 1000;
  const minDiscount = query.minDiscount ?? 25;
  const freshDays = query.freshDays ?? 3;
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  // Premier tri en base, large : cartes relevées récemment, ventes du mois assez hautes, annonce nettement plus basse.
  const candidates = await sql<{ variantId: string; examined: number }[]>`
    with recent as (
      select distinct on (variant_id, quote_type) variant_id, quote_type, amount_cents
        from price_snapshots
       where observed_at >= now() - make_interval(days => ${freshDays}) and condition is null and currency = 'EUR'
         and quote_type in ('SOLD_AVG_30D', 'LISTED_LOW')
       order by variant_id, quote_type, observed_at desc),
    valued as (
      select variant_id,
             max(amount_cents) filter (where quote_type = 'SOLD_AVG_30D') as month,
             max(amount_cents) filter (where quote_type = 'LISTED_LOW') as low
        from recent group by variant_id
      having max(amount_cents) filter (where quote_type = 'SOLD_AVG_30D') >= ${Math.floor(minCents * 0.8)})
    select variant_id, (select count(*) from valued)::int as examined from valued
     where low is not null and low * 100 <= month * ${100 - Math.floor(minDiscount / 2)}
     order by month - low desc
     limit 500`;
  const examined = candidates[0]?.examined ?? (await sql<{ n: number }[]>`
    select count(distinct variant_id)::int as n from price_snapshots
     where observed_at >= now() - make_interval(days => ${freshDays}) and quote_type = 'SOLD_AVG_30D' and currency = 'EUR'
       and amount_cents >= ${Math.floor(minCents * 0.8)}`)[0]!.n;
  const ids = candidates.map((c) => c.variantId);
  if (ids.length === 0) return { deals: [], examined, freshDays, minCents, minDiscount };

  const [quotes, tcgplayer, info] = await Promise.all([
    latestQuotes(sql, ids),
    tcgplayerPrices(sql, ids),
    sql<{ variantId: string; card: WatchCard; owned: number; watchedId: string | null }[]>`
      select v.id as variant_id, ${cardColumns(sql)}, (select w.id from watched_cards w where w.variant_id = v.id) as watched_id
        from card_variants v
        join catalog_cards c on c.id = v.catalog_card_id
        left join catalog_sets st on st.id = c.set_id and st.language = c.language
       where v.id in ${sql(ids)}`,
  ]);
  const deals = info.flatMap((row): Deal[] => {
    const cardmarket = cardmarketOf(quotes.get(row.variantId) ?? []);
    const sales = cardmarket.sales;
    // Des ventes régulières et une cote propre à la variante : sinon l'écart ne veut rien dire.
    if (!sales || sales.confidence === "LOW" || cardmarket.ambiguous || cardmarket.lowCents === null) return [];
    if (sales.cents < minCents) return [];
    const discount = Math.round(((sales.cents - cardmarket.lowCents) / sales.cents) * 100);
    if (discount < minDiscount) return [];
    return [{
      ...row, cardmarket, tcgplayer: tcgplayer.get(row.variantId) ?? null,
      estimateCents: sales.cents, lowCents: cardmarket.lowCents, discountPercent: discount, gainCents: sales.cents - cardmarket.lowCents,
    }];
  });
  deals.sort((a, b) => b.gainCents - a.gainCents || b.discountPercent - a.discountPercent);
  return { deals: deals.slice(0, limit), examined, freshDays, minCents, minDiscount };
}

// ───────────────────────── Cartes demandées du moment ─────────────────────────

export interface TopCard {
  variantId: string;
  card: WatchCard;
  owned: number;
  watchedId: string | null;
  /** Prix des ventes réussies et sa fiabilité. */
  sales: SalesEstimate;
  /** Ventes de la semaine comparées à celles du mois, en pourcentage : la hausse qui classe la carte. */
  trendPercent: number;
}

/**
 * Les cartes les plus demandées du moment, d'après les ventes : vendues la veille sur Cardmarket, et dont le prix de vente
 * de la semaine dépasse le plus celui du mois — la demande va plus vite que l'offre. La source ne publie pas le nombre de
 * recherches : c'est l'indice qui s'en approche le plus avec ce qu'elle donne. Parmi les cartes d'au moins `minCents`,
 * relevées depuis moins de `freshDays` jours, avec une cote propre à la variante.
 */
export async function trendingCards(sql: Db, opts: { limit?: number; freshDays?: number; minCents?: number } = {}): Promise<TopCard[]> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);
  const freshDays = opts.freshDays ?? 7;
  const minCents = opts.minCents ?? 1000;
  // Premier tri en base : semaine au-dessus du mois, vente la veille, cote propre ; la hausse la plus forte d'abord.
  const candidates = await sql<{ variantId: string }[]>`
    with latest as (
      select distinct on (variant_id, quote_type) variant_id, quote_type, amount_cents, variant_ambiguous
        from price_snapshots
       where quote_type in ('SOLD_AVG_7D', 'SOLD_AVG_30D', 'SOLD_AVG_1D') and currency = 'EUR' and condition is null
         and observed_at >= now() - make_interval(days => ${freshDays})
       order by variant_id, quote_type, observed_at desc),
    rated as (
      select variant_id,
             max(amount_cents) filter (where quote_type = 'SOLD_AVG_7D') as week,
             max(amount_cents) filter (where quote_type = 'SOLD_AVG_30D') as month,
             bool_or(quote_type = 'SOLD_AVG_1D') as sold_yesterday,
             bool_or(variant_ambiguous) as ambiguous
        from latest group by variant_id)
    select variant_id from rated
     where month >= ${Math.floor(minCents * 0.8)} and week > month and sold_yesterday and not ambiguous
     order by week::float / month desc, month desc
     limit ${limit * 4}`;
  const ids = candidates.map((c) => c.variantId);
  if (ids.length === 0) return [];
  const [quotes, info] = await Promise.all([
    latestQuotes(sql, ids),
    sql<{ variantId: string; card: WatchCard; owned: number; watchedId: string | null }[]>`
      select v.id as variant_id, ${cardColumns(sql)}, (select w.id from watched_cards w where w.variant_id = v.id) as watched_id
        from card_variants v
        join catalog_cards c on c.id = v.catalog_card_id
        left join catalog_sets st on st.id = c.set_id and st.language = c.language
       where v.id in ${sql(ids)}`,
  ]);
  return info
    .flatMap((row): TopCard[] => {
      // Tout doit venir du même relevé : semaine, mois et vente de la veille.
      const cardmarket = cardmarketOf(quotes.get(row.variantId) ?? []);
      const sales = cardmarket.sales;
      if (!sales || cardmarket.ambiguous || sales.cents < minCents) return [];
      const amount = (type: string) => sales.sales.find((s) => s.quoteType === type)?.amountCents;
      const [week, month] = [amount("SOLD_AVG_7D"), amount("SOLD_AVG_30D")];
      if (!week || !month || week <= month || amount("SOLD_AVG_1D") === undefined) return [];
      return [{ ...row, sales, trendPercent: Math.round(((week - month) / month) * 100) }];
    })
    .sort((a, b) => b.trendPercent - a.trendPercent || b.sales.cents - a.sales.cents)
    .slice(0, limit);
}
