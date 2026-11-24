import type { Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";
import { listPhotos, type PhotoRow } from "@dexlane/inventory";
import { listStock, type StockRow } from "./stock";

export interface CardVariantRow {
  id: string;
  finish: string;
  edition: string;
  subtype: string;
  stamp: string;
  incomplete: boolean;
  /** Exemplaires en stock de cette variante, tous états confondus. */
  onHand: number;
}

/** Un exemplaire physique (une position) de la carte, avec ce qu'il faut pour le retrouver et le vendre. */
export interface CardCopy {
  id: string;
  unitSku: string;
  offerId: string;
  offerSku: string;
  variantId: string;
  condition: string;
  locationCode: string;
  onHand: number;
  reserved: number;
  lifecycle: string;
  unitCostCents: number;
  createdAt: Date;
  /** Photo du recto de l'exemplaire, s'il a été scanné ou photographié. */
  photoUrl: string | null;
  /** Rang dans la pile scannée : dans la boîte, c'est là qu'il se trouve. */
  scan: { batchName: string; position: number } | null;
}

export interface CardSale {
  orderId: string;
  externalId: string;
  channel: string;
  orderedAt: Date;
  stage: string;
  variantId: string;
  condition: string;
  qty: number;
  unitPriceCents: number;
}

export interface CardDetail {
  card: {
    id: string; name: string; setId: string; setName: string | null; serieName: string | null; localNumber: string;
    officialCount: number | null; language: string; rarity: string | null; category: string | null; imageUrl: string | null;
  };
  variants: CardVariantRow[];
  /** Une ligne par offre (variante × état) : prix, statut, annonces. */
  /** Offres en stock, avec les photos (recto, verso) de leur exemplaire. */
  offers: (StockRow & { photos: PhotoRow[] })[];
  copies: CardCopy[];
  sales: CardSale[];
  totals: { copies: number; valueCents: number; costCents: number; soldCards: number; soldCents: number };
}

/**
 * Tout ce qui concerne une carte du catalogue au même endroit : ses variantes, toutes ses offres (une par variante et
 * par état), chacun de ses exemplaires en stock, et ses ventes.
 */
export async function getCardDetail(sql: Db, cardId: string): Promise<CardDetail> {
  const [card] = await sql<CardDetail["card"][]>`
    select c.id, c.name, c.set_id, st.name as set_name, st.serie_name, c.local_number, st.card_count_official as official_count,
           c.language, c.rarity, c.category, c.image_url
      from catalog_cards c
      left join catalog_sets st on st.id = c.set_id and st.language = c.language
     where c.id = ${cardId}`;
  if (!card) throw new DomainError("CARD_NOT_FOUND", `catalog card ${cardId} does not exist`);
  const [variants, offers, copies, sales] = await Promise.all([
    sql<CardVariantRow[]>`
      select v.id, v.finish, v.edition, v.subtype, v.stamp, v.incomplete,
             coalesce((select sum(i.on_hand)::int from offers o join stock_items i on i.offer_id = o.id
                        where o.variant_id = v.id and i.lifecycle <> 'ARCHIVED'), 0) as on_hand
        from card_variants v where v.catalog_card_id = ${cardId}
       order by v.finish, v.edition, v.subtype`,
    listStock(sql, { cardId, sort: "value", limit: 200 }).then((p) => p.items),
    sql<CardCopy[]>`
      select i.id, i.unit_sku, o.id as offer_id, o.offer_sku, o.variant_id, o.condition, l.code as location_code, i.on_hand, i.reserved,
             i.lifecycle::text as lifecycle, i.unit_cost_cents, i.created_at,
             (select p.url from photos p where p.stock_item_id = i.id and p.kind = 'SCAN_FRONT' order by p.created_at limit 1) as photo_url,
             (select jsonb_build_object('batchName', b.name, 'position', si.position)
                from scan_items si join scan_batches b on b.id = si.batch_id where si.stock_item_id = i.id limit 1) as scan
        from stock_items i
        join offers o on o.id = i.offer_id
        join card_variants v on v.id = o.variant_id
        join locations l on l.id = i.location_id
       where v.catalog_card_id = ${cardId} and i.lifecycle <> 'ARCHIVED' and i.on_hand > 0
       order by l.code, i.unit_sku`,
    sql<CardSale[]>`
      select ord.id as order_id, ord.external_id, ord.channel, ord.ordered_at, ord.fulfillment_status as stage, o.variant_id, o.condition,
             ol.qty, ol.unit_price_cents
        from order_lines ol
        join orders ord on ord.id = ol.order_id
        join offers o on o.id = ol.offer_id
        join card_variants v on v.id = o.variant_id
       where v.catalog_card_id = ${cardId} and ord.fulfillment_status <> 'CANCELLED'
       order by ord.ordered_at desc
       limit 50`,
  ]);
  const photos = offers.length ? await listPhotos(sql, { offerIds: offers.map((o) => o.offerId) }) : [];
  const withPhotos = offers.map((o) => ({ ...o, photos: photos.filter((p) => p.offerId === o.offerId && (p.kind === "SCAN_FRONT" || p.kind === "SCAN_BACK")) }));
  return {
    card, variants, offers: withPhotos, copies, sales,
    totals: {
      copies: copies.reduce((sum, c) => sum + c.onHand, 0),
      valueCents: offers.reduce((sum, o) => sum + o.onHand * (o.targetPriceCents ?? o.suggestedPriceCents ?? 0), 0),
      costCents: copies.reduce((sum, c) => sum + c.onHand * c.unitCostCents, 0),
      soldCards: sales.reduce((sum, s) => sum + s.qty, 0),
      soldCents: sales.reduce((sum, s) => sum + s.qty * s.unitPriceCents, 0),
    },
  };
}
