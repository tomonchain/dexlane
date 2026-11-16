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
  for (const s of sets) {
    await sql`
      insert into catalog_sets (id, language, name, card_count_official, card_count_total, logo_url, symbol_url)
      values (${s.id}, ${language}, ${s.name}, ${s.cardCount?.official ?? null}, ${s.cardCount?.total ?? null},
              ${s.logo ?? null}, ${s.symbol ?? null})
      on conflict (id, language) do update set
        name = excluded.name, card_count_official = excluded.card_count_official,
        card_count_total = excluded.card_count_total, logo_url = excluded.logo_url,
        symbol_url = excluded.symbol_url, synced_at = now()`;
  }
  return sets.length;
}

async function upsertSet(sql: Db, set: TcgdexSet, language: string): Promise<void> {
  await sql`
    insert into catalog_sets (id, language, name, serie_id, serie_name, release_date, card_count_official,
                              card_count_total, abbreviation, logo_url, symbol_url)
    values (${set.id}, ${language}, ${set.name}, ${set.serie?.id ?? null}, ${set.serie?.name ?? null},
            ${set.releaseDate ?? null}, ${set.cardCount?.official ?? null}, ${set.cardCount?.total ?? null},
            ${set.abbreviation?.official ?? null}, ${set.logo ?? null}, ${set.symbol ?? null})
    on conflict (id, language) do update set
      name = excluded.name, serie_id = excluded.serie_id, serie_name = excluded.serie_name,
      release_date = excluded.release_date, card_count_official = excluded.card_count_official,
      card_count_total = excluded.card_count_total, abbreviation = excluded.abbreviation,
      logo_url = excluded.logo_url, symbol_url = excluded.symbol_url, synced_at = now()`;
}

/** Enregistre une carte et ses variantes dans une transaction. Exporté pour l'import manuel et les tests. */
export function upsertCard(sql: Db, mapped: MappedCardWithVariants, withPrices = true) {
  return withTx(sql, async (tx) => {
    const c = mapped.card;
    const [card] = await tx<{ id: string }[]>`
      insert into catalog_cards (set_id, local_number, name, language, rarity, category, image_url,
                                 external_ids, source_updated_at, synced_at)
      values (${c.setId}, ${c.localNumber}, ${c.name}, ${c.language}, ${c.rarity}, ${c.category}, ${c.imageUrl},
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
