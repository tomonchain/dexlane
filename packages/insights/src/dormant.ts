import { withTx, type Db } from "@dexlane/db";
import { createLot } from "@dexlane/inventory";
import { endListing, syncPrices, syncQuantities, type ChannelAdapters } from "@dexlane/listings";
import { setOfferPrice } from "@dexlane/pricing";
import { DomainError } from "@dexlane/shared";
import { dormantAfterDays } from "./config/progression";

/**
 * Cartes dormantes (#83) : en ligne depuis plus de `dormantAfterDays` jours, encore en stock, sans aucune vente depuis
 * leur mise en ligne. Les actions groupées (baisser le prix, regrouper en lot, retirer de la vente) ne sont jamais
 * automatiques : la baisse de prix se prévisualise, puis se confirme.
 */

export interface DormantCard {
  offerId: string;
  offerSku: string;
  kind: "CARD" | "LOT";
  name: string;
  setName: string | null;
  localNumber: string;
  imageUrl: string | null;
  condition: string;
  /** Prix de l'annonce en ligne. */
  priceCents: number;
  currency: string;
  floorPriceCents: number | null;
  listedAt: Date;
  daysOnline: number;
  available: number;
  /** Emplacements où se trouvent les exemplaires. */
  locations: string[];
  /** Annonces vivantes de l'offre (une par canal). */
  listingIds: string[];
  channels: string[];
}

const dormantQuery = (sql: Db, opts: { offerIds?: string[]; days: number }) => sql<DormantCard[]>`
  select o.id as offer_id, o.offer_sku, o.kind, coalesce(o.lot_title, c.name) as name, st.name as set_name, c.local_number,
         c.image_url, o.condition::text as condition, min(l.price_cents)::int as price_cents, min(l.currency) as currency,
         o.floor_price_cents, min(l.created_at) as listed_at,
         floor(extract(epoch from now() - min(l.created_at)) / 86400)::int as days_online,
         avail.available, coalesce(avail.locations, '{}') as locations,
         array_agg(l.id order by l.channel) as listing_ids, array_agg(l.channel order by l.channel) as channels
    from listings l
    join offers o on o.id = l.offer_id
    join card_variants v on v.id = o.variant_id
    join catalog_cards c on c.id = v.catalog_card_id
    left join catalog_sets st on st.id = c.set_id and st.language = c.language
    join lateral (
      select coalesce(sum(s.on_hand - s.reserved - s.inspection - s.quarantine) filter (where s.lifecycle = 'ACTIVE'), 0)::int as available,
             array_agg(distinct loc.code order by loc.code) filter (where s.on_hand > 0) as locations
        from stock_items s join locations loc on loc.id = s.location_id
       where s.offer_id = o.id
    ) avail on true
   where l.status in ('ACTIVE', 'PAUSED') and not l.simulated
     ${opts.offerIds ? sql`and o.id in ${sql(opts.offerIds)}` : sql``}
   group by o.id, c.id, st.name, avail.available, avail.locations
  having min(l.created_at) <= now() - make_interval(days => ${opts.days})
     and avail.available > 0
     and not exists (
       select 1 from order_lines ol join orders od on od.id = ol.order_id
        where ol.offer_id = o.id and od.ordered_at >= min(l.created_at) and od.fulfillment_status <> 'CANCELLED')
   order by min(l.created_at), o.offer_sku`;

export function listDormantCards(sql: Db, opts: { offerIds?: string[] } = {}): Promise<DormantCard[]> {
  return dormantQuery(sql, { ...opts, days: dormantAfterDays });
}

export async function countDormantCards(sql: Db): Promise<number> {
  return (await listDormantCards(sql)).length;
}

// ───────────────────────── Baisser le prix ─────────────────────────

export interface RepriceLine {
  offerId: string;
  name: string;
  beforeCents: number;
  afterCents: number;
  /** Le nouveau prix est arrêté au prix plancher de l'offre. */
  atFloor: boolean;
}

