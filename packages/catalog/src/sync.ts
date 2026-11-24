import { DomainError } from "@dexlane/shared";
import { withTx, type Db } from "@dexlane/db";
import type { TcgdexClient } from "./tcgdex/client";
import { mapTcgdexCard, type MappedCardWithVariants, type MappedVariant } from "./tcgdex/map";
import type { TcgdexSet } from "./tcgdex/types";

export interface SyncStats {
  setId: string;
  language: string;
  cards: number;
  variants: number;
  incompleteVariants: number;
  pricesInserted: number;
  errors: { cardId: string; message: string }[];
}

/**
 * Synchronise une série depuis TCGdex : série, cartes, variantes et cotations.
 * Idempotent : rejouer ne crée ni doublon de variante ni doublon de cotation.
 * Une erreur sur une carte n'interrompt pas la série ; elle est remontée dans `errors`.
 */
export async function syncSet(
  sql: Db,
  client: TcgdexClient,
  language: string,
  setId: string,
  opts: { prices?: boolean } = {},
): Promise<SyncStats> {
  const set = await client.getSet(language, setId);
  await upsertSet(sql, set, language);

  const stats: SyncStats = {
    setId, language, cards: 0, variants: 0, incompleteVariants: 0, pricesInserted: 0, errors: [],
  };

  await Promise.all(
    set.cards.map(async (brief) => {
      try {
        const detail = await client.getCard(language, brief.id);
        if (!detail) throw new Error("card not found in this language");
        const mapped = mapTcgdexCard(detail, language);
        const r = await upsertCard(sql, mapped, opts.prices ?? true);
        stats.cards++;
        stats.variants += mapped.variants.length;
        stats.incompleteVariants += mapped.variants.filter((v) => v.incomplete).length;
        stats.pricesInserted += r.pricesInserted;
      } catch (e) {
        stats.errors.push({ cardId: brief.id, message: (e as Error).message });
      }
    }),
  );
  return stats;
}

/** Synchronise les métadonnées de toutes les séries (sans les cartes). */
export async function syncSetList(sql: Db, client: TcgdexClient, language: string): Promise<number> {
  const sets = await client.listSets(language);
  for (const [position, s] of sets.entries()) {
    await sql`
      insert into catalog_sets (id, language, name, card_count_official, card_count_total, logo_url, symbol_url, list_position)
      values (${s.id}, ${language}, ${s.name}, ${s.cardCount?.official ?? null}, ${s.cardCount?.total ?? null},
              ${s.logo ?? null}, ${s.symbol ?? null}, ${position})
      on conflict (id, language) do update set
        name = excluded.name, list_position = excluded.list_position,
        -- La liste est un résumé : un champ absent ne doit pas effacer ce qu'un import complet de la série a appris.
        card_count_official = coalesce(excluded.card_count_official, catalog_sets.card_count_official),
        card_count_total = coalesce(excluded.card_count_total, catalog_sets.card_count_total),
        logo_url = coalesce(excluded.logo_url, catalog_sets.logo_url),
        symbol_url = coalesce(excluded.symbol_url, catalog_sets.symbol_url), synced_at = now()`;
  }
  // Le rattachement aux blocs est un confort d'affichage : s'il échoue, la liste des séries reste utilisable.
  await syncSeries(sql, client, language).catch(() => 0);
  return sets.length;
}

/** Rattache chaque série à son bloc, pour toutes les séries connues (importées ou non). Renvoie le nombre de blocs lus. */
export async function syncSeries(sql: Db, client: TcgdexClient, language: string): Promise<number> {
  const series = await client.listSeries(language);
  let position = 0;
  for (const brief of series) {
    position++;
    const serie = await client.getSerie(language, brief.id);
    const setIds = (serie?.sets ?? []).map((s) => s.id);
    if (setIds.length === 0) continue;
    await sql`
      update catalog_sets
         set serie_id = ${brief.id}, serie_name = ${serie?.name ?? brief.name}, serie_position = ${position}
       where language = ${language} and id in ${sql(setIds)}`;
  }
  return series.length;
}

