import type { Db } from "@dexlane/db";
import type { CardCondition, ShippingMode } from "@dexlane/inventory";
import { DomainError } from "@dexlane/shared";
import type { ChannelAdapter, ChannelOrder, ChannelOrderUpdate, PublishInput } from "../channels";
import { describeErrors, type EbayClient, type EbayErrorDetail } from "./api";
import { buildAspects, categoryAspects, missingAspects } from "./aspects";
import { EBAY_MARKETPLACES, getEbaySettings, missingEbaySettings, type EbaySettings } from "./setup";

/**
 * Cartes non gradées sur eBay : l'état d'objet « Non gradée » (condition 4000, `USED_VERY_GOOD` dans l'API Inventory),
 * précisé par le descripteur « État de la carte » (40001). eBay n'a que quatre niveaux, contre sept dans notre échelle
 * (celle de Cardmarket) : quand deux de nos états tombent entre deux niveaux eBay, on annonce le plus prudent.
 */
export const EBAY_UNGRADED_CONDITION = "USED_VERY_GOOD";
export const EBAY_CARD_CONDITION_DESCRIPTOR = "40001";
export const EBAY_CARD_CONDITIONS: Record<CardCondition, { code: string; label: string }> = {
  MT: { code: "400010", label: "Near mint or better" },
  NM: { code: "400010", label: "Near mint or better" },
  EX: { code: "400011", label: "Lightly played (Excellent)" },
  GD: { code: "400012", label: "Moderately played (Very good)" },
  LP: { code: "400012", label: "Moderately played (Very good)" },
  PL: { code: "400013", label: "Heavily played (Poor)" },
  PO: { code: "400013", label: "Heavily played (Poor)" },
};

/**
 * Cartes gradées : l'état d'objet « Gradée » (condition 2750, `LIKE_NEW` dans l'API Inventory), précisé par trois
 * descripteurs : la société de gradation (27501), la note (27502) et le numéro de certificat (27503, texte libre).
 * Les identifiants de valeurs sont ceux de la taxonomie eBay des cartes à collectionner.
 */
export const EBAY_GRADED_CONDITION = "LIKE_NEW";
export const EBAY_GRADER_DESCRIPTOR = "27501";
export const EBAY_GRADE_DESCRIPTOR = "27502";
export const EBAY_CERT_DESCRIPTOR = "27503";
export const EBAY_GRADERS: Record<string, string> = {
  PSA: "275010", BCCG: "275011", BVG: "275012", BGS: "275013", CSG: "275014", CGC: "275015", SGC: "275016", KSA: "275017",
  GMA: "275018", HGA: "275019", ISA: "2750110", PCA: "2750111", GSG: "2750112", PGS: "2750113", MNT: "2750114", TAG: "2750115",
  "Rare Edition": "2750116", RCG: "2750117", PCG: "2750118", ACE: "2750119", CGA: "2750120", TCG: "2750121", ARK: "2750122",
};
export const EBAY_GRADER_OTHER = "2750123";
export const EBAY_GRADES: Record<string, string> = {
  "10": "275020", "9.5": "275021", "9": "275022", "8.5": "275023", "8": "275024", "7.5": "275025", "7": "275026", "6.5": "275027",
  "6": "275028", "5.5": "275029", "5": "2750210", "4.5": "2750211", "4": "2750212", "3.5": "2750213", "3": "2750214", "2.5": "2750215",
  "2": "2750216", "1.5": "2750217", "1": "2750218", Authentic: "2750219",
};

/** État et descripteurs eBay d'une carte : non gradée (état de la carte) ou gradée (société, note, certificat). */
export function ebayCondition(input: Pick<PublishInput, "condition" | "details">): { condition: string; conditionDescriptors: { name: string; values?: string[]; additionalInfo?: string }[] } {
  const d = input.details;
  if (d?.grader) {
    const grade = d.grade ? EBAY_GRADES[d.grade.replace(",", ".").replace(/\.0$/, "")] : undefined;
    if (!grade) throw new DomainError("EBAY_GRADE_UNKNOWN", `note de gradation non reconnue par eBay : ${d.grade ?? "(vide)"}`);
    return {
      condition: EBAY_GRADED_CONDITION,
      conditionDescriptors: [
        { name: EBAY_GRADER_DESCRIPTOR, values: [EBAY_GRADERS[d.grader] ?? EBAY_GRADER_OTHER] },
        { name: EBAY_GRADE_DESCRIPTOR, values: [grade] },
        ...(d.certNumber ? [{ name: EBAY_CERT_DESCRIPTOR, additionalInfo: d.certNumber.slice(0, 30) }] : []),
      ],
    };
  }
  return {
    condition: EBAY_UNGRADED_CONDITION,
    conditionDescriptors: [{ name: EBAY_CARD_CONDITION_DESCRIPTOR, values: [EBAY_CARD_CONDITIONS[input.condition].code] }],
  };
}

