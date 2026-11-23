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
  strategy: z.enum(["FAST", "BALANCED", "MARGIN"]).default("BALANCED"),
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
  category: z.enum(["BULK", "LOT", "SINGLE", "PREMIUM"]).optional(),
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
export const priceHistoryQuery = z.object({ days: z.coerce.number().int().min(7).max(730).default(90) });

export const createSaleBody = z.strictObject({
  lines: z.array(z.strictObject({ offerId: z.uuid(), qty: z.number().int().min(1).max(10_000), unitPriceCents: cents })).min(1).max(100),
  shippingMode: z.enum(SHIPPING_MODES),
  shippingChargedCents: cents.optional(),
  buyerName: z.string().trim().min(1).max(120).optional(),
  addressLines: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
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
  .object({ kind: z.enum(["SCAN_FRONT", "SCAN_BACK", "LISTING", "BACKGROUND", "PROMO"]).default("SCAN_BACK"), source: z.uuid().optional() })
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
  promoPhotoId: z.uuid().nullable().default(null),
  autoCompose: z.boolean().default(true),
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

export const alertSettingsBody = z.strictObject({
  windowDays: z.number().int(), percent: z.number(), minChangeCents: z.number().int(),
});
export const priceMovesQuery = z.object({ alerts: z.enum(["true", "false"]).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export const stockQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(["ALL", "TO_PRICE", "READY", "LISTED", "DRAFT"]).default("ALL"),
  sort: z.enum(["value", "recent", "name"]).default("recent"),
  setId: z.string().min(1).max(40).optional(),
  location: z.string().min(1).max(60).optional(),
  condition: z.enum(["MT", "NM", "EX", "GD", "LP", "PL", "PO"]).optional(),
  minCents: z.coerce.number().int().min(0).optional(),
  maxCents: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const condition = z.enum(["MT", "NM", "EX", "GD", "LP", "PL", "PO"]);
export const batchId = z.uuid();
export const scanItemId = z.uuid();
export const createBatchBody = z.strictObject({
  name: z.string().max(80).optional(),
  locationCode: z.string().min(1).max(60),
  unitCostCents: cents.optional(),
  acquisitionLotId: z.uuid().optional(),
  defaultCondition: condition.nullable().optional(),
  language: z.string().regex(/^[a-z]{2}$/).optional(),
  paired: z.boolean().optional(),
  autopilot: z.boolean().optional(),
  publishMode: z.enum(["NONE", "NOW", "DAILY"]).optional(),
  publishPerDay: z.number().int().min(1).max(500).nullable().optional(),
});
export const updateBatchBody = z.strictObject({
  name: z.string().min(1).max(80).optional(),
  locationCode: z.string().min(1).max(60).optional(),
  unitCostCents: cents.optional(),
  defaultCondition: condition.nullable().optional(),
  autopilot: z.boolean().optional(),
  publishMode: z.enum(["NONE", "NOW", "DAILY"]).optional(),
  publishPerDay: z.number().int().min(1).max(500).nullable().optional(),
});
export const scanItemQuery = z.object({ position: z.coerce.number().int().min(1).max(100_000), fileName: z.string().min(1).max(200) });
export const updateScanItemBody = z.strictObject({
  catalogCardId: z.uuid().optional(),
  variantId: z.uuid().nullable().optional(),
  condition: condition.nullable().optional(),
  skipped: z.boolean().optional(),
});

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const planBody = z.strictObject({
  offerIds: z.array(z.uuid()).min(1).max(2000).optional(),
  channel: channelId,
  startOn: day,
  perDay: z.number().int().min(1).max(500),
});
export const cancelPlanBody = z.strictObject({ plannedOn: day.optional(), channel: channelId.optional(), offerId: z.uuid().optional() });

export const appSettingsBody = z.strictObject({
  onboardingDone: z.boolean().optional(),
  intakeMode: z.enum(["SCANNER", "CAMERA", "FILES"]).nullable().optional(),
  slipPaper: z.enum(["ROLL_80", "ROLL_58", "LABEL_100X150", "A4"]).optional(),
  seller: z.strictObject({ name: z.string().trim().max(80), address: z.string().trim().max(300), legal: z.string().trim().max(300) }).optional(),
});
const postage = z.number().int().min(0).max(100_000).nullable();
export const shippingCostsBody = z.strictObject({
  postage: z.strictObject({ LETTER_UNTRACKED: postage, LETTER_TRACKED: postage, PARCEL_TRACKED: postage }),
  supplies: z.strictObject({
    sleeveCents: z.number().int().min(0).max(100_000), toploaderCents: z.number().int().min(0).max(100_000), envelopeCents: z.number().int().min(0).max(100_000),
  }),
});
export const watchBody = z.strictObject({
  variantId: z.uuid(),
  targetCents: z.number().int().min(1).max(10_000_000).nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});
export const watchUpdateBody = watchBody.omit({ variantId: true });
export const watchedId = z.uuid();
export const catalogSearchQuery = z.object({ q: z.string().trim().max(80), language: z.string().regex(/^[a-z]{2}$/).optional() });
export const topCardsQuery = z.object({ limit: z.coerce.number().int().min(1).max(20).default(5) });
export const dealsQuery = z.object({
  minCents: z.coerce.number().int().min(100).max(10_000_000).default(1000),
  minDiscount: z.coerce.number().int().min(5).max(90).default(25),
  freshDays: z.coerce.number().int().min(1).max(14).default(3),
});
export const slipsPrintedBody = z.strictObject({ orderIds: z.array(z.uuid()).min(1).max(200) });

export const offerPhotoQuery = z.object({ kind: z.enum(["SCAN_FRONT", "SCAN_BACK"]).default("SCAN_FRONT") });
