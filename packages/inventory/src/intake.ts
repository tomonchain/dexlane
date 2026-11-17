import { withTx, type Db } from "@dexlane/db";
import { DomainError, assertCents } from "@dexlane/shared";
import type { CardCondition, StockItemRow } from "./internal";
import { resolveLocation, type LocationRef } from "./locations";
import { buildOfferSku, nextUnitSku } from "./sku";
import { extractFromBulk, receiveStock } from "./stock";

// ───────────────────────── Lots d'acquisition ─────────────────────────

export interface AcquisitionLotRow {
  id: string;
  sourceType: string;
  sellerRef: string | null;
  purchaseDate: string;
  totalCostCents: number;
  shippingCostCents: number;
  createdAt: Date;
}

export interface CreateAcquisitionLotInput {
  /** Collection personnelle, particulier, boutique, salon… */
  sourceType: string;
  sellerRef?: string;
  /** AAAA-MM-JJ. */
  purchaseDate: string;
  totalCostCents: number;
  shippingCostCents?: number;
}

const lotColumns = (sql: Db) =>
  sql`id, source_type, seller_ref, purchase_date::text as purchase_date, total_cost_cents, shipping_cost_cents, created_at`;

export async function createAcquisitionLot(sql: Db, input: CreateAcquisitionLotInput): Promise<AcquisitionLotRow> {
  assertCents(input.totalCostCents, "totalCostCents");
  assertCents(input.shippingCostCents ?? 0, "shippingCostCents");
  const [row] = await sql<AcquisitionLotRow[]>`
    insert into acquisition_lots (source_type, seller_ref, purchase_date, total_cost_cents, shipping_cost_cents)
    values (${input.sourceType}, ${input.sellerRef ?? null}, ${input.purchaseDate}, ${input.totalCostCents},
            ${input.shippingCostCents ?? 0})
    returning ${lotColumns(sql)}`;
  return row!;
}

export function listAcquisitionLots(sql: Db, limit = 100): Promise<AcquisitionLotRow[]> {
  return sql<AcquisitionLotRow[]>`
    select ${lotColumns(sql)} from acquisition_lots order by purchase_date desc, created_at desc limit ${limit}`;
}

async function assertLotExists(tx: Db, acquisitionLotId: string | undefined): Promise<void> {
  if (!acquisitionLotId) return;
  const [lot] = await tx`select 1 from acquisition_lots where id = ${acquisitionLotId}`;
  if (!lot) throw new DomainError("ACQUISITION_LOT_NOT_FOUND", `acquisition lot ${acquisitionLotId} does not exist`);
}

// ───────────────────────── Offres ─────────────────────────

export interface OfferRef {
  id: string;
  offerSku: string;
  isUnique: boolean;
  /** false si l'offre interchangeable (variante + état) existait déjà : la position s'y ajoute. */
  created: boolean;
}

interface VariantInfo {
  id: string;
  incomplete: boolean;
  finish: string;
  edition: string;
  promo: boolean;
  stamp: string;
  subtype: string;
  size: string;
  setId: string;
  localNumber: string;
  language: string;
}

async function loadVariant(tx: Db, variantId: string): Promise<VariantInfo> {
  const [v] = await tx<VariantInfo[]>`
    select v.id, v.incomplete, v.finish, v.edition, v.promo, v.stamp, v.subtype, v.size,
           c.set_id, c.local_number, c.language
      from card_variants v join catalog_cards c on c.id = v.catalog_card_id
     where v.id = ${variantId}`;
  if (!v) throw new DomainError("VARIANT_NOT_FOUND", `card variant ${variantId} does not exist`);
  return v;
}

/**
 * Offre d'une variante dans un état donné.
 * - Interchangeable : une seule par (variante, état), créée au besoin, sans course possible (index unique partiel).
 * - Unique : toujours une nouvelle offre, suffixée par le numéro de l'exemplaire (`…-U000123`).
 * Une nouvelle offre naît `DRAFT` / `REVIEW` : prix et catégorie viennent au Sprint 2.
 */
