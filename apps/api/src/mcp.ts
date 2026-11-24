import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Serveur MCP : ce que les agents peuvent voir et faire dans Dexlane. Chaque outil passe par la même API que
 * l'application (mêmes validations, mêmes règles, même journal), au nom de l'agent. Pas de suppression ni d'annulation :
 * ces gestes restent dans l'application.
 */

/** Appel interne à l'API au nom de l'agent ; une clé d'idempotence est fournie pour chaque écriture (tirée au sort à défaut). */
export type InternalCall = (method: "GET" | "POST" | "PATCH", path: string, body?: unknown, idempotencyKey?: string) => Promise<{ status: number; json: unknown }>;

const INSTRUCTIONS = `Dexlane is the back office of a Pokémon trading card shop (single owner, France, prices in euro cents).
Concepts:
- An offer (offerId) is one card to sell: a card variant in a condition (MT, NM, EX, GD, LP, PL, PO), with a target price. Stock statuses: DRAFT (not yet sellable), TO_PRICE (needs a price), READY (priced, not listed), LISTED (published on a channel).
- Channels: "ebay", "cardtrader"; "direct" sales are recorded by hand. Publications can be planned day by day.
- Sales (orders) go TO_PREPARE → PACKED → SHIPPED; shipping supplies (sleeves, top-loaders, envelopes) are counted out at each handover and must be reordered when they reach their reorder point.
- Goal of the shop: list and sell at a balanced, growing pace (sold ÷ listed between 80 % and 125 %).
All amounts are integer euro cents (150 = 1,50 €). Dates are ISO (YYYY-MM-DD). Start with get_business_overview.`;

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") search.set(k, String(v));
  return search.size ? `?${search}` : "";
};

