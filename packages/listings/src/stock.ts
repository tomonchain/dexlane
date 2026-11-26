import type { Db } from "@dexlane/db";
import { listPhotos, type CardCondition, type PhotoRow } from "@dexlane/inventory";
import { DomainError } from "@dexlane/shared";
import { getListingSettings, listingBlockers, listingsOf, type ListingBlocker, type ListingState } from "./store";
import { buildListingText, suggestTitle, type ListingText } from "./template";

/**
 * Où en est une carte sur le chemin de la vente :
 * brouillon à valider → prix à décider → prête à vendre → en ligne.
 */
export type StockStatus = "DRAFT" | "TO_PRICE" | "READY" | "LISTED";
export const STOCK_STATUSES: StockStatus[] = ["TO_PRICE", "READY", "LISTED", "DRAFT"];

/** Une ligne du stock : une carte dans un état donné (une offre), toutes positions confondues. */
export interface StockRow {
  /** La carte du catalogue : sa fiche regroupe toutes ses offres. */
  catalogCardId: string;
  offerId: string;
  offerSku: string;
  status: StockStatus;
  condition: CardCondition;
  isUnique: boolean;
  category: string;
  name: string;
  setId: string;
  setName: string | null;
  /** Code d'extension usuel (« EB03 », « EV03.5 », « ME02.5 »), voir la fonction SQL `set_code`. */
  setCode: string;
  localNumber: string;
  language: string;
  rarity: string | null;
  imageUrl: string | null;
  variantId: string;
  finish: string;
  edition: string;
  subtype: string;
  stamp: string;
  variantIncomplete: boolean;
  onHand: number;
  /** Vendable tout de suite : positions validées, hors réservations. */
  available: number;
  reserved: number;
  /** Exemplaires encore en brouillon. */
  draft: number;
  locations: string[];
  averageCostCents: number;
  targetPriceCents: number | null;
  floorPriceCents: number | null;
  suggestedPriceCents: number | null;
  priceReasons: string[];
  /** Cote retenue pour le calcul, avec son type et sa date. */
  reference: { quoteType: string; amountCents: number; observedAt: Date } | null;
  /** Estimation d'après les ventes réussies ; null sans vente récente. */
  sales: { cents: number; confidence: "HIGH" | "MEDIUM" | "LOW"; sales: { quoteType: string; amountCents: number }[] } | null;
  /** Photo de l'exemplaire (visuel d'annonce, sinon scan) ; null : seule l'image du catalogue existe. */
  photoUrl: string | null;
  listings: ListingState[];
  /** Prochaine mise en ligne planifiée, s'il y en a une. */
  planned: { id: string; channel: string; plannedOn: string } | null;
  receivedAt: Date;
  /** Carte gradée : société de gradation, note, numéro de certificat. */
  grader: string | null;
  grade: string | null;
  certNumber: string | null;
  /** Titre choisi pour cette carte (il remplace le modèle) ; null : le modèle. */
  titleOverride: string | null;
}

export interface StockQuery {
  q?: string;
  status?: StockStatus | "ALL";
  /** value : enjeu (prix × quantité) ; recent : dernière entrée d'abord ; name : alphabétique. */
  sort?: "value" | "recent" | "name";
  offerId?: string;
  /** Toutes les offres d'une carte du catalogue (toutes variantes, tous états). */
  cardId?: string;
  /** Filtres : série, boîte (et ce qu'elle contient), état, fourchette de prix (prix fixé, sinon suggéré). */
  setId?: string;
  location?: string;
  condition?: string;
  minCents?: number;
  maxCents?: number;
  limit?: number;
  offset?: number;
}

/** Valeurs proposées par les filtres : ce que contient réellement le stock. */
export interface StockFacets {
  sets: { id: string; name: string; cards: number }[];
  locations: { code: string; cards: number }[];
  conditions: { code: string; cards: number }[];
}

export interface StockPage {
  items: StockRow[];
  total: number;
  counts: Record<StockStatus | "ALL", number>;
  /** Sur tout le stock, pas seulement la page affichée. */
  totals: { cards: number; valueCents: number };
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, "\\$&");