async function upsertSet(sql: Db, set: TcgdexSet, language: string): Promise<void> {
  await sql`
    insert into catalog_sets (id, language, name, serie_id, serie_name, release_date, card_count_official,
                              card_count_total, abbreviation, abbreviation_localized, logo_url, symbol_url)
    values (${set.id}, ${language}, ${set.name}, ${set.serie?.id ?? null}, ${set.serie?.name ?? null},
            ${set.releaseDate ?? null}, ${set.cardCount?.official ?? null}, ${set.cardCount?.total ?? null},
            ${set.abbreviation?.official ?? null}, ${set.abbreviation?.localized ?? null},
            ${set.logo ?? null}, ${set.symbol ?? null})
    on conflict (id, language) do update set
      name = excluded.name, serie_id = excluded.serie_id, serie_name = excluded.serie_name,
      release_date = excluded.release_date, card_count_official = excluded.card_count_official,
      card_count_total = excluded.card_count_total, abbreviation = excluded.abbreviation,
      abbreviation_localized = excluded.abbreviation_localized,
      logo_url = excluded.logo_url, symbol_url = excluded.symbol_url, synced_at = now()`;
}

/** Adresse des images anglaises de TCGdex, complétée par série, numéro de série et numéro de carte. */
const ENGLISH_ASSETS = "https://assets.tcgdex.net/en/";

/** Enregistre une carte et ses variantes dans une transaction. Exporté pour l'import manuel et les tests. */
export function upsertCard(sql: Db, mapped: MappedCardWithVariants, withPrices = true) {
  return withTx(sql, async (tx) => {
    const c = mapped.card;
    const [card] = await tx<{ id: string }[]>`
      insert into catalog_cards (set_id, local_number, name, language, rarity, category, image_url,
                                 external_ids, source_updated_at, synced_at)
      -- Sans image dans cette langue, l'image anglaise de la même carte (même série, même numéro) ; l'écran se rabat
      -- sur un emplacement vide si elle manque aussi.
      values (${c.setId}, ${c.localNumber}, ${c.name}, ${c.language}, ${c.rarity}, ${c.category},
              coalesce(${c.imageUrl}, (select ${ENGLISH_ASSETS} || st.serie_id || '/' || st.id || '/' || ${c.localNumber}
                                         from catalog_sets st where st.id = ${c.setId} and st.language = ${c.language} and st.serie_id is not null)),
              ${tx.json(c.externalIds)}, ${c.sourceUpdatedAt}, now())
      on conflict (set_id, local_number, language) do update set
        name = excluded.name, rarity = excluded.rarity, category = excluded.category,
        image_url = coalesce(excluded.image_url, catalog_cards.image_url),
        external_ids = catalog_cards.external_ids || excluded.external_ids,
        source_updated_at = excluded.source_updated_at, synced_at = now()
      returning id`;

    let pricesInserted = 0;
    for (const v of mapped.variants) {
      const variantId = await upsertVariant(tx, card!.id, v);
      if (!withPrices) continue;
      for (const p of v.prices) {
        const inserted = await tx`
          insert into price_snapshots (variant_id, condition, source, quote_type, currency, amount_cents,
                                       source_scope, observed_at, variant_ambiguous)
          values (${variantId}, null, ${p.source}, ${p.quoteType}, ${p.currency}, ${p.amountCents},
                  ${p.sourceScope}, ${p.observedAt}, ${p.variantAmbiguous})
          on conflict (variant_id, source, quote_type, observed_at, condition) do nothing
          returning id`;
        pricesInserted += inserted.length;
      }
    }
    return { catalogCardId: card!.id, pricesInserted };
  });
}

/**
 * Rattache une variante source à une ligne existante, dans l'ordre :
 * 1. même identifiant TCGdex ; 2. même clé naturelle (complète l'identifiant s'il manquait) ; 3. sinon insertion.
 * Les variantes disparues de la source ne sont jamais supprimées (du stock peut les référencer).
 */
async function upsertVariant(tx: Db, catalogCardId: string, v: MappedVariant): Promise<string> {
  const fields = tx`
    finish = ${v.finish}, edition = ${v.edition}, promo = ${v.promo}, stamp = ${v.stamp},
    subtype = ${v.subtype}, size = ${v.size},
    cardmarket_product_id = ${v.cardmarketProductId}, tcgplayer_product_id = ${v.tcgplayerProductId},
    incomplete = ${v.incomplete}, attributes = ${tx.json(v.attributes as never)}`;

  if (v.tcgdexVariantId) {
    const [byId] = await tx<{ id: string }[]>`
      update card_variants set ${fields}
       where catalog_card_id = ${catalogCardId} and tcgdex_variant_id = ${v.tcgdexVariantId}
      returning id`;
    if (byId) return byId.id;
  }

  const [byKey] = await tx<{ id: string }[]>`
    update card_variants
       set ${fields}, tcgdex_variant_id = coalesce(${v.tcgdexVariantId}, tcgdex_variant_id)
     where catalog_card_id = ${catalogCardId}
       and finish = ${v.finish} and edition = ${v.edition} and promo = ${v.promo}
       and stamp = ${v.stamp} and subtype = ${v.subtype} and size = ${v.size}
    returning id`;
  if (byKey) return byKey.id;

  const [inserted] = await tx<{ id: string }[]>`
    insert into card_variants (catalog_card_id, finish, edition, promo, stamp, subtype, size, tcgdex_variant_id,
                               cardmarket_product_id, tcgplayer_product_id, incomplete, attributes)
    values (${catalogCardId}, ${v.finish}, ${v.edition}, ${v.promo}, ${v.stamp}, ${v.subtype}, ${v.size},
            ${v.tcgdexVariantId}, ${v.cardmarketProductId}, ${v.tcgplayerProductId}, ${v.incomplete},
            ${tx.json(v.attributes as never)})
    returning id`;
  return inserted!.id;
}

