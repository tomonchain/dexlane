import { withTx, type Db } from "@dexlane/db";
import { listPhotos, type CardCondition, type PhotoRow } from "@dexlane/inventory";
import type { CardDetails } from "./ebay/aspects";
import { DomainError } from "@dexlane/shared";
import type { ChannelId } from "./channel-ids";
import {
  DEFAULT_LISTING_SETTINGS, buildListingText, validateListingSettings, variablesOf, type ListingSettings, type ListingSubject, type ListingText,
} from "./template";

export async function getListingSettings(sql: Db): Promise<ListingSettings> {
  const [row] = await sql<{ settings: Partial<ListingSettings> }[]>`select settings from listing_settings`;
  // Fusion avec les valeurs par défaut : un réglage ajouté plus tard n'invalide pas ceux déjà enregistrés.
  return { ...DEFAULT_LISTING_SETTINGS, ...row?.settings, photo: { ...DEFAULT_LISTING_SETTINGS.photo, ...row?.settings.photo } };
}

export async function saveListingSettings(sql: Db, settings: ListingSettings, actor: string): Promise<ListingSettings> {
  const problem = validateListingSettings(settings);
  if (problem) throw new DomainError("INVALID_LISTING_SETTINGS", problem);
  return withTx(sql, async (tx) => {
    if (settings.photo.background.type === "image") {
      const [background] = await tx`select 1 from photos where id = ${settings.photo.background.photoId} and kind = 'BACKGROUND'`;
      if (!background) throw new DomainError("INVALID_LISTING_SETTINGS", "L'image de fond n'existe plus : choisissez-en une autre.");
    }
    if (settings.photo.logoPhotoId) {
      const [logo] = await tx`select 1 from photos where id = ${settings.photo.logoPhotoId} and kind = 'LOGO'`;
      if (!logo) throw new DomainError("INVALID_LISTING_SETTINGS", "Le logo n'existe plus : choisissez-en un autre.");
    }
    if (settings.promoPhotoId) {
      const [promo] = await tx`select 1 from photos where id = ${settings.promoPhotoId} and kind = 'PROMO'`;
      if (!promo) throw new DomainError("INVALID_LISTING_SETTINGS", "L'image de fin d'annonce n'existe plus : choisissez-en une autre.");
    }
    const before = await getListingSettings(tx);
    await tx`
      insert into listing_settings (settings) values (${tx.json(settings as never)})
      on conflict (account_id) do update set settings = excluded.settings, updated_at = now()`;
    await tx`
      insert into audit_events (actor, action, entity, entity_id, before, after)
      values (${actor}, 'listing_settings_changed', 'listing_settings', 'default', ${tx.json(before as never)}, ${tx.json(settings as never)})`;
    return settings;
  });
}

/** Une offre vendable, avec le texte de son annonce et ses photos. */
export interface ListingOffer {
  offerId: string;
  offerSku: string;
  cardName: string;
  imageUrl: string | null;
  condition: CardCondition;
  category: string;
  isUnique: boolean;
  targetPriceCents: number | null;
  available: number;
  variantIncomplete: boolean;
  text: ListingText;
  /** La carte décrite champ par champ (caractéristiques structurées des canaux). */
  details: CardDetails;
  /** Scans (recto, verso) et visuels d'annonce déjà composés. */
  photos: PhotoRow[];
  /** Ce qui manque pour publier ; vide : l'offre est prête. */
  missing: ListingBlocker[];
  /** CARD : une carte ; LOT : un lot de cartes (une annonce). */
  kind: "CARD" | "LOT";
  /** Carte gradée : société, note et certificat. */
  grading: { grader: string; grade: string | null; certNumber: string | null } | null;
  /** Annonces en cours sur les canaux. */
  listings: ListingState[];
}

export type ListingBlocker = "PRICE" | "PHOTO" | "VARIANT";