async function ensureOffer(
  tx: Db,
  variant: VariantInfo,
  condition: CardCondition,
  unique: { unitNumber: number } | null,
): Promise<OfferRef> {
  const base = buildOfferSku({ ...variant, condition }) + (unique ? `-U${String(unique.unitNumber).padStart(6, "0")}` : "");
  for (let attempt = 1; attempt <= 20; attempt++) {
    const offerSku = attempt === 1 ? base : `${base}-${attempt}`;
    const [inserted] = await tx<{ id: string; offerSku: string }[]>`
      insert into offers (offer_sku, variant_id, condition, is_unique)
      values (${offerSku}, ${variant.id}, ${condition}, ${unique !== null})
      on conflict do nothing
      returning id, offer_sku`;
    if (inserted) return { ...inserted, isUnique: unique !== null, created: true };
    if (!unique) {
      const [existing] = await tx<{ id: string; offerSku: string }[]>`
        select id, offer_sku from offers
         where variant_id = ${variant.id} and condition = ${condition} and not is_unique`;
      if (existing) return { ...existing, isUnique: false, created: false };
    }
    // Sinon : le SKU lisible est déjà pris par une autre variante (codes de variante identiques) → suffixe.
  }
  throw new Error(`could not generate a free offer SKU from ${base}`);
}

// ───────────────────────── Entrée d'une carte identifiée (Parcours A) ─────────────────────────

export interface ReceiveCardInput {
  /** Variante confirmée par l'opérateur (langue, série, numéro, finition, édition). */
  variantId: string;
  condition: CardCondition;
  quantity: number;
  location: LocationRef;
  unitCostCents: number;
  acquisitionLotId?: string;
  /** Exemplaire individualisé (forte valeur, photos réelles) : sa propre offre, quantité 1. */
  unique?: boolean;
  /** Laisse la position en `DRAFT` (non vendable) : identification ou état à revoir plus tard. */
  draft?: boolean;
  actor: string;
}

export interface ReceivedPosition {
  stockItem: StockItemRow;
  offer: OfferRef;
  locationCode: string;
  /** Variante incomplète ou déduite dans le catalogue : à confirmer avant toute publication. */
  variantIncomplete: boolean;
}

/**
 * Entrée en stock d'une carte identifiée : rattache (ou crée) l'offre, attribue le `unit_sku`,
 * crée la position à l'emplacement donné. Toujours une nouvelle position : une position reste homogène
 * (même offre, emplacement, lot et coût) et porte son propre QR.
 */
export async function receiveCard(sql: Db, input: ReceiveCardInput): Promise<ReceivedPosition> {
  if (input.unique && input.quantity !== 1) {
    throw new DomainError("INVALID_QUANTITY", "a unique copy is received one at a time");
  }
  return withTx(sql, async (tx) => {
    const variant = await loadVariant(tx, input.variantId);
    const location = await resolveLocation(tx, input.location);
    await assertLotExists(tx, input.acquisitionLotId);
    const { unitSku, n } = await nextUnitSku(tx);
    const offer = await ensureOffer(tx, variant, input.condition, input.unique ? { unitNumber: n } : null);
    const stockItem = await receiveStock(tx, {
      unitSku,
      kind: input.unique ? "UNIQUE" : "FUNGIBLE",
      offerId: offer.id,
      locationId: location.id,
      acquisitionLotId: input.acquisitionLotId,
      unitCostCents: input.unitCostCents,
      quantity: input.quantity,
      activate: !input.draft,
      actor: input.actor,
    });
    return { stockItem, offer, locationCode: location.code, variantIncomplete: variant.incomplete };
  });
}

// ───────────────────────── Vrac (Parcours B) ─────────────────────────

export interface BulkDescriptorInput {
  /** Série (identifiant catalogue) ou époque (« EV », « Épée et Bouclier ») ; les deux sont facultatifs. */
  setId?: string;
  era?: string;
  /** communes, peu communes, holos, énergies… */
  cardType: string;
  rarityBand?: string;
  language?: string;
  label?: string;
}

export interface BulkDescriptorRow {
  id: string;
  setId: string | null;
  era: string | null;
  cardType: string;
  rarityBand: string | null;
  language: string | null;
  label: string;
}

const clean = (s: string | undefined) => s?.trim() || null;

