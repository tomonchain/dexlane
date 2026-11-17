import { z } from "zod";
import { CARD_CONDITIONS, SHIPPING_MODES, type LocationRef } from "@dexlane/inventory";

const cents = z.number().int().min(0).max(2_000_000_000);
const location = {
  locationId: z.uuid().optional(),
  locationCode: z.string().trim().min(1).max(80).optional(),
};
const oneLocation = (v: { locationId?: string; locationCode?: string }) => (v.locationId === undefined) !== (v.locationCode === undefined);
const oneLocationMessage = { message: "provide exactly one of locationId or locationCode", path: ["locationCode"] };

export const toLocationRef = (v: { locationId?: string; locationCode?: string }): LocationRef =>
  v.locationId !== undefined ? { id: v.locationId } : { code: v.locationCode! };

export const stockItemId = z.uuid();
/** Photos de scan à rattacher à la position créée (recto, verso). */
const photoIds = z.array(z.uuid()).max(6).optional();

export const receiveCardBody = z
  .strictObject({
    variantId: z.uuid(),
    condition: z.enum(CARD_CONDITIONS),
    quantity: z.number().int().min(1).max(10_000),
    ...location,
    unitCostCents: cents,
    acquisitionLotId: z.uuid().optional(),
    unique: z.boolean().optional(),
    draft: z.boolean().optional(),
    photoIds,
  })
  .refine(oneLocation, oneLocationMessage);

export const receiveBulkBody = z
  .strictObject({
    descriptor: z.strictObject({
      setId: z.string().trim().min(1).max(40).optional(),
      era: z.string().trim().min(1).max(80).optional(),
      cardType: z.string().trim().min(1).max(80),
      rarityBand: z.string().trim().min(1).max(80).optional(),
      language: z.string().trim().regex(/^[A-Za-z]{2}(-[A-Za-z]{2})?$/).optional(),
      label: z.string().trim().min(1).max(120).optional(),
    }),
    quantity: z.number().int().min(1).max(1_000_000),
    ...location,
    totalCostCents: cents,
    acquisitionLotId: z.uuid().optional(),
  })
  .refine(oneLocation, oneLocationMessage);

export const extractBody = z
  .strictObject({
    variantId: z.uuid(),
    condition: z.enum(CARD_CONDITIONS),
    quantity: z.number().int().min(1).max(10_000),
    ...location,
    unique: z.boolean().optional(),
    draft: z.boolean().optional(),
    photoIds,
  })
  .refine(oneLocation, oneLocationMessage);

export const moveBody = z.strictObject(location).refine(oneLocation, oneLocationMessage);

export const adjustBody = z.strictObject({
  countedOnHand: z.number().int().min(0).max(1_000_000),
  reason: z.string().trim().min(1).max(500),
});

export const createLocationBody = z.strictObject({
  code: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(200).optional(),
});

export const createAcquisitionLotBody = z.strictObject({
  sourceType: z.string().trim().min(1).max(80),
  sellerRef: z.string().trim().min(1).max(200).optional(),
  purchaseDate: z.iso.date(),
  totalCostCents: cents,
  shippingCostCents: cents.optional(),
});

const language = z.string().trim().toLowerCase().regex(/^[a-z]{2}(-[a-z]{2})?$/);

export const inventoryQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  set: z.string().trim().min(1).max(40).optional(),
  language: language.optional(),
  condition: z.enum(CARD_CONDITIONS).optional(),
  kind: z.enum(["UNIQUE", "FUNGIBLE", "BULK"]).optional(),
  lifecycle: z.enum(["DRAFT", "ACTIVE", "ARCHIVED", "ALL"]).optional(),
  location: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const catalogQuery = z
  .object({
    language: language.default("fr"),
    name: z.string().trim().min(1).max(100).optional(),
    number: z.string().trim().min(1).max(30).optional(),
    set: z.string().trim().min(1).max(40).optional(),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  })
  .refine((v) => v.name !== undefined || v.number !== undefined || v.set !== undefined, {
    message: "provide at least one of name, number or set",
    path: ["name"],
  });

export const scanQuery = z.object({ language: language.default("fr") });

export const languageBody = z.strictObject({ language: language.default("fr") });
export const languageQuery = z.object({ language: language.default("fr") });
export const setId = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9.-]{0,39}$/);

