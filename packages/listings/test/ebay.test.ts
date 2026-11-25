import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { attachPhotos, createLocation, getOrderDetail, receiveCard, recordPhoto } from "@dexlane/inventory";
import {
  EbayClient, buildAspects, createEbayDefaults, descriptionHtml, ebayAdapter, ebayConfigFromEnv, getEbaySettings, listChannels, listListingOffers,
  parseShippingServices, publishListing, saveEbaySettings, setChannelMode, shippingModeOf, syncChannels, syncQuantities, toChannelOrder,
  type CategoryAspect, type EbayConfig, type EbayOrder,
} from "../src";

const sql = useTestDb("listings");
const ACTOR = "test";
const CONFIG: EbayConfig = { environment: "sandbox", clientId: "app-id", clientSecret: "cert-id", ruName: "Dexlane-RuName" };

type Call = { method: string; url: URL; headers: Headers; body: unknown };
type Handler = (call: Call) => { status?: number; json?: unknown; text?: string } | undefined;

/** Faux eBay : chaque appel est noté ; le premier gestionnaire qui répond l'emporte. */
function fakeEbay(...handlers: Handler[]) {
  const calls: Call[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const raw = init?.body;
    const body = typeof raw === "string" && raw.startsWith("{") ? JSON.parse(raw) : raw;
    const call = { method: init?.method ?? "GET", url, headers: new Headers(init?.headers), body };
    calls.push(call);
    for (const h of [...handlers, defaults]) {
      const r = h(call);
      if (r) return new Response(r.text ?? (r.json === undefined ? null : JSON.stringify(r.json)), { status: r.status ?? 200 });
    }
    return new Response(JSON.stringify({ errors: [{ errorId: 1, message: `unexpected ${call.method} ${url.pathname}` }] }), { status: 500 });
  }) as typeof fetch;
  const client = new EbayClient(sql, CONFIG, fetcher);
  const find = (method: string, path: string | RegExp) =>
    calls.filter((c) => c.method === method && (typeof path === "string" ? c.url.pathname === path : path.test(c.url.pathname)));
  return { client, calls, find };
}

const defaults: Handler = ({ method, url, body }) => {
  if (url.pathname === "/identity/v1/oauth2/token") {
    const form = new URLSearchParams(body as string);
    return form.get("grant_type") === "authorization_code"
      ? { json: { access_token: "access-1", expires_in: 7200, refresh_token: "refresh-1", refresh_token_expires_in: 47_304_000 } }
      : { json: { access_token: `access-refreshed`, expires_in: 7200 } };
  }
  if (url.pathname === "/commerce/identity/v1/user/") return { json: { username: "testuser_dexlane" } };
  if (url.pathname.endsWith("/get_default_category_tree_id")) return { json: { categoryTreeId: "71" } };
  if (url.pathname.endsWith("/get_item_aspects_for_category")) return { json: { aspects: TAXONOMY } };
  if (method === "GET" && url.pathname === "/sell/inventory/v1/offer") return { status: 404, json: { errors: [{ errorId: 25713, message: "This Offer is not available." }] } };
  if (method === "PUT" && url.pathname.startsWith("/sell/inventory/v1/inventory_item/")) return { status: 204 };
  if (method === "POST" && url.pathname === "/sell/inventory/v1/offer") return { status: 201, json: { offerId: "OFFER-1" } };
  if (method === "PUT" && url.pathname.startsWith("/sell/inventory/v1/offer/")) return { json: {} };
  if (method === "POST" && /\/offer\/[^/]+\/publish$/.test(url.pathname)) return { json: { listingId: "110000000001" } };
  return undefined;
};

