import type { Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";
import type { EbayClient } from "./api";

/** Sites eBay en euros (les prix de Dexlane sont en euros). */
export const EBAY_MARKETPLACES = {
  EBAY_FR: { label: "eBay.fr", language: "fr-FR", currency: "EUR", siteId: 71, web: "https://www.ebay.fr", country: "FR" },
  EBAY_DE: { label: "eBay.de", language: "de-DE", currency: "EUR", siteId: 77, web: "https://www.ebay.de", country: "DE" },
  EBAY_IT: { label: "eBay.it", language: "it-IT", currency: "EUR", siteId: 101, web: "https://www.ebay.it", country: "IT" },
  EBAY_ES: { label: "eBay.es", language: "es-ES", currency: "EUR", siteId: 186, web: "https://www.ebay.es", country: "ES" },
} as const;
export type EbayMarketplaceId = keyof typeof EBAY_MARKETPLACES;
export const isEbayMarketplace = (value: string): value is EbayMarketplaceId => value in EBAY_MARKETPLACES;

/** Catégorie « Cartes à l'unité » des jeux de cartes à collectionner (CCG Individual Cards). */
export const DEFAULT_CATEGORY_ID = "183454";
/** Lieu d'expédition créé par Dexlane quand le compte n'en a pas. */
export const DEXLANE_LOCATION_KEY = "DEXLANE";

export interface EbaySettings {
  marketplaceId: EbayMarketplaceId;
  categoryId: string;
  fulfillmentPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
  /** Lieu d'expédition (inventory location) d'où partent les cartes. */
  merchantLocationKey: string | null;
}

export const DEFAULT_EBAY_SETTINGS: EbaySettings = {
  marketplaceId: "EBAY_FR", categoryId: DEFAULT_CATEGORY_ID,
  fulfillmentPolicyId: null, paymentPolicyId: null, returnPolicyId: null, merchantLocationKey: null,
};

type StoredConfig = { settings?: Partial<EbaySettings> } & Record<string, unknown>;

async function storedConfig(sql: Db): Promise<StoredConfig> {
  const [row] = await sql<{ config: StoredConfig }[]>`select config from channel_settings where channel = 'ebay'`;
  return row?.config ?? {};
}

/** Remplace une clé du réglage du canal eBay (la ligne est créée au besoin, canal éteint). */
export async function writeEbayConfig(sql: Db, key: string, value: unknown): Promise<void> {
  await sql`
    insert into channel_settings (channel, config) values ('ebay', jsonb_build_object(${key}::text, ${sql.json(value as never)}::jsonb))
    on conflict (channel) do update set config = channel_settings.config || jsonb_build_object(${key}::text, ${sql.json(value as never)}::jsonb),
                                        updated_at = now()`;
}

export async function readEbayConfig<T>(sql: Db, key: string): Promise<T | undefined> {
  return (await storedConfig(sql))[key] as T | undefined;
}

export async function getEbaySettings(sql: Db): Promise<EbaySettings> {
  const stored = (await storedConfig(sql)).settings ?? {};
  const settings = { ...DEFAULT_EBAY_SETTINGS, ...stored };
  return isEbayMarketplace(settings.marketplaceId) ? settings : { ...settings, marketplaceId: DEFAULT_EBAY_SETTINGS.marketplaceId };
}

export async function saveEbaySettings(sql: Db, change: Partial<EbaySettings>, actor: string): Promise<EbaySettings> {
  if (change.marketplaceId !== undefined && !isEbayMarketplace(change.marketplaceId)) {
    throw new DomainError("INVALID_EBAY_SETTINGS", "site eBay inconnu");
  }
  if (change.categoryId !== undefined && !/^\d{1,10}$/.test(change.categoryId)) throw new DomainError("INVALID_EBAY_SETTINGS", "numéro de catégorie invalide");
  const before = await getEbaySettings(sql);
  // Les règles de vente appartiennent à un site : en changer remet le choix à zéro.
  const reset = change.marketplaceId && change.marketplaceId !== before.marketplaceId
    ? { fulfillmentPolicyId: null, paymentPolicyId: null, returnPolicyId: null } : {};
  const next: EbaySettings = { ...before, ...reset, ...change };
  await writeEbayConfig(sql, "settings", next);
  await sql`
    insert into audit_events (actor, action, entity, entity_id, before, after)
    values (${actor}, 'channel_settings_changed', 'channel', 'ebay', ${sql.json(before as never)}, ${sql.json(next as never)})`;
  return next;
}

/** Ce qui manque pour publier : vide quand le canal est prêt. */
export function missingEbaySettings(s: EbaySettings): string[] {
  return [
    !s.fulfillmentPolicyId && "FULFILLMENT_POLICY",
    !s.paymentPolicyId && "PAYMENT_POLICY",
    !s.returnPolicyId && "RETURN_POLICY",
    !s.merchantLocationKey && "LOCATION",
  ].filter(Boolean) as string[];
}

// ───────────────────────── Ce que le compte eBay propose ─────────────────────────

export interface EbayChoice { id: string; name: string }
export interface EbayLocation { key: string; name: string | null; city: string | null; postalCode: string | null; enabled: boolean }

export interface EbayAccountOptions {
  /** Le compte gère ses règles de vente (programme « Business Policies ») ; sinon, aucune n'est listée. */
  policiesEnabled: boolean;
  fulfillmentPolicies: EbayChoice[];
  paymentPolicies: EbayChoice[];
  returnPolicies: EbayChoice[];
  locations: EbayLocation[];
}

const SELLING_POLICIES = "SELLING_POLICY_MANAGEMENT";

async function policiesEnabled(client: EbayClient): Promise<boolean> {
  const r = await client.request<{ programs?: { programType: string }[] }>("GET", "/sell/account/v1/program/get_opted_in_programs");
  return (r?.programs ?? []).some((p) => p.programType === SELLING_POLICIES);
}

/** Règles de vente et lieux d'expédition du compte, pour le site choisi. */
export async function ebayAccountOptions(client: EbayClient, settings: EbaySettings): Promise<EbayAccountOptions> {
  const enabled = await policiesEnabled(client);
  const m = encodeURIComponent(settings.marketplaceId);
  const [fulfillment, payment, returns, locations] = await Promise.all([
    enabled ? client.request<{ fulfillmentPolicies?: { fulfillmentPolicyId: string; name: string }[] }>("GET", `/sell/account/v1/fulfillment_policy?marketplace_id=${m}`) : null,
    enabled ? client.request<{ paymentPolicies?: { paymentPolicyId: string; name: string }[] }>("GET", `/sell/account/v1/payment_policy?marketplace_id=${m}`) : null,
    enabled ? client.request<{ returnPolicies?: { returnPolicyId: string; name: string }[] }>("GET", `/sell/account/v1/return_policy?marketplace_id=${m}`) : null,
    client.request<{ locations?: RawLocation[] }>("GET", "/sell/inventory/v1/location?limit=100"),
  ]);
  return {
    policiesEnabled: enabled,
    fulfillmentPolicies: (fulfillment?.fulfillmentPolicies ?? []).map((p) => ({ id: p.fulfillmentPolicyId, name: p.name })),
    paymentPolicies: (payment?.paymentPolicies ?? []).map((p) => ({ id: p.paymentPolicyId, name: p.name })),
    returnPolicies: (returns?.returnPolicies ?? []).map((p) => ({ id: p.returnPolicyId, name: p.name })),
    locations: (locations?.locations ?? []).map((l) => ({
      key: l.merchantLocationKey, name: l.name ?? null, city: l.location?.address?.city ?? null,
      postalCode: l.location?.address?.postalCode ?? null, enabled: l.merchantLocationStatus !== "DISABLED",
    })),
  };
}

interface RawLocation {
  merchantLocationKey: string;
  name?: string;
  merchantLocationStatus?: string;
  location?: { address?: { city?: string; postalCode?: string; country?: string } };
}

export interface EbayShippingService { code: string; description: string; category: string | null }

/** Services d'envoi nationaux proposés par le site (l'API REST ne les liste pas : on passe par l'API Trading). */
export async function ebayShippingServices(client: EbayClient, marketplaceId: EbayMarketplaceId): Promise<EbayShippingService[]> {
  const xml = await client.trading("GeteBayDetails", EBAY_MARKETPLACES[marketplaceId].siteId, "<DetailName>ShippingServiceDetails</DetailName>");
  return parseShippingServices(xml);
}

export function parseShippingServices(xml: string): EbayShippingService[] {
  const tag = (block: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1]?.trim() ?? null;
  const services: EbayShippingService[] = [];
  for (const [, block] of xml.matchAll(/<ShippingServiceDetails>([\s\S]*?)<\/ShippingServiceDetails>/g)) {
    const code = tag(block!, "ShippingService");
    if (!code || tag(block!, "ValidForSellingFlow") !== "true" || tag(block!, "InternationalService") === "true") continue;
    services.push({ code, description: decodeXml(tag(block!, "Description") ?? code), category: tag(block!, "ShippingCategory") });
  }
  return services.sort((a, b) => a.description.localeCompare(b.description, "fr"));
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// ───────────────────────── Mise en place ─────────────────────────

export interface EbayDefaultsInput {
  shippingServiceCode: string;
  /** Frais de port facturés à l'acheteur, en centimes (0 : livraison gratuite). */
  shippingCostCents: number;
  /** Délai de préparation annoncé, en jours ouvrés. */
  handlingDays: number;
  /** Délai de rétractation accordé, en jours (14 au minimum pour un vendeur professionnel dans l'UE). */
  returnDays: 14 | 30 | 60;
  postalCode: string;
  city: string;
}

const NAMES = { fulfillment: "Dexlane – Envoi", payment: "Dexlane – Paiement", returns: "Dexlane – Retours" } as const;
const ALL_CATEGORIES = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }];