export interface CatalogSetSummary {
  id: string;
  name: string;
  /** Bloc auquel la série appartient ; null tant que la liste des blocs n'a pas été chargée. */
  serieId: string | null;
  serieName: string | null;
  seriePosition: number | null;
  /** AAAA-MM-JJ ; connu seulement une fois la série synchronisée. */
  releaseDate: string | null;
  cardCountOfficial: number | null;
  cardCountTotal: number | null;
  logoUrl: string | null;
  /** Symbole de la série (le petit pictogramme imprimé sur les cartes). */
  symbolUrl: string | null;
  /** Code d'extension usuel (« EB03 », « ME02.5 »). */
  code: string;
  /** Cartes de cette série présentes dans le catalogue local (0 = série non synchronisée). */
  cardsSynced: number;
  cardsSyncedAt: Date | null;
}

/** Séries connues pour une langue, avec leur état de synchronisation ; les séries synchronisées d'abord. */
export function listSets(sql: Db, language: string): Promise<CatalogSetSummary[]> {
  return sql<CatalogSetSummary[]>`
    select s.id, s.name, s.serie_id, s.serie_name, s.serie_position, s.release_date::text as release_date,
           s.card_count_official, s.card_count_total, s.logo_url, s.symbol_url,
           set_code(s.id, s.language, s.code_override, s.abbreviation) as code, count(c.id)::int as cards_synced,
           max(c.synced_at) as cards_synced_at
      from catalog_sets s
      left join catalog_cards c on c.set_id = s.id and c.language = s.language
     where s.language = ${language}
     group by s.id, s.language
     order by (count(c.id) > 0) desc, s.release_date desc nulls last, s.name`;
}

export interface CatalogSetCard {
  id: string;
  localNumber: string;
  name: string;
  rarity: string | null;
  category: string | null;
  imageUrl: string | null;
  /** Cartes de cette impression actuellement en stock (toutes variantes et tous états). */
  owned: number;
  variants: {
    id: string;
    finish: string;
    edition: string;
    subtype: string;
    stamp: string;
    incomplete: boolean;
    /** Dernier prix tendance connu (Cardmarket via TCGdex), toutes langues et tous états confondus. */
    trendCents: number | null;
    priceAt: string | null;
    priceAmbiguous: boolean | null;
  }[];
}

export interface CatalogSetDetail {
  set: CatalogSetSummary & {
    abbreviation: string | null; abbreviationLocalized: string | null; syncedAt: Date;
    /** Code d'extension usuel (« EB03 », « ME02.5 »), déduit ou saisi ; `codeOverride` : celui saisi à la main. */
    code: string; codeOverride: string | null;
  };
  cards: CatalogSetCard[];
}

