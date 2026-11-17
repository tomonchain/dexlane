import { z } from "zod";
import { CARD_CONDITIONS, type LocationRef } from "@dexlane/inventory";

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