export async function listStock(sql: Db, query: StockQuery = {}): Promise<StockPage> {
  const q = query.q?.trim();
  const status = query.status ?? "ALL";
  const order =
    query.sort === "value" ? sql`on_hand::bigint * coalesce(target_price_cents, suggested_price_cents, 0) desc, name`
    : query.sort === "name" ? sql`name, offer_sku`
    : sql`received_at desc, offer_sku`;
  const stock = sql`
    with stock as (
      select o.id as offer_id, o.offer_sku, o.condition, o.is_unique, o.category::text as category,
             c.id as catalog_card_id, c.name, c.set_id, st.name as set_name, c.local_number, c.language, c.rarity, c.image_url,
             set_code(c.set_id, c.language, st.code_override, st.abbreviation) as set_code,
             v.id as variant_id, v.finish, v.edition, v.subtype, v.stamp, v.incomplete as variant_incomplete,
             s.on_hand, s.available, s.reserved, s.draft, s.locations, s.average_cost_cents, s.received_at,
             o.target_price_cents, o.floor_price_cents, o.suggested_price_cents, o.price_reasons,
             case when o.reference_price_cents is null then null else jsonb_build_object(
               'quoteType', o.reference_quote_type, 'amountCents', o.reference_price_cents, 'observedAt', o.reference_observed_at) end as reference,
             o.sales_estimate as sales, o.grader, o.grade, o.cert_number, o.title_override,
             (select p.url from photos p where p.offer_id = o.id and p.kind in ('LISTING', 'SCAN_FRONT')
               order by (p.kind = 'LISTING') desc, p.created_at limit 1) as photo_url,
             (select jsonb_build_object('id', sp.id, 'channel', sp.channel, 'plannedOn', to_char(sp.planned_on, 'YYYY-MM-DD'))
                from scheduled_publications sp where sp.offer_id = o.id and sp.status = 'PENDING' order by sp.planned_on limit 1) as planned,
             case
               when s.available = 0 and s.draft > 0 then 'DRAFT'
               when exists (select 1 from listings l where l.offer_id = o.id and l.status in ('ACTIVE', 'PAUSED', 'ERROR')) then 'LISTED'
               when o.target_price_cents is null then 'TO_PRICE'
               else 'READY'
             end as status
        from offers o
        join card_variants v on v.id = o.variant_id
        join catalog_cards c on c.id = v.catalog_card_id
        left join catalog_sets st on st.id = c.set_id and st.language = c.language
        join lateral (
          select sum(i.on_hand)::int as on_hand,
                 coalesce(sum(i.on_hand - i.reserved - i.inspection - i.quarantine) filter (where i.lifecycle = 'ACTIVE'), 0)::int as available,
                 sum(i.reserved)::int as reserved,
                 coalesce(sum(i.on_hand) filter (where i.lifecycle = 'DRAFT'), 0)::int as draft,
                 array_agg(distinct l.code order by l.code) as locations,
                 (sum(i.on_hand::bigint * i.unit_cost_cents) / nullif(sum(i.on_hand), 0))::int as average_cost_cents,
                 max(i.created_at) as received_at
            from stock_items i join locations l on l.id = i.location_id
           where i.offer_id = o.id and i.lifecycle <> 'ARCHIVED' and i.on_hand > 0
        ) s on s.on_hand > 0
       where o.kind = 'CARD'
         ${query.offerId ? sql`and o.id = ${query.offerId}` : sql``}
         ${query.cardId ? sql`and c.id = ${query.cardId}` : sql``}
         ${query.setId ? sql`and c.set_id = ${query.setId}` : sql``}
         ${query.condition ? sql`and o.condition = ${query.condition}` : sql``}
         ${query.location ? sql`and exists (
             select 1 from stock_items fi join locations fl on fl.id = fi.location_id
              where fi.offer_id = o.id and fi.lifecycle <> 'ARCHIVED' and fi.on_hand > 0
                and (fl.code = ${query.location} or fl.code like ${likeEscape(query.location)} || '/%'))` : sql``}
         ${query.minCents !== undefined ? sql`and coalesce(o.target_price_cents, o.suggested_price_cents) >= ${query.minCents}` : sql``}
         ${query.maxCents !== undefined ? sql`and coalesce(o.target_price_cents, o.suggested_price_cents) < ${query.maxCents}` : sql``}
         ${q ? sql`and (upper(o.offer_sku) like '%' || upper(${likeEscape(q)}) || '%'
                    or f_unaccent(lower(c.name)) like '%' || f_unaccent(lower(${likeEscape(q)})) || '%'
                    or f_unaccent(lower(coalesce(st.name, ''))) like '%' || f_unaccent(lower(${likeEscape(q)})) || '%'
                    or (length(set_code_key(${q})) >= 2
                        and set_code_key(set_code(c.set_id, c.language, st.code_override, st.abbreviation)) like set_code_key(${likeEscape(q)}) || '%'))` : sql``}
    )`;
  const [rows, counts] = await Promise.all([
    sql<Omit<StockRow, "listings">[]>`
      ${stock} select * from stock ${status === "ALL" ? sql`` : sql`where status = ${status}`}
      order by ${order} limit ${Math.min(query.limit ?? 50, 200)} offset ${query.offset ?? 0}`,
    sql<{ status: StockStatus; n: number; cards: number; valueCents: string }[]>`
      ${stock} select status, count(*)::int as n, sum(on_hand)::int as cards,
                      coalesce(sum(on_hand::bigint * coalesce(target_price_cents, suggested_price_cents)), 0)::text as value_cents
                 from stock group by status`,
  ]);
  const listings = await listingsOf(sql, rows.map((r) => r.offerId));
  const count = (s: StockStatus) => counts.find((c) => c.status === s)?.n ?? 0;
  const all = counts.reduce((sum, c) => sum + c.n, 0);
  return {
    items: rows.map((r) => ({ ...r, listings: listings.filter((l) => l.offerId === r.offerId) })),
    total: status === "ALL" ? all : count(status),
    counts: { ALL: all, DRAFT: count("DRAFT"), TO_PRICE: count("TO_PRICE"), READY: count("READY"), LISTED: count("LISTED") },
    totals: { cards: counts.reduce((sum, c) => sum + c.cards, 0), valueCents: counts.reduce((sum, c) => sum + Number(c.valueCents), 0) },
  };
}