const TAXONOMY = [
  { localizedAspectName: "Jeu", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" }, aspectValues: [{ localizedValue: "Pokémon TCG" }, { localizedValue: "Magic: The Gathering" }] },
  { localizedAspectName: "Langue", aspectConstraint: { aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "Anglais" }, { localizedValue: "Français" }] },
  { localizedAspectName: "Finition", aspectConstraint: { aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "Holo" }, { localizedValue: "Reverse Holo" }] },
  { localizedAspectName: "Personnage", aspectConstraint: { aspectMode: "FREE_TEXT", aspectMaxLength: 65 }, aspectValues: [{ localizedValue: "Dracaufeu" }] },
  { localizedAspectName: "Numéro de la carte", aspectConstraint: { aspectMode: "FREE_TEXT" } },
  { localizedAspectName: "Couleur", aspectConstraint: { aspectMode: "FREE_TEXT" } },
];

async function connect(client: EbayClient) {
  const consent = new URL(await client.consentUrl());
  await client.completeConsent({ state: consent.searchParams.get("state")!, code: "auth-code" });
}

async function setUp() {
  await saveEbaySettings(sql, { fulfillmentPolicyId: "F1", paymentPolicyId: "P1", returnPolicyId: "R1", merchantLocationKey: "DEXLANE" }, ACTOR);
}

let seq = 0;
async function offer(quantity = 2) {
  const n = ++seq;
  const [card] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language) values ('base1', ${String(n)}, 'Dracaufeu', 'fr') returning id`;
  const [variant] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish) values (${card!.id}, 'holo') returning id`;
  await createLocation(sql, { code: "BOX-01" });
  const r = await receiveCard(sql, { variantId: variant!.id, condition: "EX", quantity, location: { code: "BOX-01" }, unitCostCents: 100, actor: ACTOR });
  await sql`update offers set target_price_cents = 1250, category = 'SINGLE' where id = ${r.offer.id}`;
  const scan = await recordPhoto(sql, { kind: "SCAN_FRONT", storageKey: `scan-${n}`, url: `https://blob.test/scan-${n}.jpg`, contentType: "image/jpeg", byteSize: 1 });
  await attachPhotos(sql, [scan.id], { stockItemId: r.stockItem.id, offerId: r.offer.id });
  return { id: r.offer.id, sku: r.offer.offerSku };
}

describe("configuration", () => {
  it("needs the three keys, and stays in the sandbox unless production is asked for", () => {
    expect(ebayConfigFromEnv({ EBAY_CLIENT_ID: "a", EBAY_CLIENT_SECRET: "b" })).toBeNull();
    expect(ebayConfigFromEnv({ EBAY_CLIENT_ID: "a", EBAY_CLIENT_SECRET: "b", EBAY_RU_NAME: "c" })).toMatchObject({ environment: "sandbox" });
    expect(ebayConfigFromEnv({ EBAY_CLIENT_ID: "a", EBAY_CLIENT_SECRET: "b", EBAY_RU_NAME: "c", EBAY_ENV: "Production" })).toMatchObject({ environment: "production" });
  });
});