/** Adresse publique d'une annonce. Le bac à sable n'a pas d'adresse par site. */
export function ebayListingUrl(client: EbayClient, settings: EbaySettings, listingId: string): string {
  const web = client.config.environment === "sandbox" ? "https://sandbox.ebay.com" : EBAY_MARKETPLACES[settings.marketplaceId].web;
  return `${web}/itm/${listingId}`;
}

interface EbayOffer {
  offerId: string;
  status: "PUBLISHED" | "UNPUBLISHED";
  listing?: { listingId?: string; listingStatus?: string };
}

const INVENTORY = "/sell/inventory/v1";

/** Le texte de l'annonce est du texte brut : eBay attend du HTML. */
export function descriptionHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.split(/\n{2,}/).map((p) => `<p>${p.split("\n").map(escape).join("<br>")}</p>`).join("");
}

const money = (cents: number, currency: string) => ({ value: (cents / 100).toFixed(2), currency });
const cents = (amount: { value?: string } | undefined) => Math.round(Number(amount?.value ?? 0) * 100);

export function ebayAdapter(sql: Db, client: EbayClient): ChannelAdapter {
  async function ready(): Promise<EbaySettings> {
    if (!(await client.account())) throw new DomainError("EBAY_NOT_CONNECTED", "aucun compte eBay n'est connecté : connectez-le dans Réglages › Canaux de vente");
    const settings = await getEbaySettings(sql);
    const missing = missingEbaySettings(settings);
    if (missing.length > 0) {
      throw new DomainError("EBAY_NOT_SET_UP", "choisissez les règles de vente et le lieu d'expédition eBay dans Réglages › Canaux de vente", { missing });
    }
    return settings;
  }

  async function offerOf(sku: string, settings: EbaySettings): Promise<EbayOffer | null> {
    const r = await client.request<{ offers?: EbayOffer[] } | undefined>(
      "GET", `${INVENTORY}/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${settings.marketplaceId}&format=FIXED_PRICE`, { allowNotFound: true },
    ).catch((e: unknown) => {
      // Référence jamais envoyée : eBay répond « offre introuvable » (25713) au lieu d'une liste vide.
      if (e instanceof DomainError && e.code === "EBAY_REJECTED" && (e.details?.errors as EbayErrorDetail[] | undefined)?.some((x) => x.errorId === 25713)) return undefined;
      throw e;
    });
    return r?.offers?.[0] ?? null;
  }

  async function publishOffer(offerId: string, settings: EbaySettings) {
    const { listingId } = await client.request<{ listingId: string }>("POST", `${INVENTORY}/offer/${encodeURIComponent(offerId)}/publish`);
    return { externalId: listingId, url: ebayListingUrl(client, settings, listingId) };
  }

  return {
    async status() {
      if (!(await client.account())) return { ready: false, reason: "EBAY_NOT_CONNECTED" };
      return missingEbaySettings(await getEbaySettings(sql)).length > 0 ? { ready: false, reason: "EBAY_NOT_SET_UP" } : { ready: true };
    },

    async publish(input: PublishInput) {
      const settings = await ready();
      const market = EBAY_MARKETPLACES[settings.marketplaceId];
      const sku = encodeURIComponent(input.offerSku);
      const aspectList = await categoryAspects(sql, client, settings.marketplaceId, settings.categoryId);
      const aspects = input.details ? buildAspects(aspectList, input.details, settings.marketplaceId) : {};
      const missing = missingAspects(aspectList, aspects);
      if (missing.length > 0) {
        throw new DomainError("EBAY_MISSING_ASPECTS", `eBay exige des caractéristiques que Dexlane ne sait pas remplir : ${missing.join(", ")}`, { aspects: missing });
      }
      const condition = ebayCondition(input);

      // 1. L'objet (référence, état, texte, photos, quantité) ; une annonce déjà en ligne est révisée d'office.
      await client.request("PUT", `${INVENTORY}/inventory_item/${sku}`, {
        language: market.language,
        body: {
          availability: { shipToLocationAvailability: { quantity: input.quantity } },
          ...condition,
          product: { title: input.title, description: input.description, imageUrls: input.imageUrls.slice(0, 24), aspects },
        },
      });

      // 2. L'offre (site, catégorie, prix, règles de vente).
      const offer = {
        sku: input.offerSku, marketplaceId: settings.marketplaceId, format: "FIXED_PRICE", categoryId: settings.categoryId,
        availableQuantity: input.quantity, listingDescription: descriptionHtml(input.description),
        pricingSummary: { price: money(input.priceCents, market.currency) },
        listingPolicies: {
          fulfillmentPolicyId: settings.fulfillmentPolicyId, paymentPolicyId: settings.paymentPolicyId, returnPolicyId: settings.returnPolicyId,
        },
        merchantLocationKey: settings.merchantLocationKey,
      };
      const existing = await offerOf(input.offerSku, settings);
      let offerId: string;
      if (existing) {
        offerId = existing.offerId;
        await client.request("PUT", `${INVENTORY}/offer/${encodeURIComponent(offerId)}`, { language: market.language, body: offer });
        const listingId = existing.status === "PUBLISHED" ? existing.listing?.listingId : undefined;
        if (listingId) return { externalId: listingId, url: ebayListingUrl(client, settings, listingId) };
      } else {
        offerId = (await client.request<{ offerId: string }>("POST", `${INVENTORY}/offer`, { language: market.language, body: offer })).offerId;
      }
      // 3. La mise en ligne.
      return publishOffer(offerId, settings);
    },

    async setQuantity(_externalId, offerSku, quantity) {
      const settings = await ready();
      const offer = await offerOf(offerSku, settings);
      if (!offer) throw new DomainError("EBAY_OFFER_MISSING", `l'offre ${offerSku} n'existe plus sur eBay : publiez-la à nouveau`);
      const r = await client.request<{ responses?: { statusCode: number; errors?: EbayErrorDetail[] }[] }>("POST", `${INVENTORY}/bulk_update_price_quantity`, {
        body: { requests: [{ sku: offerSku, shipToLocationAvailability: { quantity }, offers: [{ offerId: offer.offerId, availableQuantity: quantity }] }] },
      });
      const failed = (r?.responses ?? []).filter((x) => x.statusCode >= 300);
      if (failed.length > 0) throw new DomainError("EBAY_REJECTED", `eBay : ${describeErrors(failed.flatMap((x) => x.errors ?? [])) || "quantité refusée"}`);
      // Une annonce tombée à zéro est close par eBay : du stock revenu la remet en ligne (nouveau numéro d'annonce).
      if (quantity > 0 && offer.status !== "PUBLISHED") return publishOffer(offer.offerId, settings);
    },

    async end(_externalId, offerSku) {
      const settings = await ready();
      const offer = await offerOf(offerSku, settings);
      if (offer?.status === "PUBLISHED") await client.request("POST", `${INVENTORY}/offer/${encodeURIComponent(offer.offerId)}/withdraw`);
    },

    async fetchOrders(since) {
      await ready();
      // Les commandes modifiées depuis la dernière synchronisation (avec deux jours de recouvrement : l'import est
      // idempotent) ; la première fois, le dernier mois. Une commande payée après coup est ainsi rattrapée.
      const from = new Date((since?.getTime() ?? Date.now() - 28 * 86_400_000) - 2 * 86_400_000);
      const filter = `lastmodifieddate:[${from.toISOString()}..],orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}`;
      const orders: ChannelOrder[] = [];
      for (let offset = 0; ; offset += 200) {
        const page = await client.request<{ orders?: EbayOrder[]; total?: number }>(
          "GET", `/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=200&offset=${offset}`);
        for (const raw of page?.orders ?? []) {
          const order = toChannelOrder(raw);
          if (order) orders.push(order);
        }
        if (!page?.orders?.length || offset + 200 >= (page.total ?? 0)) break;
      }
      return orders;
    },

    async fetchOrderUpdates(since) {
      await ready();
      // Toutes les commandes modifiées (remises comprises) : les frais d'eBay arrivent après le paiement, un
      // remboursement ou une annulation après l'import.
      const from = new Date((since?.getTime() ?? Date.now() - 28 * 86_400_000) - 2 * 86_400_000);
      const filter = `lastmodifieddate:[${from.toISOString()}..]`;
      const updates: ChannelOrderUpdate[] = [];
      for (let offset = 0; ; offset += 200) {
        const page = await client.request<{ orders?: EbayOrder[]; total?: number }>(
          "GET", `/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=200&offset=${offset}`);
        for (const raw of page?.orders ?? []) {
          const update = toOrderUpdate(raw);
          if (update) updates.push(update);
        }
        if (!page?.orders?.length || offset + 200 >= (page.total ?? 0)) break;
      }
      return updates;
    },
  };
}

