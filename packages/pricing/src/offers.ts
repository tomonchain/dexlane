import { withTx, type Db } from "@dexlane/db";
import type { CardCondition } from "@dexlane/inventory";
import { DomainError } from "@dexlane/shared";
import {
  BLOCKING_REASONS, DEFAULT_SETTINGS, QUOTE_TYPES, computePricing, floorFor, validateSettings,
  type OfferCategory, type PriceReason, type PriceSource, type PricingResult, type PricingSettings, type Quote, type QuoteType,
} from "./rules";

// ───────────────────────── Règles ─────────────────────────

export async function getPricingSettings(sql: Db): Promise<PricingSettings> {
  const [row] = await sql<{ settings: Partial<PricingSettings> }[]>`select settings from pricing_settings`;
  // Fusion avec les valeurs par défaut : une règle ajoutée plus tard n'invalide pas des réglages déjà enregistrés.
  return {
    ...DEFAULT_SETTINGS,
    ...row?.settings,
    conditionPercent: { ...DEFAULT_SETTINGS.conditionPercent, ...row?.settings.conditionPercent },
  };
}

/** Enregistre les règles et recalcule toutes les offres : un seuil modifié s'applique tout de suite, de façon tracée. */
export async function savePricingSettings(sql: Db, settings: PricingSettings, actor: string): Promise<{ settings: PricingSettings; repriced: number }> {
  const problem = validateSettings(settings);
  if (problem) throw new DomainError("INVALID_PRICING_SETTINGS", problem);
  return withTx(sql, async (tx) => {
    const before = await getPricingSettings(tx);
    await tx`
      insert into pricing_settings (settings) values (${tx.json(settings as never)})
      on conflict (id) do update set settings = excluded.settings, updated_at = now()`;
    await tx`
      insert into audit_events (actor, action, entity, entity_id, before, after)
      values (${actor}, 'pricing_settings_changed', 'pricing_settings', 'default', ${tx.json(before as never)}, ${tx.json(settings as never)})`;
    return { settings, repriced: await refreshPricing(tx) };
  });
}

// ───────────────────────── Cotations ─────────────────────────

/** Dernière cotation connue par variante et par type (cotations toutes conditions confondues). */
async function latestQuotes(sql: Db, variantIds: string[]): Promise<Map<string, Quote[]>> {
  const byVariant = new Map<string, Quote[]>();
  if (variantIds.length === 0) return byVariant;
  const rows = await sql<(Quote & { variantId: string })[]>`
    select distinct on (variant_id, quote_type) variant_id, quote_type, amount_cents, observed_at, variant_ambiguous
      from price_snapshots
     where variant_id in ${sql(variantIds)} and quote_type in ${sql(QUOTE_TYPES)} and condition is null
     order by variant_id, quote_type, observed_at desc`;
  for (const { variantId, ...quote } of rows) byVariant.set(variantId, [...(byVariant.get(variantId) ?? []), quote]);
  return byVariant;
}

export interface VariantQuote extends PricingResult {
  /** Toutes les dernières cotations connues, pour les montrer avec leur type et leur date. */
  quotes: Quote[];
}

/** Estimation pour une variante dans un état donné, avant toute entrée en stock (Parcours A, étape 4). */
export async function quoteVariant(sql: Db, variantId: string, condition: CardCondition, isUnique = false): Promise<VariantQuote> {
  const [variant] = await sql<{ incomplete: boolean }[]>`select incomplete from card_variants where id = ${variantId}`;
  if (!variant) throw new DomainError("VARIANT_NOT_FOUND", `card variant ${variantId} does not exist`);
  const quotes = (await latestQuotes(sql, [variantId])).get(variantId) ?? [];
  const result = computePricing(
    { condition, isUnique, variantIncomplete: variant.incomplete, averageCostCents: 0, quotes, current: { priceSource: "NONE", targetPriceCents: null }, now: new Date() },
    await getPricingSettings(sql),
  );
  return { ...result, quotes };
}

// ───────────────────────── Tarification des offres ─────────────────────────

interface OfferState {
  id: string;
  variantId: string;
  condition: CardCondition;
  isUnique: boolean;
  targetPriceCents: number | null;
  priceSource: PriceSource;
  variantIncomplete: boolean;
  averageCostCents: number;
}