describe("account connection", () => {
  it("sends the owner to eBay's consent page and keeps the tokens it brings back", async () => {
    const { client, find } = fakeEbay();
    const consent = new URL(await client.consentUrl());
    expect(consent.origin).toBe("https://auth.sandbox.ebay.com");
    expect(consent.searchParams.get("redirect_uri")).toBe("Dexlane-RuName");
    expect(consent.searchParams.get("scope")).toContain("sell.inventory");

    await expect(client.completeConsent({ state: "forged-state", code: "x" })).rejects.toMatchObject({ code: "EBAY_CONSENT_EXPIRED" });
    expect(await client.completeConsent({ state: consent.searchParams.get("state")!, code: "auth-code" })).toEqual({ username: "testuser_dexlane" });
    // Le code d'autorisation ne sert qu'une fois.
    await expect(client.completeConsent({ state: consent.searchParams.get("state")!, code: "auth-code" })).rejects.toMatchObject({ code: "EBAY_CONSENT_EXPIRED" });

    const [token] = find("POST", "/identity/v1/oauth2/token");
    expect(token!.headers.get("authorization")).toBe(`Basic ${Buffer.from("app-id:cert-id").toString("base64")}`);
    expect(await client.account()).toMatchObject({ username: "testuser_dexlane" });
    expect(await client.accessToken()).toBe("access-1");
  });

  it("renews an expired access token with the refresh token", async () => {
    const { client, find } = fakeEbay();
    await connect(client);
    await sql`update channel_accounts set access_expires_at = now() - interval '1 minute'`;
    expect(await client.accessToken()).toBe("access-refreshed");
    const refresh = new URLSearchParams(find("POST", "/identity/v1/oauth2/token").at(-1)!.body as string);
    expect(refresh.get("grant_type")).toBe("refresh_token");
    expect(refresh.get("refresh_token")).toBe("refresh-1");
  });

  it("ignores an account connected in the other environment", async () => {
    const { client } = fakeEbay();
    await connect(client);
    const production = new EbayClient(sql, { ...CONFIG, environment: "production" }, fetch);
    expect(await production.account()).toBeNull();
    await expect(production.accessToken()).rejects.toMatchObject({ code: "EBAY_NOT_CONNECTED" });
  });
});

describe("going live", () => {
  it("is only possible once the account is connected and the selling policies are chosen", async () => {
    const { client } = fakeEbay();
    const live = { ebay: ebayAdapter(sql, client) };
    expect((await listChannels(sql, live))[0]).toMatchObject({ liveAvailable: false, liveBlocker: "EBAY_NOT_CONNECTED" });
    await connect(client);
    expect((await listChannels(sql, live))[0]).toMatchObject({ liveAvailable: false, liveBlocker: "EBAY_NOT_SET_UP" });
    await expect(setChannelMode(sql, live, "ebay", "LIVE", ACTOR)).rejects.toMatchObject({ code: "CHANNEL_NOT_READY" });
    await setUp();
    expect((await listChannels(sql, live))[0]).toMatchObject({ liveAvailable: true, liveBlocker: null });
    await setChannelMode(sql, live, "ebay", "LIVE", ACTOR);
  });
});