/** Ce qu'une commande eBay dit de ses frais, de son remboursement et de son annulation ; null si elle n'est pas de Dexlane. */
export function toOrderUpdate(o: EbayOrder): ChannelOrderUpdate | null {
  if (!(o.lineItems ?? []).some((l) => l.sku)) return null;
  return {
    externalId: o.orderId,
    feeCents: o.totalMarketplaceFee?.value !== undefined ? cents(o.totalMarketplaceFee) : null,
    refunded: o.orderPaymentStatus === "FULLY_REFUNDED",
    cancelled: o.cancelStatus?.cancelState === "CANCELED",
  };
}

// ───────────────────────── Commandes ─────────────────────────

interface EbayAmount { value?: string; currency?: string }
interface EbayAddress { addressLine1?: string; addressLine2?: string; city?: string; postalCode?: string; stateOrProvince?: string; countryCode?: string }
export interface EbayOrder {
  orderId: string;
  creationDate: string;
  orderPaymentStatus?: string;
  cancelStatus?: { cancelState?: string };
  buyer?: { username?: string };
  pricingSummary?: { deliveryCost?: EbayAmount; deliveryDiscount?: EbayAmount };
  /** Frais d'eBay pour la commande (frais de vente, de paiement), connus une fois la commande payée. */
  totalMarketplaceFee?: EbayAmount;
  fulfillmentStartInstructions?: { shippingStep?: { shippingServiceCode?: string; shipTo?: { fullName?: string; contactAddress?: EbayAddress } } }[];
  lineItems?: {
    lineItemId: string;
    sku?: string;
    quantity: number;
    lineItemCost?: EbayAmount;
    lineItemFulfillmentInstructions?: { shipByDate?: string };
  }[];
}