async function applyPricing(tx: Db, offer: OfferState, quotes: Quote[], settings: PricingSettings): Promise<PricingResult> {
  const result = computePricing(
    {
      condition: offer.condition, isUnique: offer.isUnique, variantIncomplete: offer.variantIncomplete,
      averageCostCents: offer.averageCostCents, quotes, current: { priceSource: offer.priceSource, targetPriceCents: offer.targetPriceCents }, now: new Date(),
    },
    settings,
  );
  const blocked = result.reasons.some((r) => BLOCKING_REASONS.has(r));
  const observed = tx`
    suggested_price_cents = ${result.suggestedCents}, reference_price_cents = ${result.reference?.amountCents ?? null},
    reference_quote_type = ${result.reference?.quoteType ?? null}, reference_observed_at = ${result.reference?.observedAt ?? null},
    price_reasons = ${tx.json(result.reasons)}, priced_at = now(), version = version + 1, updated_at = now()`;

  if (offer.priceSource === "MANUAL") {
    // Décision humaine : on met à jour ce qu'on observe, jamais le prix ni la catégorie.
    await tx`update offers set ${observed} where id = ${offer.id}`;
  } else if (blocked || result.suggestedCents === null) {
    // À revoir : pas de prix posé d'office. Si un prix existait déjà, son plancher suit tout de même le coût.
    await tx`
      update offers set ${observed}, category = 'REVIEW',
                        floor_price_cents = case when target_price_cents is null then floor_price_cents else ${result.floorCents} end
       where id = ${offer.id}`;
  } else if (offer.targetPriceCents === null) {
    // Première tarification sans aucun doute : le prix suggéré devient le prix cible.
    await tx`
      update offers set ${observed}, category = ${result.category}, target_price_cents = ${result.suggestedCents},
                        floor_price_cents = ${result.floorCents}, price_source = 'AUTO'
       where id = ${offer.id}`;
  } else {
    // Prix déjà posé : il ne bouge pas tout seul (pas de repricing automatique) ; seul le plancher suit le coût.
    await tx`update offers set ${observed}, category = ${result.category}, floor_price_cents = ${result.floorCents} where id = ${offer.id}`;
  }
  return result;
}

const offerState = (tx: Db, where: ReturnType<Db>) => tx<OfferState[]>`
  select o.id, o.variant_id, o.condition, o.is_unique, o.target_price_cents, o.price_source,
         v.incomplete as variant_incomplete,
         coalesce((select (sum(s.on_hand::bigint * s.unit_cost_cents) / nullif(sum(s.on_hand), 0))::int
                     from stock_items s where s.offer_id = o.id and s.lifecycle <> 'ARCHIVED'), 0) as average_cost_cents
    from offers o
    join card_variants v on v.id = o.variant_id
    join catalog_cards c on c.id = v.catalog_card_id
   where ${where}
   order by o.id
   for update of o`;

/** Recalcule une offre (après une entrée en stock, un changement de coût…). */
export function refreshOfferPricing(sql: Db, offerId: string): Promise<PricingResult> {
  return withTx(sql, async (tx) => {
    const [offer] = await offerState(tx, tx`o.id = ${offerId}`);
    if (!offer) throw new DomainError("OFFER_NOT_FOUND", "offer not found");
    const quotes = (await latestQuotes(tx, [offer.variantId])).get(offer.variantId) ?? [];
    return applyPricing(tx, offer, quotes, await getPricingSettings(tx));
  });
}

/** Recalcule toutes les offres, ou celles d'une série (après import de nouvelles cotations). */
export function refreshPricing(sql: Db, scope: { setId?: string; language?: string } = {}): Promise<number> {
  return withTx(sql, async (tx) => {
    const offers = await offerState(
      tx,
      scope.setId ? tx`c.set_id = ${scope.setId} and c.language = ${scope.language ?? "fr"}` : tx`true`,
    );
    const quotes = await latestQuotes(tx, [...new Set(offers.map((o) => o.variantId))]);
    const settings = await getPricingSettings(tx);
    for (const offer of offers) await applyPricing(tx, offer, quotes.get(offer.variantId) ?? [], settings);
    return offers.length;
  });
}

export interface SetOfferPriceInput {
  offerId: string;
  targetPriceCents: number;
  /** Par défaut : calculé depuis le prix cible et le coût moyen. */
  floorPriceCents?: number;
  category: Exclude<OfferCategory, "REVIEW">;
  actor: string;
}

/** Décision humaine sur le prix et la catégorie d'une offre ; auditée. Les règles ne la modifieront plus. */
export async function setOfferPrice(sql: Db, input: SetOfferPriceInput): Promise<OfferPricing> {
  for (const value of [input.targetPriceCents, input.floorPriceCents ?? 0]) {
    if (!Number.isInteger(value) || value < 0) throw new DomainError("INVALID_PRICE", "prices must be non-negative integer cents");
  }
  return withTx(sql, async (tx) => {
    const [offer] = await offerState(tx, tx`o.id = ${input.offerId}`);
    if (!offer) throw new DomainError("OFFER_NOT_FOUND", "offer not found");
    const settings = await getPricingSettings(tx);
    const floor = input.floorPriceCents ?? Math.min(floorFor(input.targetPriceCents, offer.averageCostCents, settings, input.category), input.targetPriceCents);
    if (floor > input.targetPriceCents) throw new DomainError("FLOOR_ABOVE_TARGET", "the floor price cannot exceed the target price");

    const [before] = await tx`select target_price_cents, floor_price_cents, category, price_source from offers where id = ${offer.id}`;
    await tx`
      update offers set target_price_cents = ${input.targetPriceCents}, floor_price_cents = ${floor},
                        category = ${input.category}, price_source = 'MANUAL'
       where id = ${offer.id}`;
    await tx`
      insert into audit_events (actor, action, entity, entity_id, before, after)
      values (${input.actor}, 'offer_price_set', 'offer', ${offer.id}, ${tx.json(before as never)},
              ${tx.json({ targetPriceCents: input.targetPriceCents, floorPriceCents: floor, category: input.category })})`;
    const quotes = (await latestQuotes(tx, [offer.variantId])).get(offer.variantId) ?? [];
    await applyPricing(tx, { ...offer, priceSource: "MANUAL", targetPriceCents: input.targetPriceCents }, quotes, settings);
    return (await listOfferPricing(tx, { offerId: offer.id, status: "ALL", includeEmpty: true })).items[0]!;
  });
}