/** Ce qui manque à une offre pour être publiée. */
export function listingBlockers(offer: Pick<ListingOffer, "targetPriceCents" | "photos" | "variantIncomplete">): ListingBlocker[] {
  return [
    offer.targetPriceCents === null && "PRICE",
    !offer.photos.some((p) => p.kind !== "BACKGROUND") && "PHOTO",
    offer.variantIncomplete && "VARIANT",
  ].filter(Boolean) as ListingBlocker[];
}

export interface ListingState {
  id: string;
  offerId: string;
  channel: ChannelId;
  status: "PENDING" | "ACTIVE" | "PAUSED" | "ENDED" | "ERROR";
  externalId: string | null;
  url: string | null;
  priceCents: number;
  quantitySent: number;
  simulated: boolean;
  errorCode: string | null;
  lastSyncedAt: Date | null;
}

export const listingColumns = (sql: Db) =>
  sql`id, offer_id, channel, status, external_id, url, price_cents, quantity_sent, simulated, error_code, last_synced_at`;

/** Annonces en cours (tout sauf terminées) des offres données. */
export function listingsOf(sql: Db, offerIds: string[]): Promise<ListingState[]> {
  if (offerIds.length === 0) return Promise.resolve([]);
  return sql<ListingState[]>`
    select ${listingColumns(sql)} from listings where offer_id in ${sql(offerIds)} and status <> 'ENDED' order by channel`;
}

type OfferRow = ListingSubject & Pick<ListingOffer, "offerId" | "imageUrl" | "category" | "isUnique" | "available" | "variantIncomplete" | "kind"> & {
  lotTitle: string | null;
  lotDescription: string | null;
  titleOverride: string | null;
};

/** Description d'un lot : son texte, puis la liste de ses cartes. */
async function lotTexts(sql: Db, lotIds: string[]): Promise<Map<string, { lines: string[]; offerIds: string[] }>> {
  const out = new Map<string, { lines: string[]; offerIds: string[] }>();
  if (lotIds.length === 0) return out;
  const rows = await sql<{ lotOfferId: string; offerId: string; name: string; localNumber: string; setName: string | null; condition: string; qty: number }[]>`
    select li.lot_offer_id, f.id as offer_id, c.name, c.local_number, s.name as set_name, f.condition, li.qty
      from lot_items li
      join stock_items si on si.id = li.stock_item_id
      join offers f on f.id = si.offer_id
      join card_variants v on v.id = f.variant_id
      join catalog_cards c on c.id = v.catalog_card_id
      left join catalog_sets s on s.id = c.set_id and s.language = c.language
     where li.lot_offer_id in ${sql(lotIds)}
     order by f.target_price_cents desc nulls last, c.name`;
  for (const r of rows) {
    const entry = out.get(r.lotOfferId) ?? { lines: [], offerIds: [] };
    entry.lines.push(`- ${r.name} (${[r.setName, r.localNumber].filter(Boolean).join(" ")}) — ${r.condition}${r.qty > 1 ? ` ×${r.qty}` : ""}`);
    entry.offerIds.push(r.offerId);
    out.set(r.lotOfferId, entry);
  }
  return out;
}