/**
 * Mode d'envoi d'après le service choisi par l'acheteur. Les codes d'eBay nomment le transporteur et le produit
 * (« FR_LaPosteLettreSuivie », « FR_ColiposteColissimo ») : lettre suivie ou non, colis, remise en main propre.
 */
export function shippingModeOf(serviceCode: string | undefined): ShippingMode {
  const code = (serviceCode ?? "").toLowerCase();
  if (/pickup|collect|enlevement|main ?propre|abholung/.test(code)) return "HAND_DELIVERY";
  if (/lettre|letter|ecopli|brief|lettera|carta/.test(code)) return /suivi|suivie|tracked|track|plus|einschreiben|r1|recommande/.test(code) ? "LETTER_TRACKED" : "LETTER_UNTRACKED";
  if (code) return "PARCEL_TRACKED";
  return "LETTER_TRACKED";
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** Commande eBay ramenée à ce dont le stock a besoin ; null si elle n'est pas à préparer. */
export function toChannelOrder(o: EbayOrder): ChannelOrder | null {
  if (o.orderPaymentStatus !== "PAID") return null;
  if (o.cancelStatus?.cancelState === "CANCELED") return null;
  // Seules les lignes publiées par Dexlane portent une référence d'offre ; une annonce créée à la main sur eBay n'en a pas.
  const lines = (o.lineItems ?? []).filter((l) => l.sku && l.quantity > 0).map((l) => ({
    externalLineId: l.lineItemId, offerSku: l.sku!, qty: l.quantity, unitPriceCents: Math.round(cents(l.lineItemCost) / l.quantity),
  }));
  if (lines.length === 0) return null;
  const step = o.fulfillmentStartInstructions?.[0]?.shippingStep;
  const a = step?.shipTo?.contactAddress;
  const country = a?.countryCode && a.countryCode !== "FR" ? (regionNames.of(a.countryCode) ?? a.countryCode).toUpperCase() : null;
  const addressLines = a
    ? [a.addressLine1, a.addressLine2, [a.postalCode, a.city].filter(Boolean).join(" "), a.stateOrProvince, country].map((x) => x?.trim()).filter((x): x is string => !!x)
    : [];
  const shipBy = o.lineItems?.map((l) => l.lineItemFulfillmentInstructions?.shipByDate).find(Boolean);
  return {
    externalId: o.orderId,
    orderedAt: new Date(o.creationDate),
    buyerName: step?.shipTo?.fullName?.trim() || o.buyer?.username || null,
    shippingChargedCents: Math.max(0, cents(o.pricingSummary?.deliveryCost) - Math.abs(cents(o.pricingSummary?.deliveryDiscount))),
    shippingMode: shippingModeOf(step?.shippingServiceCode),
    lines,
    addressLines,
    shipBy: shipBy ? new Date(shipBy) : undefined,
    countryCode: a?.countryCode ?? null,
  };
}