/** Contenu importé d'une série : cartes dans l'ordre de la numérotation, variantes, dernier prix tendance, stock détenu. */
export async function getSetDetail(sql: Db, language: string, setId: string): Promise<CatalogSetDetail | null> {
  const [set] = await sql<CatalogSetDetail["set"][]>`
    select s.id, s.name, s.serie_id, s.serie_name, s.serie_position, s.release_date::text as release_date,
           s.card_count_official, s.card_count_total, s.logo_url, s.symbol_url, s.abbreviation, s.abbreviation_localized, s.synced_at,
           set_code(s.id, s.language, s.code_override, s.abbreviation) as code, s.code_override,
           (select count(*)::int from catalog_cards c where c.set_id = s.id and c.language = s.language) as cards_synced,
           (select max(c.synced_at) from catalog_cards c where c.set_id = s.id and c.language = s.language) as cards_synced_at
      from catalog_sets s
     where s.id = ${setId} and s.language = ${language}`;
  if (!set) return null;

  const cards = await sql<CatalogSetCard[]>`
    select c.id, c.local_number, c.name, c.rarity, c.category, c.image_url,
           coalesce((select sum(si.on_hand)::int
                       from card_variants ov
                       join offers o on o.variant_id = ov.id
                       join stock_items si on si.offer_id = o.id and si.lifecycle <> 'ARCHIVED'
                      where ov.catalog_card_id = c.id), 0) as owned,
           coalesce(jsonb_agg(jsonb_build_object(
             'id', v.id, 'finish', v.finish, 'edition', v.edition, 'subtype', v.subtype, 'stamp', v.stamp,
             'incomplete', v.incomplete, 'trendCents', p.amount_cents, 'priceAt', p.observed_at,
             'priceAmbiguous', p.variant_ambiguous) order by v.finish, v.edition, v.subtype)
             filter (where v.id is not null), '[]'::jsonb) as variants
      from catalog_cards c
      left join card_variants v on v.catalog_card_id = c.id
      left join lateral (
        select ps.amount_cents, ps.observed_at, ps.variant_ambiguous
          from price_snapshots ps
         where ps.variant_id = v.id and ps.quote_type = 'LISTED_TREND'
         order by ps.observed_at desc limit 1) p on true
     where c.set_id = ${setId} and c.language = ${language}
     group by c.id
     order by nullif(left(regexp_replace(c.local_number, '\\D', '', 'g'), 9), '')::int nulls last, c.local_number`;
  return { set, cards };
}

/**
 * Rafraîchit les cotations des cartes suivies de près : celles en stock et celles de la liste d'achats d'abord, puis les
 * « grosses » cartes des séries importées (cote d'au moins `bigFromCents`), les plus anciennement relevées d'abord.
 * Bien plus léger qu'une resynchronisation de séries entières : c'est ce que lance la tâche quotidienne. S'arrête de
 * lancer de nouvelles lectures à `deadlineMs` pour tenir dans le temps d'exécution ; le reste passe au relevé suivant.
 */
export async function refreshTrackedPrices(
  sql: Db,
  client: TcgdexClient,
  opts: { limit?: number; concurrency?: number; bigFromCents?: number | null; deadlineMs?: number } = {},
): Promise<{ cards: number; pricesInserted: number; errors: number; remaining: number }> {
  const limit = opts.limit ?? 600;
  const big = opts.bigFromCents === undefined ? 1000 : opts.bigFromCents;
  const deadline = Date.now() + (opts.deadlineMs ?? 200_000);
  const owned = sql`exists (
    select 1 from card_variants v join offers o on o.variant_id = v.id join stock_items s on s.offer_id = o.id
     where v.catalog_card_id = c.id and s.on_hand > 0 and s.lifecycle <> 'ARCHIVED')`;
  const watched = sql`exists (select 1 from card_variants v join watched_cards w on w.variant_id = v.id where v.catalog_card_id = c.id)`;
  const valuable = big === null ? sql`false` : sql`exists (
    select 1 from card_variants v join price_snapshots ps on ps.variant_id = v.id
     where v.catalog_card_id = c.id and ps.quote_type in ('SOLD_AVG_30D', 'LISTED_TREND') and ps.currency = 'EUR'
       and ps.amount_cents >= ${big} and ps.observed_at >= now() - interval '60 days')`;
  const tracked = await sql<{ language: string; tcgdexId: string; total: number }[]>`
    select c.language, c.external_ids->>'tcgdex' as tcgdex_id, count(*) over ()::int as total
      from catalog_cards c
     where c.external_ids ? 'tcgdex' and (${owned} or ${watched} or ${valuable})
     order by case when ${owned} or ${watched} then 0 else 1 end, c.synced_at nulls first, c.id
     limit ${limit}`;
  const stats = { cards: 0, pricesInserted: 0, errors: 0, remaining: Math.max((tracked[0]?.total ?? 0) - tracked.length, 0) };
  const queue = [...tracked];
  const worker = async () => {
    for (let card = queue.shift(); card; card = queue.shift()) {
      if (Date.now() > deadline) {
        stats.remaining += 1 + queue.length;
        queue.length = 0;
        break;
      }
      try {
        const detail = await client.getCard(card.language, card.tcgdexId);
        if (!detail) throw new Error("card not found");
        stats.pricesInserted += (await upsertCard(sql, mapTcgdexCard(detail, card.language))).pricesInserted;
        stats.cards++;
      } catch {
        stats.errors++;
      }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 8 }, worker));
  return stats;
}