/** Offres ayant du stock vendable — ou une annonce encore en cours, même épuisée —, les plus chères d'abord. */
export async function listListingOffers(
  sql: Db,
  opts: { q?: string; offerId?: string; limit?: number; offset?: number } = {},
): Promise<{ items: ListingOffer[]; total: number }> {
  const q = opts.q?.trim();
  const rows = await sql<(OfferRow & { total: number })[]>`
    select o.id as offer_id, o.offer_sku, o.condition, o.category, o.is_unique, o.target_price_cents,
           o.kind, o.lot_title, o.lot_description, o.title_override, o.grader, o.grade, o.cert_number,
           c.name, c.local_number, c.set_id, c.language, c.rarity, c.image_url,
           v.finish, v.edition, v.subtype, v.stamp, v.incomplete as variant_incomplete,
           s.name as set_name, s.serie_name, s.card_count_official as official_count,
           stock.available, count(*) over ()::int as total
      from offers o
      join card_variants v on v.id = o.variant_id
      join catalog_cards c on c.id = v.catalog_card_id
      left join catalog_sets s on s.id = c.set_id and s.language = c.language
      join lateral (
        select coalesce(sum(on_hand - reserved - inspection - quarantine), 0)::int as available
          from stock_items where offer_id = o.id and lifecycle = 'ACTIVE'
      ) stock on true
     where (stock.available > 0 or exists (select 1 from listings l where l.offer_id = o.id and l.status <> 'ENDED'))
       ${opts.offerId ? sql`and o.id = ${opts.offerId}` : sql``}
       ${q ? sql`and (c.name ilike ${`%${q}%`} or o.offer_sku ilike ${`%${q}%`})` : sql``}
     order by o.target_price_cents desc nulls last, c.name, o.offer_sku
     limit ${Math.min(opts.limit ?? 50, 200)} offset ${opts.offset ?? 0}`;
  const settings = await getListingSettings(sql);
  const offerIds = rows.map((r) => r.offerId);
  const lots = await lotTexts(sql, rows.filter((r) => r.kind === "LOT").map((r) => r.offerId));
  // Un lot montre les photos de ses cartes.
  const photoOfferIds = [...new Set([...offerIds, ...[...lots.values()].flatMap((l) => l.offerIds)])];
  const [photos, listings] = [await listPhotos(sql, { offerIds: photoOfferIds }), await listingsOf(sql, offerIds)];
  return {
    total: rows[0]?.total ?? 0,
    items: rows.map(({ total: _total, ...r }) => {
      const v = variablesOf(r);
      const lot = r.kind === "LOT" ? lots.get(r.offerId) : undefined;
      const card = buildListingText(r, settings, r.titleOverride);
      const text = r.kind === "LOT"
        ? {
          title: r.lotTitle!,
          description: [r.lotDescription, `Lot de ${lot?.lines.length ?? 0} cartes Pokémon :`, ...(lot?.lines ?? []), "", `Référence : ${r.offerSku}`]
            .filter((l) => l !== null).join("\n").trim(),
          warnings: [],
        }
        : card;
      const offer = {
        details: { name: v.nom, number: v.numero, set: v.serie, language: r.language, rarity: v.rarete, finish: r.finish, lot: r.kind === "LOT", grader: r.grader, grade: r.grade, certNumber: r.certNumber },
        offerId: r.offerId, offerSku: r.offerSku, cardName: r.kind === "LOT" ? r.lotTitle! : r.name, imageUrl: r.imageUrl, condition: r.condition, category: r.category,
        isUnique: r.isUnique, targetPriceCents: r.targetPriceCents, available: r.available, variantIncomplete: r.kind === "LOT" ? false : r.variantIncomplete,
        kind: r.kind, grading: r.grader ? { grader: r.grader, grade: r.grade ?? null, certNumber: r.certNumber ?? null } : null,
        text,
        photos: r.kind === "LOT"
          ? (lot?.offerIds ?? []).flatMap((id) => {
            // Une photo par carte : son visuel d'annonce, sinon son recto.
            const own = photos.filter((p) => p.offerId === id);
            const best = own.find((p) => p.kind === "LISTING") ?? own.find((p) => p.kind === "SCAN_FRONT") ?? own.find((p) => p.kind !== "BACKGROUND");
            return best ? [best] : [];
          }).slice(0, 23)
          : photos.filter((p) => p.offerId === r.offerId),
      };
      return { ...offer, missing: listingBlockers(offer), listings: listings.filter((l) => l.offerId === r.offerId) };
    }),
  };
}

/** Adresse de l'image de fin d'annonce, si une est réglée. */
export async function promoPhotoUrl(sql: Db): Promise<string | null> {
  const { promoPhotoId } = await getListingSettings(sql);
  if (!promoPhotoId) return null;
  const [photo] = await sql<{ url: string }[]>`select url from photos where id = ${promoPhotoId} and kind = 'PROMO'`;
  return photo?.url ?? null;
}