// ───────────────────────── Lecture ─────────────────────────

export interface OfferPricing {
  offerId: string;
  offerSku: string;
  condition: CardCondition;
  isUnique: boolean;
  category: OfferCategory;
  targetPriceCents: number | null;
  floorPriceCents: number | null;
  suggestedPriceCents: number | null;
  priceSource: PriceSource;
  reasons: PriceReason[];
  reference: { quoteType: QuoteType; amountCents: number; observedAt: Date } | null;
  pricedAt: Date | null;
  onHand: number;
  averageCostCents: number;
  card: {
    variantId: string;
    name: string;
    setId: string;
    localNumber: string;
    language: string;
    imageUrl: string | null;
    finish: string;
    edition: string;
  };
}

export interface OfferPricingQuery {
  /** REVIEW : offres avec un motif de revue ou sans prix. */
  status?: "REVIEW" | "ALL";
  q?: string;
  offerId?: string;
  /** Inclure les offres sans stock (par défaut non : rien à vendre, rien à tarifer). */
  includeEmpty?: boolean;
  limit?: number;
  offset?: number;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** Offres avec leur prix, triées par enjeu (valeur du stock concerné) : la file de revue traite le plus important d'abord. */
export async function listOfferPricing(
  sql: Db,
  query: OfferPricingQuery = {},
): Promise<{ items: OfferPricing[]; total: number; reviewCount: number; allCount: number }> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const q = query.q?.trim();
  const needsReview = sql`(jsonb_array_length(o.price_reasons) > 0 or o.target_price_cents is null)`;

  const base = sql`
    from offers o
    join card_variants v on v.id = o.variant_id
    join catalog_cards c on c.id = v.catalog_card_id
    join lateral (
      select coalesce(sum(s.on_hand), 0)::int as on_hand,
             coalesce((sum(s.on_hand::bigint * s.unit_cost_cents) / nullif(sum(s.on_hand), 0))::int, 0) as average_cost_cents
        from stock_items s where s.offer_id = o.id and s.lifecycle <> 'ARCHIVED') st on true
   where ${query.includeEmpty ? sql`true` : sql`st.on_hand > 0`}
     ${query.offerId ? sql`and o.id = ${query.offerId}` : sql``}
     ${q ? sql`and (upper(o.offer_sku) like upper(${likeEscape(q)}) || '%'
                 or f_unaccent(lower(c.name)) like '%' || f_unaccent(lower(${likeEscape(q)})) || '%')` : sql``}`;

  const [items, [counts]] = await Promise.all([
    sql<OfferPricing[]>`
      select o.id as offer_id, o.offer_sku, o.condition, o.is_unique, o.category, o.target_price_cents, o.floor_price_cents,
             o.suggested_price_cents, o.price_source, o.price_reasons as reasons, o.priced_at,
             case when o.reference_price_cents is null then null else jsonb_build_object(
               'quoteType', o.reference_quote_type, 'amountCents', o.reference_price_cents, 'observedAt', o.reference_observed_at) end as reference,
             st.on_hand, st.average_cost_cents,
             jsonb_build_object('variantId', v.id, 'name', c.name, 'setId', c.set_id, 'localNumber', c.local_number,
               'language', c.language, 'imageUrl', c.image_url, 'finish', v.finish, 'edition', v.edition) as card
      ${base}
        ${query.status === "REVIEW" ? sql`and ${needsReview}` : sql``}
      order by st.on_hand::bigint * coalesce(o.suggested_price_cents, o.target_price_cents, 0) desc, o.offer_sku
      limit ${limit} offset ${offset}`,
    sql<{ allCount: number; reviewCount: number }[]>`
      select count(*)::int as all_count, (count(*) filter (where ${needsReview}))::int as review_count ${base}`,
  ]);
  const { allCount, reviewCount } = counts!;
  return { items, total: query.status === "REVIEW" ? reviewCount : allCount, reviewCount, allCount };
}