const uuid = z.uuid();
const cents = z.number().int().min(0).max(2_000_000_000);
const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export function createMcpServer(call: InternalCall): McpServer {
  const server = new McpServer({ name: "dexlane", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  /** Appel de l'API ; une erreur métier (refus, introuvable) revient à l'agent comme résultat en erreur, lisible. */
  const run = async (method: "GET" | "POST" | "PATCH", path: string, body?: unknown, idempotencyKey?: string) => {
    const { status, json } = await call(method, path, body, idempotencyKey);
    return status >= 400 ? { ...text(json), isError: true } : text(json);
  };

  // ───────────────────────── Lecture ─────────────────────────

  server.registerTool("get_business_overview", {
    title: "Business overview",
    description: "Today's picture of the shop: stock counts by status, sales to prepare, last 30 days of sales vs the previous 30 (cards listed vs sold and their ratio), supplies to reorder, planned and failed publications. Call this first.",
    annotations: READ,
  }, async () => {
    const [stock, orders, sales, supplies, plan] = await Promise.all([
      call("GET", "/api/stock?limit=1"), call("GET", "/api/orders?limit=1"), call("GET", "/api/stats/sales?days=30"),
      call("GET", "/api/supplies"), call("GET", "/api/publications"),
    ]);
    const failed = [stock, orders, sales, supplies, plan].find((r) => r.status >= 400);
    if (failed) return { ...text(failed.json), isError: true };
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const s = sales.json as any, st = stock.json as any, o = orders.json as any, sup = supplies.json as any, p = plan.json as any;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const ratio = (sold: number, listed: number) => (listed === 0 ? null : Math.round((sold / listed) * 100));
    return text({
      stock: st.counts,
      stockValueCents: st.totals?.valueCents,
      sales: { counts: o.counts, last30Days: o.last30Days },
      last30Days: {
        cardsListed: s.totals.listed, cardsSold: s.totals.cards, soldPerListedPercent: ratio(s.totals.cards, s.totals.listed),
        revenueCents: s.totals.revenueCents, marginCents: s.totals.marginCents, medianDaysToSell: s.totals.medianDaysToSell,
        previous30Days: { cardsListed: s.previous.listed, cardsSold: s.previous.cards, revenueCents: s.previous.revenueCents },
      },
      supplies: {
        toReorder: sup.toReorder,
        items: sup.supplies.map((x: any) => ({ id: x.id, name: x.name, onHand: x.onHand, reorderPoint: x.reorderPoint, status: x.status, ordered: x.orderedAt !== null, daysLeft: x.daysLeft })), // eslint-disable-line @typescript-eslint/no-explicit-any
      },
      publications: { pending: p.pending, failed: p.failed?.length ?? 0, nextDays: p.days?.slice(0, 7) },
    });
  });

  server.registerTool("search_stock", {
    title: "Search stock",
    description: "Cards in stock, one line per offer, with set code (e.g. EB03, EV03.5), price, suggested price, market price, status and location. Filter by text (card name, number, set name or set code), status, set, condition.",
    inputSchema: {
      query: z.string().max(100).optional().describe("Card name, number or set"),
      status: z.enum(["ALL", "TO_PRICE", "READY", "LISTED", "DRAFT"]).optional(),
      setId: z.string().max(40).optional(),
      condition: z.enum(["MT", "NM", "EX", "GD", "LP", "PL", "PO"]).optional(),
      sort: z.enum(["value", "recent", "name"]).optional(),
      limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
      offset: z.number().int().min(0).optional(),
    },
    annotations: READ,
  }, (a) => run("GET", `/api/stock${qs({ q: a.query, status: a.status, setId: a.setId, condition: a.condition, sort: a.sort, limit: a.limit ?? 20, offset: a.offset })}`));

  server.registerTool("get_stock_card", {
    title: "Stock card detail",
    description: "Everything about one offer: card, positions and locations, price and market quotes, listings on channels, photos.",
    inputSchema: { offerId: uuid },
    annotations: READ,
  }, (a) => run("GET", `/api/stock/${a.offerId}`));

  server.registerTool("list_sales", {
    title: "List sales",
    description: "Sales (orders), newest first, with stage counts and the last 30 days totals. Stage: TO_PREPARE, PACKED, SHIPPED, CANCELLED.",
    inputSchema: { stage: z.enum(["TO_PREPARE", "PACKED", "SHIPPED", "CANCELLED"]).optional(), limit: z.number().int().min(1).max(100).optional() },
    annotations: READ,
  }, (a) => run("GET", `/api/orders${qs({ stage: a.stage, limit: a.limit ?? 20 })}`));

  server.registerTool("get_sale", {
    title: "Sale detail",
    description: "One sale: lines, reserved positions, shipment, margin.",
    inputSchema: { orderId: uuid },
    annotations: READ,
  }, (a) => run("GET", `/api/orders/${a.orderId}`));

  server.registerTool("get_sales_statistics", {
    title: "Sales statistics",
    description: "What sells over the last N days: totals vs previous period, cards listed vs sold by month, by set, price band, condition, rarity, channel, weekday, delay to sell, top cards.",
    inputSchema: { days: z.number().int().min(7).max(730).optional().describe("Default 90") },
    annotations: READ,
  }, (a) => run("GET", `/api/stats/sales${qs({ days: a.days ?? 90 })}`));

  server.registerTool("get_price_moves", {
    title: "Market price moves",
    description: "Market price changes of cards in stock; alertsOnly keeps moves beyond the owner's alert thresholds.",
    inputSchema: { alertsOnly: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional() },
    annotations: READ,
  }, (a) => run("GET", `/api/stats/price-moves${qs({ alerts: a.alertsOnly ?? true, limit: a.limit ?? 30 })}`));

  server.registerTool("list_supplies", {
    title: "Shipping supplies",
    description: "Shipping supplies: quantity on hand, reorder point, usage (per card / per shipment / manual), last 30 days usage, days of stock left, status (OK, LOW, OUT) and whether an order is on the way.",
    annotations: READ,
  }, () => run("GET", "/api/supplies"));

  server.registerTool("list_stock_movements", {
    title: "Stock movements",
    description: "Stock journal, newest first: entries, exits (sales shipped, supplies used), corrections and moves, for cards and supplies, with a summary of units in and out over the last N days. Pass `next` from a previous page as `before`.",
    inputSchema: {
      category: z.enum(["CARD", "SUPPLY"]).optional(),
      kind: z.enum(["IN", "OUT", "ADJUST", "MOVE"]).optional(),
      offerId: uuid.optional(), supplyId: uuid.optional(),
      before: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).optional(), days: z.number().int().min(1).max(365).optional(),
    },
    annotations: READ,
  }, (a) => run("GET", `/api/stock-movements${qs({ category: a.category, kind: a.kind, offerId: a.offerId, supplyId: a.supplyId, before: a.before, limit: a.limit ?? 30, days: a.days })}`));

  server.registerTool("get_publication_plan", {
    title: "Publication plan",
    description: "Listings planned day by day per channel, pending count and failed publications with their reason.",
    annotations: READ,
  }, () => run("GET", "/api/publications"));

  server.registerTool("search_catalog", {
    title: "Search card catalog",
    description: "Find cards in the Pokémon catalog (variants with their ids, used to watch a card or know its market price). Give at least a name, number or set.",
    inputSchema: {
      name: z.string().max(100).optional(), number: z.string().max(30).optional(), set: z.string().max(40).optional(),
      language: z.enum(["fr", "en", "ja"]).optional().describe("Default fr"),
    },
    annotations: READ,
  }, (a) => run("GET", `/api/catalog/cards${qs({ name: a.name, number: a.number, set: a.set, language: a.language })}`));

  server.registerTool("find_buying_deals", {
    title: "Buying deals",
    description: "Cards currently offered well below their market price (buying opportunities).",
    inputSchema: { minCents: z.number().int().min(100).optional(), minDiscountPercent: z.number().int().min(5).max(90).optional() },
    annotations: { ...READ, openWorldHint: true },
  }, (a) => run("GET", `/api/deals${qs({ minCents: a.minCents, minDiscount: a.minDiscountPercent })}`));

  server.registerTool("list_watched_cards", {
    title: "Watched cards",
    description: "Cards the owner watches to buy, with target price and current market prices; alerts when a target is reached.",
    annotations: READ,
  }, () => run("GET", "/api/watchlist"));

  server.registerTool("list_sellable_offers", {
    title: "Sellable offers",
    description: "Offers available to sell right now with their available quantity, to compose a direct sale.",
    inputSchema: { query: z.string().max(100).optional() },
    annotations: READ,
  }, (a) => run("GET", `/api/offers/sellable${qs({ q: a.query })}`));

  // ───────────────────────── Actions ─────────────────────────

  server.registerTool("set_offer_price", {
    title: "Set an offer's price",
    description: "Set the target price (and optionally the floor price) of an offer. Pricing rules will no longer change it, only flag a gap.",
    inputSchema: { offerId: uuid, targetPriceCents: cents, floorPriceCents: cents.optional() },
    annotations: { ...WRITE, idempotentHint: true },
  }, (a) => run("POST", `/api/pricing/offers/${a.offerId}/price`, { targetPriceCents: a.targetPriceCents, floorPriceCents: a.floorPriceCents }));

  server.registerTool("plan_publications", {
    title: "Plan publications",
    description: "Spread ready offers over consecutive days on a channel, perDay listings a day from startOn. Without offerIds, all ready offers.",
    inputSchema: {
      channel: z.enum(["ebay", "cardtrader"]), startOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), perDay: z.number().int().min(1).max(500),
      offerIds: z.array(uuid).min(1).max(2000).optional(),
    },
    annotations: WRITE,
  }, (a) => run("POST", "/api/publications/plan", a));

  server.registerTool("record_direct_sale", {
    title: "Record a direct sale",
    description: "Record a sale made outside the marketplaces (in person, message…). The cards are reserved immediately or the sale is refused. Reuse the same idempotencyKey when retrying.",
    inputSchema: {
      lines: z.array(z.object({ offerId: uuid, qty: z.number().int().min(1).max(10_000), unitPriceCents: cents })).min(1).max(100),
      shippingMode: z.enum(["LETTER_UNTRACKED", "LETTER_TRACKED", "PARCEL_TRACKED", "HAND_DELIVERY"]),
      shippingChargedCents: cents.optional(),
      buyerName: z.string().min(1).max(120).optional(),
      note: z.string().min(1).max(500).optional(),
      idempotencyKey: z.string().min(8).max(100).optional(),
    },
    annotations: WRITE,
  }, ({ idempotencyKey, ...sale }) => run("POST", "/api/orders", sale, idempotencyKey));

  server.registerTool("watch_card", {
    title: "Watch a card",
    description: "Watch a catalog variant to buy it, with an optional target price: an alert comes when the market goes below it.",
    inputSchema: { variantId: uuid, targetCents: z.number().int().min(1).optional(), note: z.string().max(200).optional() },
    annotations: WRITE,
  }, (a) => run("POST", "/api/watchlist", a));

  server.registerTool("receive_supplies", {
    title: "Receive supplies",
    description: "A supply order arrived: add the quantity to stock (closes the pending order).",
    inputSchema: { supplyId: uuid, quantity: z.number().int().min(1).max(1_000_000) },
    annotations: WRITE,
  }, (a) => run("POST", `/api/supplies/${a.supplyId}/receive`, { quantity: a.quantity }));

  server.registerTool("count_supply", {
    title: "Count a supply",
    description: "Inventory count: the counted quantity replaces the computed one.",
    inputSchema: { supplyId: uuid, onHand: z.number().int().min(0).max(1_000_000) },
    annotations: { ...WRITE, idempotentHint: true },
  }, (a) => run("POST", `/api/supplies/${a.supplyId}/count`, { onHand: a.onHand }));

  server.registerTool("mark_supply_ordered", {
    title: "Mark a supply as ordered",
    description: "Record that a supply was reordered (true) or that the order was cancelled (false). An ordered supply is no longer reported as to reorder until received.",
    inputSchema: { supplyId: uuid, ordered: z.boolean() },
    annotations: { ...WRITE, idempotentHint: true },
  }, (a) => run("POST", `/api/supplies/${a.supplyId}/ordered`, { ordered: a.ordered }));

  server.registerTool("update_supply_settings", {
    title: "Update a supply's reorder settings",
    description: "Change a supply's reorder point (alert level), usual reorder quantity, supplier link, unit cost (cents), reference or location code (an existing location).",
    inputSchema: {
      supplyId: uuid, reorderPoint: z.number().int().min(0).optional(),
      reorderQuantity: z.number().int().min(1).nullable().optional(), supplierUrl: z.url().nullable().optional(),
      unitCostCents: z.number().int().min(0).max(1_000_000).nullable().optional(), reference: z.string().max(60).nullable().optional(),
      locationCode: z.string().max(80).nullable().optional(),
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, ({ supplyId, ...changes }) => run("PATCH", `/api/supplies/${supplyId}`, changes));

  return server;
}