/**
 * Crée ce qui manque pour publier — règles d'envoi, de paiement et de retour, lieu d'expédition — et les retient.
 * Ce qui est déjà choisi est gardé ; une règle Dexlane déjà présente sur le compte est réutilisée.
 */
export async function createEbayDefaults(sql: Db, client: EbayClient, input: EbayDefaultsInput, actor: string): Promise<EbaySettings> {
  if (!input.shippingServiceCode.trim()) throw new DomainError("INVALID_EBAY_SETTINGS", "choisissez un service d'envoi");
  if (!Number.isInteger(input.shippingCostCents) || input.shippingCostCents < 0 || input.shippingCostCents > 100_00) {
    throw new DomainError("INVALID_EBAY_SETTINGS", "frais de port invalides");
  }
  if (!Number.isInteger(input.handlingDays) || input.handlingDays < 1 || input.handlingDays > 10) {
    throw new DomainError("INVALID_EBAY_SETTINGS", "le délai de préparation doit être compris entre 1 et 10 jours");
  }
  if (![14, 30, 60].includes(input.returnDays)) throw new DomainError("INVALID_EBAY_SETTINGS", "délai de retour invalide");

  const settings = await getEbaySettings(sql);
  const market = EBAY_MARKETPLACES[settings.marketplaceId];
  if (!(await policiesEnabled(client))) {
    await client.request("POST", "/sell/account/v1/program/opt_in", { body: { programType: SELLING_POLICIES } });
  }
  const options = await ebayAccountOptions(client, settings).catch(() => null);
  const named = (list: EbayChoice[] | undefined, name: string) => list?.find((p) => p.name === name)?.id ?? null;
  const money = (cents: number) => ({ value: (cents / 100).toFixed(2), currency: market.currency });
  const change: Partial<EbaySettings> = {};

  if (!settings.fulfillmentPolicyId) {
    change.fulfillmentPolicyId = named(options?.fulfillmentPolicies, NAMES.fulfillment) ?? (await client.request<{ fulfillmentPolicyId: string }>(
      "POST", "/sell/account/v1/fulfillment_policy", {
        body: {
          name: NAMES.fulfillment, marketplaceId: settings.marketplaceId, categoryTypes: ALL_CATEGORIES,
          handlingTime: { value: input.handlingDays, unit: "DAY" },
          shippingOptions: [{
            optionType: "DOMESTIC", costType: "FLAT_RATE",
            shippingServices: [{
              shippingServiceCode: input.shippingServiceCode, sortOrder: 1, freeShipping: input.shippingCostCents === 0,
              shippingCost: money(input.shippingCostCents), additionalShippingCost: money(0),
            }],
          }],
        },
      })).fulfillmentPolicyId;
  }
  if (!settings.paymentPolicyId) {
    change.paymentPolicyId = named(options?.paymentPolicies, NAMES.payment) ?? (await client.request<{ paymentPolicyId: string }>(
      "POST", "/sell/account/v1/payment_policy", {
        body: { name: NAMES.payment, marketplaceId: settings.marketplaceId, categoryTypes: ALL_CATEGORIES, immediatePay: true },
      })).paymentPolicyId;
  }
  if (!settings.returnPolicyId) {
    change.returnPolicyId = named(options?.returnPolicies, NAMES.returns) ?? (await client.request<{ returnPolicyId: string }>(
      "POST", "/sell/account/v1/return_policy", {
        body: {
          name: NAMES.returns, marketplaceId: settings.marketplaceId, categoryTypes: ALL_CATEGORIES,
          returnsAccepted: true, returnPeriod: { value: input.returnDays, unit: "DAY" },
          returnShippingCostPayer: "BUYER", refundMethod: "MONEY_BACK",
        },
      })).returnPolicyId;
  }
  if (!settings.merchantLocationKey) {
    const postalCode = input.postalCode.trim();
    const city = input.city.trim();
    if (!postalCode || !city) throw new DomainError("INVALID_EBAY_SETTINGS", "indiquez le code postal et la ville d'expédition");
    if (!options?.locations.some((l) => l.key === DEXLANE_LOCATION_KEY)) {
      await client.request("POST", `/sell/inventory/v1/location/${DEXLANE_LOCATION_KEY}`, {
        body: {
          name: "Dexlane", merchantLocationStatus: "ENABLED", locationTypes: ["WAREHOUSE"],
          location: { address: { postalCode, city, country: market.country } },
        },
      });
    }
    change.merchantLocationKey = DEXLANE_LOCATION_KEY;
  }
  return saveEbaySettings(sql, change, actor);
}