export const createLocationsBody = z.strictObject({ codes: z.array(z.string().trim().min(1).max(80)).min(1).max(200) });
export const updateLocationBody = z.strictObject({ description: z.string().trim().max(200).nullable() });
export const locationId = z.uuid();

const password = z.string().min(1).max(200);
export const verifyPasswordBody = z.strictObject({ password });
export const resetPasswordBody = z.strictObject({ newPassword: password });
export const changePasswordBody = z.strictObject({ currentPassword: password, newPassword: password });

const percent = z.number().int().min(0).max(200);
export const pricingSettingsBody = z.strictObject({
  basis: z.enum(["LISTED_TREND", "SOLD_AVG_30D", "SOLD_AVG_7D", "LISTED_LOW"]),
  maxAgeDays: z.number().int().min(1).max(365),
  conditionPercent: z.strictObject({ MT: percent, NM: percent, EX: percent, GD: percent, LP: percent, PL: percent, PO: percent }),
  bulkBelowCents: cents,
  lotBelowCents: cents,
  singleFromCents: cents,
  premiumFromCents: cents,
  floorPercent: z.number().int().min(0).max(100),
  minMarginCents: cents,
  driftPercent: z.number().int().min(1).max(100),
  roundFromCents: cents,
  roundStepCents: z.number().int().min(1).max(100_000),
});
export const setOfferPriceBody = z.strictObject({
  targetPriceCents: cents,
  floorPriceCents: cents.optional(),
  category: z.enum(["BULK", "LOT", "SINGLE", "PREMIUM"]),
});
export const pricingOffersQuery = z.object({
  status: z.enum(["REVIEW", "ALL"]).default("ALL"),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export const variantQuoteQuery = z.object({
  condition: z.enum(CARD_CONDITIONS),
  unique: z.enum(["true", "false"]).default("false"),
});
export const offerId = z.uuid();
export const variantId = z.uuid();

export const createSaleBody = z.strictObject({
  lines: z.array(z.strictObject({ offerId: z.uuid(), qty: z.number().int().min(1).max(10_000), unitPriceCents: cents })).min(1).max(100),
  shippingMode: z.enum(SHIPPING_MODES),
  shippingChargedCents: cents.optional(),
  buyerName: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().min(1).max(500).optional(),
});
export const ordersQuery = z.object({
  stage: z.enum(["TO_PREPARE", "PACKED", "SHIPPED", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export const orderId = z.uuid();
export const pickBody = z.strictObject({ allocationId: z.uuid(), unitSku: z.string().trim().min(1).max(40) });
export const handoverBody = z.strictObject({
  tracking: z.string().trim().min(1).max(80).optional(),
  postageCostCents: cents.optional(),
});
export const cancelOrderBody = z.strictObject({ reason: z.string().trim().min(1).max(300) });
export const sellableQuery = z.object({ q: z.string().trim().min(1).max(100).optional() });

export const photoQuery = z
  .object({ kind: z.enum(["SCAN_FRONT", "SCAN_BACK", "LISTING", "BACKGROUND"]).default("SCAN_BACK"), source: z.uuid().optional() })
  .refine((q) => (q.kind === "LISTING") === (q.source !== undefined), "source is required for a LISTING photo, and only for it");
export const photoId = z.uuid();

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const listingSettingsBody = z.strictObject({
  titleTemplate: z.string().max(300),
  descriptionTemplate: z.string().max(4000),
  photo: z.strictObject({
    background: z.discriminatedUnion("type", [
      z.strictObject({ type: z.literal("color"), color: hex }),
      z.strictObject({ type: z.literal("gradient"), from: hex, to: hex, angle: z.number().min(0).max(360) }),
      z.strictObject({ type: z.literal("image"), photoId: z.uuid() }),
    ]),
    size: z.number().int(),
    marginPercent: z.number(),
    trimPercent: z.number(),
    roundCorners: z.boolean(),
    shadow: z.boolean(),
    caption: z.string().max(60),
  }),
});
export const listingOffersQuery = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const channelId = z.enum(["ebay", "cardtrader"]);
export const channelModeBody = z.strictObject({ mode: z.enum(["OFF", "SIMULATION", "LIVE"]) });
export const publishBody = z.strictObject({ channel: channelId });
export const listingId = z.uuid();
export const simulateOrderBody = z.strictObject({ qty: z.number().int().min(1).max(100).default(1) });