/** Tout ce qui concerne une carte du stock : annonce, photos, positions physiques, historique de cote. */
export interface StockDetail extends StockRow {
  text: ListingText;
  /** Ce qui manque pour publier. */
  missing: ListingBlocker[];
  photos: PhotoRow[];
  positions: { id: string; unitSku: string; locationCode: string; onHand: number; reserved: number; lifecycle: string; unitCostCents: number; createdAt: Date }[];
}

export async function getStockDetail(sql: Db, offerId: string): Promise<StockDetail> {
  const row = (await listStock(sql, { offerId })).items[0];
  if (!row) throw new DomainError("OFFER_NOT_FOUND", "this card is not in stock");
  const [photos, positions, [set], settings] = await Promise.all([
    listPhotos(sql, { offerIds: [offerId] }),
    sql<StockDetail["positions"]>`
      select i.id, i.unit_sku, l.code as location_code, i.on_hand, i.reserved, i.lifecycle::text as lifecycle, i.unit_cost_cents, i.created_at
        from stock_items i join locations l on l.id = i.location_id
       where i.offer_id = ${offerId} and i.lifecycle <> 'ARCHIVED' and i.on_hand > 0
       order by i.created_at`,
    sql<{ serieName: string | null; officialCount: number | null }[]>`
      select serie_name, card_count_official as official_count from catalog_sets where id = ${row.setId} and language = ${row.language}`,
    getListingSettings(sql),
  ]);
  const text = buildListingText({ ...row, serieName: set?.serieName ?? null, officialCount: set?.officialCount ?? null }, settings, row.titleOverride);
  return { ...row, text, photos, positions, missing: listingBlockers({ targetPriceCents: row.targetPriceCents, photos, variantIncomplete: row.variantIncomplete }) };
}

/** Suggestions pour une carte : un titre que les acheteurs trouvent et le prix que le marché soutient. */
export interface StockSuggestions {
  title: { current: string; suggested: string; custom: boolean };
  price: {
    currentCents: number | null;
    suggestedCents: number | null;
    reference: StockRow["reference"];
    sales: StockRow["sales"];
    reasons: string[];
  };
}

export async function stockSuggestions(sql: Db, offerId: string): Promise<StockSuggestions> {
  const detail = await getStockDetail(sql, offerId);
  const [set] = await sql<{ serieName: string | null; officialCount: number | null }[]>`
    select serie_name, card_count_official as official_count from catalog_sets where id = ${detail.setId} and language = ${detail.language}`;
  return {
    title: {
      current: detail.text.title,
      suggested: suggestTitle({ ...detail, serieName: set?.serieName ?? null, officialCount: set?.officialCount ?? null }),
      custom: detail.titleOverride !== null,
    },
    price: {
      currentCents: detail.targetPriceCents, suggestedCents: detail.suggestedPriceCents, reference: detail.reference, sales: detail.sales,
      reasons: detail.priceReasons,
    },
  };
}

/** Ce que proposent les filtres du stock : séries, boîtes et états présents, avec le nombre d'exemplaires. */
export async function stockFacets(sql: Db): Promise<StockFacets> {
  const rows = await sql<{ kind: "set" | "location" | "condition"; key: string; label: string; cards: number }[]>`
    with present as (
      select i.on_hand, o.condition::text as condition, c.set_id,
             set_code(c.set_id, c.language, st.code_override, st.abbreviation) || ' · ' || coalesce(st.name, c.set_id) as set_name, l.code
        from stock_items i
        join offers o on o.id = i.offer_id
        join card_variants v on v.id = o.variant_id
        join catalog_cards c on c.id = v.catalog_card_id
        left join catalog_sets st on st.id = c.set_id and st.language = c.language
        join locations l on l.id = i.location_id
       where i.lifecycle <> 'ARCHIVED' and i.on_hand > 0 and o.kind = 'CARD')
    select 'set' as kind, set_id as key, min(set_name) as label, sum(on_hand)::int as cards from present group by set_id
    union all select 'location', code, code, sum(on_hand)::int from present group by code
    union all select 'condition', condition, condition, sum(on_hand)::int from present group by condition`;
  const of = (kind: string) => rows.filter((r) => r.kind === kind);
  const ORDER = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];
  return {
    sets: of("set").map((r) => ({ id: r.key, name: r.label, cards: r.cards })).sort((a, b) => a.name.localeCompare(b.name, "fr")),
    locations: of("location").map((r) => ({ code: r.key, cards: r.cards })).sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true })),
    conditions: of("condition").map((r) => ({ code: r.key, cards: r.cards })).sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code)),
  };
}