async function ensureBulkDescriptor(tx: Db, d: BulkDescriptorInput): Promise<BulkDescriptorRow> {
  const cardType = d.cardType.trim().toLowerCase();
  if (!cardType) throw new DomainError("INVALID_BULK_DESCRIPTOR", "cardType is required");
  const key = {
    setId: clean(d.setId)?.toLowerCase() ?? null,
    era: clean(d.era),
    rarityBand: clean(d.rarityBand)?.toLowerCase() ?? null,
    language: clean(d.language)?.toLowerCase() ?? null,
  };
  const label =
    clean(d.label) ??
    [cardType.charAt(0).toUpperCase() + cardType.slice(1), key.setId ?? key.era, key.rarityBand, key.language?.toUpperCase()]
      .filter(Boolean)
      .join(" · ");
  const columns = tx`id, set_id, era, card_type, rarity_band, language, label`;
  const [inserted] = await tx<BulkDescriptorRow[]>`
    insert into bulk_descriptors (set_id, era, card_type, rarity_band, language, label)
    values (${key.setId}, ${key.era}, ${cardType}, ${key.rarityBand}, ${key.language}, ${label})
    on conflict (set_id, era, card_type, rarity_band, language) do nothing
    returning ${columns}`;
  if (inserted) return inserted;
  const [existing] = await tx<BulkDescriptorRow[]>`
    select ${columns} from bulk_descriptors
     where set_id is not distinct from ${key.setId} and era is not distinct from ${key.era}
       and card_type = ${cardType} and rarity_band is not distinct from ${key.rarityBand}
       and language is not distinct from ${key.language}`;
  return existing!;
}

export interface ReceiveBulkInput {
  descriptor: BulkDescriptorInput;
  /** Nombre de cartes compté ou estimé à la pesée. */
  quantity: number;
  location: LocationRef;
  /** Coût total du lot ; le coût unitaire stocké est arrondi au centime. */
  totalCostCents: number;
  acquisitionLotId?: string;
  actor: string;
}

export interface ReceivedBulk {
  stockItem: StockItemRow;
  descriptor: BulkDescriptorRow;
  locationCode: string;
}

/** Enregistre un lot agrégé en une seule position, sans identité individuelle des cartes. */
export async function receiveBulk(sql: Db, input: ReceiveBulkInput): Promise<ReceivedBulk> {
  assertCents(input.totalCostCents, "totalCostCents");
  if (input.totalCostCents < 0) throw new DomainError("INVALID_COST", "totalCostCents must not be negative");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new DomainError("INVALID_QUANTITY", "quantity must be a positive integer");
  }
  return withTx(sql, async (tx) => {
    const location = await resolveLocation(tx, input.location);
    await assertLotExists(tx, input.acquisitionLotId);
    const descriptor = await ensureBulkDescriptor(tx, input.descriptor);
    const { unitSku } = await nextUnitSku(tx);
    const stockItem = await receiveStock(tx, {
      unitSku,
      kind: "BULK",
      bulkDescriptorId: descriptor.id,
      locationId: location.id,
      acquisitionLotId: input.acquisitionLotId,
      unitCostCents: Math.round(input.totalCostCents / input.quantity),
      quantity: input.quantity,
      activate: true,
      actor: input.actor,
    });
    return { stockItem, descriptor, locationCode: location.code };
  });
}

export interface ExtractCardFromBulkInput {
  bulkStockItemId: string;
  variantId: string;
  condition: CardCondition;
  quantity: number;
  location: LocationRef;
  unique?: boolean;
  draft?: boolean;
  actor: string;
}

/** Sort des cartes identifiées d'un lot de vrac vers une position individualisée (Parcours B.5). */
export async function extractCardFromBulk(sql: Db, input: ExtractCardFromBulkInput): Promise<ReceivedPosition> {
  if (input.unique && input.quantity !== 1) {
    throw new DomainError("INVALID_QUANTITY", "a unique copy is extracted one at a time");
  }
  return withTx(sql, async (tx) => {
    const variant = await loadVariant(tx, input.variantId);
    const location = await resolveLocation(tx, input.location);
    const { unitSku, n } = await nextUnitSku(tx);
    const offer = await ensureOffer(tx, variant, input.condition, input.unique ? { unitNumber: n } : null);
    const stockItem = await extractFromBulk(tx, {
      bulkStockItemId: input.bulkStockItemId,
      quantity: input.quantity,
      target: {
        unitSku,
        kind: input.unique ? "UNIQUE" : "FUNGIBLE",
        offerId: offer.id,
        locationId: location.id,
        activate: !input.draft,
      },
      actor: input.actor,
    });
    return { stockItem, offer, locationCode: location.code, variantIncomplete: variant.incomplete };
  });
}
