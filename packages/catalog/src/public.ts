/**
 * Le catalogue tel que le site public le montre : séries, cartes, variantes et cotes, pour une langue.
 *
 * Seules les tables communes (catalogue et cotes du marché) sont lues : jamais le stock, les ventes ni rien qui
 * appartienne à un compte. La connexion du serveur n'étant pas cloisonnée, ces requêtes ne doivent pas joindre une
 * table de compte (`stock_items`, `offers`…) : elles additionneraient les données de tous les vendeurs.
 */
import type { Db } from "@dexlane/db";

/** « Écarlate et Violet — 151 » → « ecarlate-et-violet-151 ». */
export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Segment d'adresse d'une série : son identifiant, puis son nom (« sv03.5-151 », « swsh3-tenebres-embrasees »). */
export const setSlug = (s: { id: string; name: string }) => [s.id.toLowerCase(), slugify(s.name)].filter(Boolean).join("-");
/** Segment d'adresse d'une carte dans sa série : son numéro, puis son nom (« 4-dracaufeu »). */
export const cardSlug = (c: { localNumber: string; name: string }) =>
  [encodeURIComponent(c.localNumber.toLowerCase()), slugify(c.name)].filter(Boolean).join("-");

/**
 * Identifiants possibles au début d'un segment d'adresse : tous ses préfixes coupés à un tiret, du plus long au plus
 * court. Un identifiant peut contenir un tiret (« P-A ») : on garde le plus long qui existe.
 */
export function slugPrefixes(segment: string): string[] {
  let decoded = segment.toLowerCase();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // segment déjà décodé et contenant un « % » : pris tel quel
  }
  const parts = decoded.split("-");
  return parts.map((_, i) => parts.slice(0, parts.length - i).join("-")).filter(Boolean);
}

export interface PublicSet {
  id: string;
  name: string;
  serieId: string | null;
  serieName: string | null;
  /** AAAA-MM-JJ. */
  releaseDate: string | null;
  cardCountOfficial: number | null;
  cardCountTotal: number | null;
  logoUrl: string | null;
  symbolUrl: string | null;
  /** Code d'extension usuel (« EB03 »). */
  code: string;
  /** Cartes de la série dans le catalogue. */
  cards: number;
  /** Cartes qui ont une cote. */
  pricedCards: number;
  /** Dernière mise à jour des cartes ou des cotes. */
  updatedAt: Date | null;
}

export interface PublicPrice {
  /** Cote tendance Cardmarket, en centimes d'euro. */
  trendCents: number;
  observedAt: Date;
  /** La source ne distingue pas cette variante d'une autre : la cote peut être celle de la carte en général. */
  ambiguous: boolean;
}

export interface PublicSetCard {
  localNumber: string;
  name: string;
  rarity: string | null;
  imageUrl: string | null;
  /** La plus basse des cotes des variantes (« à partir de »), null sans cote. */
  fromCents: number | null;
}

export interface PublicVariant {
  finish: string;
  edition: string;
  subtype: string;
  stamp: string;
  price: PublicPrice | null;
  /** Cotes tendance des 180 derniers jours, la plus ancienne d'abord. */
  history: { day: string; cents: number }[];
}

export interface PublicCard {
  localNumber: string;
  name: string;
  rarity: string | null;
  category: string | null;
  imageUrl: string | null;
  set: PublicSet;
  variants: PublicVariant[];
  /** Cartes voisines dans la numérotation de la série, pour la navigation. */
  previous: { localNumber: string; name: string } | null;
  next: { localNumber: string; name: string } | null;
}

/** Tri par numéro imprimé : 2 avant 10, puis les numéros à lettres (« TG01 »). */
const numberOrder = (sql: Db) => sql`nullif(left(regexp_replace(c.local_number, '\\D', '', 'g'), 9), '')::int nulls last, c.local_number`;

function setsQuery(sql: Db, language: string, setId?: string) {
  return sql<PublicSet[]>`
    select s.id, s.name, s.serie_id, s.serie_name, s.release_date::text as release_date,
           s.card_count_official, s.card_count_total, s.logo_url, s.symbol_url,
           set_code(s.id, s.language, s.code_override, s.abbreviation) as code,
           count(c.id)::int as cards,
           count(c.id) filter (where exists (
             select 1 from card_variants v join price_snapshots ps on ps.variant_id = v.id
              where v.catalog_card_id = c.id and ps.quote_type = 'LISTED_TREND' and ps.currency = 'EUR'))::int as priced_cards,
           greatest(max(c.synced_at), s.synced_at) as updated_at
      from catalog_sets s
      join catalog_cards c on c.set_id = s.id and c.language = s.language
     where s.language = ${language} ${setId === undefined ? sql`` : sql`and s.id = ${setId}`}
     group by s.id, s.language
     order by s.release_date desc nulls last, s.name`;
}

