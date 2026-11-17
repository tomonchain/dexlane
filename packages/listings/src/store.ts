import { withTx, type Db } from "@dexlane/db";
import { listPhotos, type CardCondition, type PhotoRow } from "@dexlane/inventory";
import { DomainError } from "@dexlane/shared";
import {
  DEFAULT_LISTING_SETTINGS, buildListingText, validateListingSettings, type ListingSettings, type ListingSubject, type ListingText,
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
    const before = await getListingSettings(tx);
    await tx`
      insert into listing_settings (settings) values (${tx.json(settings as never)})
      on conflict (id) do update set settings = excluded.settings, updated_at = now()`;
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
  /** Scans (recto, verso) et visuels d'annonce déjà composés. */
  photos: PhotoRow[];
}

type OfferRow = ListingSubject & Pick<ListingOffer, "offerId" | "imageUrl" | "category" | "isUnique" | "available" | "variantIncomplete">;

/** Offres ayant du stock vendable, les plus chères d'abord : ce sont elles qu'on publie. */
export async function listListingOffers(
  sql: Db,
  opts: { q?: string; offerId?: string; limit?: number; offset?: number } = {},
): Promise<{ items: ListingOffer[]; total: number }> {
  const q = opts.q?.trim();
  const rows = await sql<(OfferRow & { total: number })[]>`
    select o.id as offer_id, o.offer_sku, o.condition, o.category, o.is_unique, o.target_price_cents,
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
     where stock.available > 0
       ${opts.offerId ? sql`and o.id = ${opts.offerId}` : sql``}
       ${q ? sql`and (c.name ilike ${`%${q}%`} or o.offer_sku ilike ${`%${q}%`})` : sql``}
     order by o.target_price_cents desc nulls last, c.name, o.offer_sku
     limit ${Math.min(opts.limit ?? 50, 200)} offset ${opts.offset ?? 0}`;
  const settings = await getListingSettings(sql);
  const photos = await listPhotos(sql, { offerIds: rows.map((r) => r.offerId) });
  return {
    total: rows[0]?.total ?? 0,
    items: rows.map(({ total: _total, ...r }) => ({
      offerId: r.offerId, offerSku: r.offerSku, cardName: r.name, imageUrl: r.imageUrl, condition: r.condition, category: r.category,
      isUnique: r.isUnique, targetPriceCents: r.targetPriceCents, available: r.available, variantIncomplete: r.variantIncomplete,
      text: buildListingText(r, settings),
      photos: photos.filter((p) => p.offerId === r.offerId),
    })),
  };
}