describe("publishing", () => {
  it("creates the inventory item, the offer, then publishes it", async () => {
    const { client, find } = fakeEbay();
    await connect(client);
    await setUp();
    const live = { ebay: ebayAdapter(sql, client) };
    await setChannelMode(sql, live, "ebay", "LIVE", ACTOR);
    const o = await offer();

    const listing = await publishListing(sql, live, { offerId: o.id, channel: "ebay", actor: ACTOR });
    expect(listing).toMatchObject({ status: "ACTIVE", externalId: "110000000001", url: "https://sandbox.ebay.com/itm/110000000001", simulated: false });

    const [item] = find("PUT", `/sell/inventory/v1/inventory_item/${o.sku}`);
    expect(item!.headers.get("content-language")).toBe("fr-FR");
    expect(item!.headers.get("authorization")).toBe("Bearer access-1");
    expect(item!.body).toMatchObject({
      availability: { shipToLocationAvailability: { quantity: 2 } },
      condition: "USED_VERY_GOOD",
      // EX (Cardmarket) → « Lightly played (Excellent) » chez eBay.
      conditionDescriptors: [{ name: "40001", values: ["400011"] }],
      product: {
        imageUrls: [expect.stringMatching(/^https:\/\/blob\.test\//)],
        aspects: { "Jeu": ["Pokémon TCG"], "Langue": ["Français"], "Finition": ["Holo"], "Personnage": ["Dracaufeu"], "Numéro de la carte": [expect.any(String)] },
      },
    });
    const [created] = find("POST", "/sell/inventory/v1/offer");
    expect(created!.body).toMatchObject({
      sku: o.sku, marketplaceId: "EBAY_FR", format: "FIXED_PRICE", categoryId: "183454", availableQuantity: 2,
      pricingSummary: { price: { value: "12.50", currency: "EUR" } },
      listingPolicies: { fulfillmentPolicyId: "F1", paymentPolicyId: "P1", returnPolicyId: "R1" }, merchantLocationKey: "DEXLANE",
    });
    expect(find("POST", "/sell/inventory/v1/offer/OFFER-1/publish")).toHaveLength(1);
  });

  it("revises a listing already online instead of publishing it again", async () => {
    const { client, find } = fakeEbay(({ method, url }) =>
      method === "GET" && url.pathname === "/sell/inventory/v1/offer"
        ? { json: { offers: [{ offerId: "OFFER-9", status: "PUBLISHED", listing: { listingId: "110000000009" } }] } } : undefined);
    await connect(client);
    await setUp();
    const live = { ebay: ebayAdapter(sql, client) };
    await setChannelMode(sql, live, "ebay", "LIVE", ACTOR);
    const o = await offer();
    expect(await publishListing(sql, live, { offerId: o.id, channel: "ebay", actor: ACTOR })).toMatchObject({ externalId: "110000000009" });
    expect(find("PUT", "/sell/inventory/v1/offer/OFFER-9")).toHaveLength(1);
    expect(find("POST", /\/publish$/)).toHaveLength(0);
  });

  it("reports eBay's own words when it refuses", async () => {
    const { client } = fakeEbay(({ method, url }) =>
      method === "POST" && url.pathname.endsWith("/publish")
        ? { status: 400, json: { errors: [{ errorId: 25002, message: "A user error has occurred.", longMessage: "The shipping service is not valid." }] } } : undefined);
    await connect(client);
    await setUp();
    const live = { ebay: ebayAdapter(sql, client) };
    await setChannelMode(sql, live, "ebay", "LIVE", ACTOR);
    const o = await offer();
    await expect(publishListing(sql, live, { offerId: o.id, channel: "ebay", actor: ACTOR })).rejects.toMatchObject({
      code: "EBAY_REJECTED", message: "eBay : The shipping service is not valid.",
    });
  });
});

describe("quantities", () => {
  it("updates the quantity, and puts back online a listing eBay closed when it ran out", async () => {
    let status = "PUBLISHED";
    const { client, find } = fakeEbay(({ method, url }) => {
      if (method === "GET" && url.pathname === "/sell/inventory/v1/offer") {
        return { json: { offers: [{ offerId: "OFFER-1", status, listing: { listingId: "110000000001" } }] } };
      }
      if (url.pathname === "/sell/inventory/v1/bulk_update_price_quantity") return { json: { responses: [{ statusCode: 200, sku: "x" }] } };
      if (url.pathname.endsWith("/publish")) return { json: { listingId: "110000000002" } };
      return undefined;
    });
    await connect(client);
    await setUp();
    const live = { ebay: ebayAdapter(sql, client) };
    await setChannelMode(sql, live, "ebay", "LIVE", ACTOR);
    const o = await offer(3);
    await publishListing(sql, live, { offerId: o.id, channel: "ebay", actor: ACTOR });

    await sql`update listings set quantity_sent = 5`;
    expect(await syncQuantities(sql, live)).toEqual({ updated: 1, errors: 0 });
    expect(find("POST", "/sell/inventory/v1/bulk_update_price_quantity").at(-1)!.body).toEqual({
      requests: [{ sku: o.sku, shipToLocationAvailability: { quantity: 3 }, offers: [{ offerId: "OFFER-1", availableQuantity: 3 }] }],
    });

    status = "UNPUBLISHED";
    await sql`update listings set quantity_sent = 0`;
    await syncQuantities(sql, live);
    expect((await listListingOffers(sql, { offerId: o.id })).items[0]!.listings[0]).toMatchObject({
      status: "ACTIVE", externalId: "110000000002", url: "https://sandbox.ebay.com/itm/110000000002",
    });
  });
});

describe("orders", () => {
  const order = (over: Partial<EbayOrder> = {}): EbayOrder => ({
    orderId: "12-34567-89012", creationDate: "2026-11-20T10:00:00.000Z", orderPaymentStatus: "PAID", cancelStatus: { cancelState: "NONE_REQUESTED" },
    buyer: { username: "buyer1" },
    pricingSummary: { deliveryCost: { value: "2.50", currency: "EUR" } },
    fulfillmentStartInstructions: [{
      shippingStep: {
        shippingServiceCode: "FR_LaPosteLettreSuivie",
        shipTo: { fullName: "Camille Martin", contactAddress: { addressLine1: "3 rue des Lilas", city: "Lyon", postalCode: "69003", countryCode: "FR" } },
      },
    }],
    lineItems: [{ lineItemId: "L1", sku: "OF-X", quantity: 2, lineItemCost: { value: "25.00", currency: "EUR" }, lineItemFulfillmentInstructions: { shipByDate: "2026-11-23T23:00:00.000Z" } }],
    ...over,
  });

  it("keeps paid orders on Dexlane's offers, with the buyer's address", () => {
    expect(toChannelOrder(order())).toEqual({
      externalId: "12-34567-89012", orderedAt: new Date("2026-11-20T10:00:00.000Z"), buyerName: "Camille Martin", shippingChargedCents: 250,
      shippingMode: "LETTER_TRACKED", lines: [{ externalLineId: "L1", offerSku: "OF-X", qty: 2, unitPriceCents: 1250 }],
      addressLines: ["3 rue des Lilas", "69003 Lyon"], shipBy: new Date("2026-11-23T23:00:00.000Z"),
    });
    expect(toChannelOrder(order({ orderPaymentStatus: "PENDING" }))).toBeNull();
    expect(toChannelOrder(order({ cancelStatus: { cancelState: "CANCELED" } }))).toBeNull();
    expect(toChannelOrder(order({ lineItems: [{ lineItemId: "L1", quantity: 1, lineItemCost: { value: "5.00" } }] }))).toBeNull();
    const abroad = order({ fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: "Hans", contactAddress: { addressLine1: "Hauptstr. 1", postalCode: "10115", city: "Berlin", countryCode: "DE" } } } }] });
    expect(toChannelOrder(abroad)!.addressLines).toEqual(["Hauptstr. 1", "10115 Berlin", "GERMANY"]);
  });

  it("brings eBay orders into sales, reserves the stock, and lowers the quantity listed", async () => {
    const o = await offer(3);
    const { client, find } = fakeEbay(({ method, url }) => {
      if (url.pathname === "/sell/fulfillment/v1/order") {
        return { json: { total: 2, orders: [order({ lineItems: [{ lineItemId: "L1", sku: o.sku, quantity: 1, lineItemCost: { value: "12.50" }, lineItemFulfillmentInstructions: { shipByDate: "2026-11-23T23:00:00.000Z" } }] }), order({ orderId: "UNKNOWN", lineItems: [{ lineItemId: "L9", sku: "OF-NOT-OURS", quantity: 1, lineItemCost: { value: "1.00" } }] })] } };
      }
      if (method === "GET" && url.pathname === "/sell/inventory/v1/offer") return { json: { offers: [{ offerId: "OFFER-1", status: "PUBLISHED" }] } };
      if (url.pathname === "/sell/inventory/v1/bulk_update_price_quantity") return { json: { responses: [{ statusCode: 200 }] } };
      return undefined;
    });
    await connect(client);
    await setUp();
    const live = { ebay: ebayAdapter(sql, client) };
    await setChannelMode(sql, live, "ebay", "LIVE", ACTOR);
    await publishListing(sql, live, { offerId: o.id, channel: "ebay", actor: ACTOR });

    const errors: unknown[] = [];
    // Une commande sur une référence inconnue ne bloque pas les autres, mais la synchronisation sera retentée.
    expect(await syncChannels(sql, live, ACTOR, (e) => errors.push(e))).toEqual({ orders: 1, updated: 1, errors: 1 });
    expect(errors[0]).toMatchObject({ code: "UNKNOWN_OFFER_SKU" });
    expect((await listChannels(sql, live))[0]!.lastSyncedAt).toBeNull();

    const filter = find("GET", "/sell/fulfillment/v1/order")[0]!.url.searchParams.get("filter")!;
    expect(filter).toMatch(/^lastmodifieddate:\[\d{4}-\d\d-\d\dT[\d:.]+Z\.\.\],orderfulfillmentstatus:\{NOT_STARTED\|IN_PROGRESS\}$/);
    const [imported] = await sql<{ id: string }[]>`select id from orders where channel = 'ebay' and external_id = '12-34567-89012'`;
    expect(await getOrderDetail(sql, imported!.id)).toMatchObject({ grossCents: 1500 });
    const [stored] = await sql<{ shippingAddress: unknown; shipBy: Date }[]>`select shipping_address, ship_by from orders where id = ${imported!.id}`;
    expect(stored).toEqual({ shippingAddress: { name: "Camille Martin", lines: ["3 rue des Lilas", "69003 Lyon"] }, shipBy: new Date("2026-11-23T23:00:00.000Z") });
    expect(find("POST", "/sell/inventory/v1/bulk_update_price_quantity").at(-1)!.body).toMatchObject({ requests: [{ shipToLocationAvailability: { quantity: 2 } }] });

    // Réimporter la même commande ne la double pas.
    await syncChannels(sql, live, ACTOR, () => undefined);
    expect((await sql`select 1 from orders where channel = 'ebay'`).length).toBe(1);
  });

  it("guesses the shipping mode from the service the buyer chose", () => {
    expect(shippingModeOf("FR_LaPosteLettreSuivie")).toBe("LETTER_TRACKED");
    expect(shippingModeOf("FR_Ecopli")).toBe("LETTER_UNTRACKED");
    expect(shippingModeOf("FR_ColiposteColissimo")).toBe("PARCEL_TRACKED");
    expect(shippingModeOf("FR_LocalPickup")).toBe("HAND_DELIVERY");
    expect(shippingModeOf(undefined)).toBe("LETTER_TRACKED");
  });
});