/** Aperçu d'une baisse de X % : avant / après pour chaque carte, sans rien changer. */
export async function previewReprice(sql: Db, input: { offerIds: string[]; percent: number }): Promise<RepriceLine[]> {
  if (!Number.isInteger(input.percent) || input.percent < 1 || input.percent > 90) {
    throw new DomainError("INVALID_PERCENT", "the price cut is a whole percentage between 1 and 90");
  }
  if (input.offerIds.length === 0) return [];
  const cards = await listDormantCards(sql, { offerIds: input.offerIds });
  return cards.map((c) => {
    const wanted = Math.max(1, Math.round((c.priceCents * (100 - input.percent)) / 100));
    const floor = c.floorPriceCents ?? 0;
    const afterCents = Math.min(c.priceCents, Math.max(wanted, floor));
    return { offerId: c.offerId, name: c.name, beforeCents: c.priceCents, afterCents, atFloor: afterCents > wanted };
  });
}

/**
 * Applique la baisse, après confirmation explicite : le prix cible de chaque offre change (décision auditée, comme un
 * prix fixé à la main), puis les annonces en ligne sont révisées. Les montants confirmés doivent être ceux de l'aperçu.
 */
export async function applyReprice(
  sql: Db, live: ChannelAdapters, input: { offerIds: string[]; percent: number; confirm: boolean; actor: string },
): Promise<{ repriced: number; lines: RepriceLine[] }> {
  if (!input.confirm) throw new DomainError("CONFIRMATION_REQUIRED", "a price cut must be confirmed after its preview");
  const lines = await withTx(sql, async (tx) => {
    const preview = await previewReprice(tx, input);
    for (const l of preview.filter((p) => p.afterCents < p.beforeCents)) {
      const [offer] = await tx<{ floorPriceCents: number | null }[]>`select floor_price_cents from offers where id = ${l.offerId}`;
      await setOfferPrice(tx, {
        offerId: l.offerId, targetPriceCents: l.afterCents,
        floorPriceCents: Math.min(offer?.floorPriceCents ?? l.afterCents, l.afterCents), actor: input.actor,
      });
    }
    return preview;
  });
  await syncPrices(sql, live, input.actor);
  return { repriced: lines.filter((l) => l.afterCents < l.beforeCents).length, lines };
}

// ───────────────────────── Regrouper en lot, retirer de la vente ─────────────────────────

/** Regroupe les cartes dormantes choisies en un lot (tous leurs exemplaires disponibles), puis réaligne les annonces. */
export async function bundleDormant(
  sql: Db, live: ChannelAdapters, input: { offerIds: string[]; title: string; priceCents: number; actor: string },
) {
  const cards = (await listDormantCards(sql, { offerIds: input.offerIds })).filter((c) => c.kind === "CARD");
  if (cards.length === 0) throw new DomainError("NOTHING_TO_BUNDLE", "none of these cards is dormant");
  const lot = await createLot(sql, {
    title: input.title, priceCents: input.priceCents, actor: input.actor,
    items: cards.map((c) => ({ offerId: c.offerId, qty: c.available })),
  });
  // Les cartes parties dans le lot ne sont plus disponibles à l'unité : leurs annonces passent à zéro.
  await syncQuantities(sql, live);
  return lot;
}

/** Retire de la vente (termine les annonces en ligne) les cartes dormantes choisies. */
export async function withdrawDormant(sql: Db, live: ChannelAdapters, input: { offerIds: string[]; confirm: boolean; actor: string }) {
  if (!input.confirm) throw new DomainError("CONFIRMATION_REQUIRED", "withdrawing cards from sale must be confirmed");
  const cards = await listDormantCards(sql, { offerIds: input.offerIds });
  let ended = 0;
  for (const card of cards) {
    for (const listingId of card.listingIds) {
      await endListing(sql, live, { listingId, actor: input.actor });
      ended++;
    }
  }
  return { cards: cards.length, listingsEnded: ended };
}