/** Code d'extension saisi à la main pour une série (null : revenir au code déduit). */
export async function setSetCode(sql: Db, language: string, setId: string, code: string | null): Promise<{ code: string; codeOverride: string | null }> {
  const value = code?.trim().toUpperCase() || null;
  if (value !== null && (value.length > 20 || !/^[A-Z0-9][A-Z0-9 .\-]*$/.test(value))) {
    throw new DomainError("INVALID_SET_CODE", "a set code is 1 to 20 letters, digits, spaces, dots or dashes");
  }
  const [row] = await sql<{ code: string; codeOverride: string | null }[]>`
    update catalog_sets set code_override = ${value} where id = ${setId} and language = ${language}
    returning set_code(id, language, code_override, abbreviation) as code, code_override`;
  if (!row) throw new DomainError("SET_NOT_FOUND", "this set is not in the catalog");
  return row;
}

// ───────────────────────── Import du catalogue complet ─────────────────────────

export interface CatalogImportStatus {
  language: string;
  /** Séries connues dans cette langue. */
  total: number;
  /** Séries dont les cartes sont importées. */
  imported: number;
  /** Séries encore à importer (hors séries tentées sans succès cette semaine). */
  remaining: number;
  /** Séries tentées sans succès (aucune carte dans cette langue, source indisponible), retentées dans une semaine. */
  skipped: number;
  cards: number;
  /** La liste complète des séries a été lue (sinon, des séries manquent au décompte). */
  listComplete: boolean;
}

export async function catalogImportStatus(sql: Db, language: string): Promise<CatalogImportStatus> {
  const [row] = await sql<Omit<CatalogImportStatus, "language">[]>`
    with sets as (
      select s.id, s.import_attempted_at,
             exists (select 1 from catalog_cards c where c.set_id = s.id and c.language = s.language) as imported
        from catalog_sets s where s.language = ${language})
    select count(*)::int as total,
           count(*) filter (where imported)::int as imported,
           count(*) filter (where not imported and (import_attempted_at is null or import_attempted_at < now() - interval '7 days'))::int as remaining,
           count(*) filter (where not imported and import_attempted_at >= now() - interval '7 days')::int as skipped,
           (select count(*)::int from catalog_cards where language = ${language}) as cards,
           count(*) > 0 and bool_and(list_position is not null) as list_complete
      from (select sets.*, s2.list_position from sets join catalog_sets s2 on s2.id = sets.id and s2.language = ${language}) sets`;
  return { language, ...row! };
}

/**
 * Importe les séries pas encore importées d'une langue, les plus récentes d'abord, tant que le budget de temps le
 * permet (une série commencée va à son terme). La liste des séries est rafraîchie si elle est vide ou vieille d'une
 * semaine. Pensé pour la tâche de nuit et pour le bouton « Tout importer », appelé de lot en lot.
 */
export async function importNextSets(
  sql: Db,
  client: TcgdexClient,
  language: string,
  opts: { budgetMs: number; now?: () => number },
): Promise<{ imported: { setId: string; name: string; cards: number; errorCount: number }[]; status: CatalogImportStatus }> {
  const now = opts.now ?? Date.now;
  const start = now();
  // La liste des séries vient de TCGdex : rafraîchie si elle n'a jamais été lue en entier (une série importée seule n'a
  // pas de rang dans la liste) ou si elle date de plus d'une semaine.
  const [list] = await sql<{ complete: boolean; fresh: boolean }[]>`
    select count(*) > 0 and bool_and(list_position is not null) as complete,
           coalesce(max(synced_at) filter (where list_position is not null) > now() - interval '7 days', false) as fresh
      from catalog_sets where language = ${language}`;
  if (!list!.complete || !list!.fresh) await syncSetList(sql, client, language);

  const imported: { setId: string; name: string; cards: number; errorCount: number }[] = [];
  // Une série prend jusqu'à une minute : on n'en commence pas une nouvelle dans la dernière part du budget.
  const reserve = Math.min(60_000, opts.budgetMs / 3);
  while (imported.length === 0 || now() - start < opts.budgetMs - reserve) {
    const [next] = await sql<{ id: string; name: string }[]>`
      update catalog_sets set import_attempted_at = now()
       where (id, language) = (
         select s.id, s.language from catalog_sets s
          where s.language = ${language}
            and not exists (select 1 from catalog_cards c where c.set_id = s.id and c.language = s.language)
            and (s.import_attempted_at is null or s.import_attempted_at < now() - interval '7 days')
          order by s.list_position desc nulls last, s.id desc
          limit 1)
       returning id, name`;
    if (!next) break;
    try {
      const stats = await syncSet(sql, client, language, next.id);
      imported.push({ setId: next.id, name: next.name, cards: stats.cards, errorCount: stats.errors.length });
    } catch {
      imported.push({ setId: next.id, name: next.name, cards: 0, errorCount: 1 });
    }
  }
  return { imported, status: await catalogImportStatus(sql, language) };
}