describe("account set-up", () => {
  it("creates the missing selling policies and the shipping location, and keeps what was already chosen", async () => {
    const { client, find } = fakeEbay(({ method, url }) => {
      if (url.pathname === "/sell/account/v1/program/get_opted_in_programs") return { json: { programs: [] } };
      if (url.pathname === "/sell/account/v1/program/opt_in") return { json: {} };
      if (method === "GET" && /_policy$/.test(url.pathname)) return { json: {} };
      if (method === "GET" && url.pathname === "/sell/inventory/v1/location") return { json: { locations: [] } };
      if (method === "POST" && url.pathname === "/sell/account/v1/fulfillment_policy") return { status: 201, json: { fulfillmentPolicyId: "F-NEW" } };
      if (method === "POST" && url.pathname === "/sell/account/v1/return_policy") return { status: 201, json: { returnPolicyId: "R-NEW" } };
      if (method === "POST" && url.pathname === "/sell/inventory/v1/location/DEXLANE") return { status: 204 };
      return undefined;
    });
    await connect(client);
    await saveEbaySettings(sql, { paymentPolicyId: "P-MINE" }, ACTOR);
    await createEbayDefaults(sql, client, { shippingServiceCode: "FR_LaPosteLettreSuivie", shippingCostCents: 250, handlingDays: 2, returnDays: 30, postalCode: "69003", city: "Lyon" }, ACTOR);

    expect(await getEbaySettings(sql)).toMatchObject({ fulfillmentPolicyId: "F-NEW", paymentPolicyId: "P-MINE", returnPolicyId: "R-NEW", merchantLocationKey: "DEXLANE" });
    expect(find("POST", "/sell/account/v1/program/opt_in")[0]!.body).toEqual({ programType: "SELLING_POLICY_MANAGEMENT" });
    expect(find("POST", "/sell/account/v1/payment_policy")).toHaveLength(0);
    expect(find("POST", "/sell/account/v1/fulfillment_policy")[0]!.body).toMatchObject({
      marketplaceId: "EBAY_FR", handlingTime: { value: 2, unit: "DAY" },
      shippingOptions: [{ optionType: "DOMESTIC", shippingServices: [{ shippingServiceCode: "FR_LaPosteLettreSuivie", shippingCost: { value: "2.50", currency: "EUR" } }] }],
    });
    expect(find("POST", "/sell/inventory/v1/location/DEXLANE")[0]!.body).toMatchObject({ location: { address: { postalCode: "69003", city: "Lyon", country: "FR" } } });
  });

  it("forgets the policies when the eBay site changes (they belong to a site)", async () => {
    await saveEbaySettings(sql, { fulfillmentPolicyId: "F1", paymentPolicyId: "P1", returnPolicyId: "R1", merchantLocationKey: "DEXLANE" }, ACTOR);
    expect(await saveEbaySettings(sql, { marketplaceId: "EBAY_DE" }, ACTOR)).toMatchObject({
      marketplaceId: "EBAY_DE", fulfillmentPolicyId: null, paymentPolicyId: null, returnPolicyId: null, merchantLocationKey: "DEXLANE",
    });
  });

  it("reads the domestic shipping services from the Trading API answer", () => {
    const xml = `<GeteBayDetailsResponse><Ack>Success</Ack>
      <ShippingServiceDetails><Description>Lettre suivie</Description><ShippingService>FR_LaPosteLettreSuivie</ShippingService><ValidForSellingFlow>true</ValidForSellingFlow><ShippingCategory>STANDARD</ShippingCategory></ShippingServiceDetails>
      <ShippingServiceDetails><Description>Colissimo International</Description><InternationalService>true</InternationalService><ShippingService>FR_ColissimoInternational</ShippingService><ValidForSellingFlow>true</ValidForSellingFlow></ShippingServiceDetails>
      <ShippingServiceDetails><Description>Ancien service</Description><ShippingService>FR_Old</ShippingService><ValidForSellingFlow>false</ValidForSellingFlow></ShippingServiceDetails>
      <ShippingServiceDetails><Description>Colissimo &amp; suivi</Description><ShippingService>FR_ColiposteColissimo</ShippingService><ValidForSellingFlow>true</ValidForSellingFlow></ShippingServiceDetails>
    </GeteBayDetailsResponse>`;
    expect(parseShippingServices(xml)).toEqual([
      { code: "FR_ColiposteColissimo", description: "Colissimo & suivi", category: null },
      { code: "FR_LaPosteLettreSuivie", description: "Lettre suivie", category: "STANDARD" },
    ]);
  });
});

describe("listing content", () => {
  it("leaves out a value eBay does not offer when only its values are allowed", () => {
    const aspects: CategoryAspect[] = [
      { name: "Langue", required: false, selectionOnly: true, maxLength: null, values: ["Anglais", "Français"] },
      { name: "Finition", required: false, selectionOnly: true, maxLength: null, values: ["Holo"] },
    ];
    expect(buildAspects(aspects, { name: "Pikachu", number: "58/102", set: "Set de Base", language: "ja", rarity: "", finish: "reverse" }, "EBAY_FR")).toEqual({});
  });

  it("turns the plain-text description into simple HTML", () => {
    expect(descriptionHtml("Dracaufeu <holo>\nNM\n\nEnvoi soigné")).toBe("<p>Dracaufeu &lt;holo&gt;<br>NM</p><p>Envoi soigné</p>");
  });
});