/** Séries qui ont au moins une carte dans le catalogue, les plus récentes d'abord. */
export function listPublicSets(sql: Db, language: string): Promise<PublicSet[]> {
  return setsQuery(sql, language);
}

/** La série désignée par un segment d'adresse (« sv03.5-151 »), avec ses cartes dans l'ordre de la numérotation. */
export async function getPublicSet(sql: Db, language: string, segment: string): Promise<{ set: PublicSet; cards: PublicSetCard[] } | null> {
  const [found] = await sql<{ id: string }[]>`
    select id from catalog_sets
     where language = ${language} and lower(id) = any(${slugPrefixes(segment)})
     order by length(id) desc limit 1`;
  if (!found) return null;
  const [set] = await setsQuery(sql, language, found.id);
  if (!set) return null;
  const cards = await sql<PublicSetCard[]>`
    select c.local_number, c.name, c.rarity, c.image_url,
           (select min(p.amount_cents)::int
              from card_variants v
              cross join lateral (
                select ps.amount_cents from price_snapshots ps
                 where ps.variant_id = v.id and ps.quote_type = 'LISTED_TREND' and ps.currency = 'EUR'
                 order by ps.observed_at desc limit 1) p
             where v.catalog_card_id = c.id) as from_cents
      from catalog_cards c
     where c.set_id = ${set.id} and c.language = ${language}
     order by ${numberOrder(sql)}`;
  return { set, cards };
}

/** La carte désignée par sa série et un segment d'adresse (« 4-dracaufeu »), avec ses variantes et leurs cotes. */
export async function getPublicCard(sql: Db, language: string, setSegment: string, cardSegment: string): Promise<PublicCard | null> {
  const found = await getPublicSet(sql, language, setSegment);
  if (!found) return null;
  const prefixes = slugPrefixes(cardSegment);
  const [card] = await sql<(Omit<PublicCard, "set" | "variants" | "previous" | "next"> & { id: string })[]>`
    select c.id, c.local_number, c.name, c.rarity, c.category, c.image_url
      from catalog_cards c
     where c.set_id = ${found.set.id} and c.language = ${language} and lower(c.local_number) = any(${prefixes})
     order by length(c.local_number) desc limit 1`;
  if (!card) return null;

  const variants = await sql<(Omit<PublicVariant, "price"> & { price: (Omit<PublicPrice, "observedAt"> & { observedAt: string }) | null })[]>`
    select v.finish, v.edition, v.subtype, v.stamp,
           (select jsonb_build_object('trendCents', ps.amount_cents, 'observedAt', ps.observed_at, 'ambiguous', ps.variant_ambiguous)
              from price_snapshots ps
             where ps.variant_id = v.id and ps.quote_type = 'LISTED_TREND' and ps.currency = 'EUR'
             order by ps.observed_at desc limit 1) as price,
           coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'cents', d.cents) order by d.day)
                       from (select ps.observed_at::date::text as day, (array_agg(ps.amount_cents order by ps.observed_at desc))[1] as cents
                               from price_snapshots ps
                              where ps.variant_id = v.id and ps.quote_type = 'LISTED_TREND' and ps.currency = 'EUR'
                                and ps.observed_at > now() - interval '180 days'
                              group by 1) d), '[]'::jsonb) as history
      from card_variants v
     where v.catalog_card_id = ${card.id}
     order by v.finish, v.edition, v.subtype, v.stamp`;

  const index = found.cards.findIndex((c) => c.localNumber === card.localNumber);
  const neighbour = (i: number) => (found.cards[i] ? { localNumber: found.cards[i]!.localNumber, name: found.cards[i]!.name } : null);
  const { id: _id, ...rest } = card;
  return {
    ...rest,
    set: found.set,
    variants: variants.map((v) => ({ ...v, price: v.price ? { ...v.price, observedAt: new Date(v.price.observedAt) } : null })),
    previous: index > 0 ? neighbour(index - 1) : null,
    next: index >= 0 ? neighbour(index + 1) : null,
  };
}

/** Pages de cartes à proposer aux moteurs : celles qui ont une cote (les autres n'apportent rien de plus que la série). */
export function listPublicCardsForSitemap(sql: Db, language: string): Promise<{ setId: string; setName: string; localNumber: string; name: string; updatedAt: Date }[]> {
  return sql`
    select c.set_id, s.name as set_name, c.local_number, c.name,
           greatest(c.synced_at, (select max(ps.observed_at) from card_variants v join price_snapshots ps on ps.variant_id = v.id
                                   where v.catalog_card_id = c.id and ps.quote_type = 'LISTED_TREND')) as updated_at
      from catalog_cards c
      join catalog_sets s on s.id = c.set_id and s.language = c.language
     where c.language = ${language}
       and exists (select 1 from card_variants v join price_snapshots ps on ps.variant_id = v.id
                    where v.catalog_card_id = c.id and ps.quote_type = 'LISTED_TREND' and ps.currency = 'EUR')
     order by s.release_date desc nulls last, c.set_id, ${numberOrder(sql)}`;
}
