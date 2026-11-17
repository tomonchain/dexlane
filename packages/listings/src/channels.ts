import { withTx, type Db } from "@dexlane/db";
import { allocateOrder, createShipment, importOrder, type CardCondition, type ShippingMode } from "@dexlane/inventory";
import { DomainError } from "@dexlane/shared";
import { listListingOffers, listingBlockers, listingColumns, type ListingState } from "./store";
import { CHANNELS, type ChannelId } from "./channel-ids";

export { CHANNELS, isChannel, type ChannelId } from "./channel-ids";
export type ChannelMode = "OFF" | "SIMULATION" | "LIVE";

/** Ce qu'un canal doit recevoir pour publier une offre. */
export interface PublishInput {
  offerSku: string;
  title: string;
  description: string;
  priceCents: number;
  quantity: number;
  condition: CardCondition;
  imageUrls: string[];
}

/** Commande reçue d'un canal, ramenée à ce dont le stock a besoin. */
export interface ChannelOrder {
  externalId: string;
  orderedAt: Date;
  buyerName: string | null;
  shippingChargedCents: number;
  shippingMode: ShippingMode;
  lines: { externalLineId: string; offerSku: string; qty: number; unitPriceCents: number }[];
}

/**
 * Connecteur d'un canal. Le modèle suit celui d'eBay, le plus contraignant : une annonce par référence d'offre,
 * une quantité qu'on tient à jour, des commandes qu'on vient chercher.
 */
export interface ChannelAdapter {
  publish(input: PublishInput): Promise<{ externalId: string; url: string | null }>;
  setQuantity(externalId: string, offerSku: string, quantity: number): Promise<void>;
  end(externalId: string, offerSku: string): Promise<void>;
  /** Commandes payées depuis la date donnée ; peut renvoyer des commandes déjà vues (l'import est idempotent). */
  fetchOrders(since: Date | null): Promise<ChannelOrder[]>;
}
/** Connecteurs réels disponibles (identifiants configurés). */
export type ChannelAdapters = Partial<Record<ChannelId, ChannelAdapter>>;

/** Simulation : le canal accepte tout et ne fait rien. Les commandes arrivent par `simulateOrder`. */
export const simulationAdapter = (channel: ChannelId): ChannelAdapter => ({
  publish: async (input) => ({ externalId: `SIM-${channel.toUpperCase()}-${input.offerSku}`, url: null }),
  setQuantity: async () => undefined,
  end: async () => undefined,
  fetchOrders: async () => [],
});

export interface ChannelState {
  id: ChannelId;
  label: string;
  mode: ChannelMode;
  /** Un connecteur réel est configuré : le mode réel peut être activé. */
  liveAvailable: boolean;
  liveListings: number;
  lastSyncedAt: Date | null;
}

export async function listChannels(sql: Db, live: ChannelAdapters): Promise<ChannelState[]> {
  const rows = await sql<{ channel: string; mode: ChannelMode; lastSyncedAt: Date | null }[]>`select channel, mode, last_synced_at from channel_settings`;
  const counts = await sql<{ channel: string; n: number }[]>`
    select channel, count(*)::int as n from listings where status in ('ACTIVE', 'PAUSED') group by channel`;
  return CHANNELS.map((c) => {
    const row = rows.find((r) => r.channel === c.id);
    return {
      ...c, mode: row?.mode ?? "OFF", liveAvailable: !!live[c.id],
      liveListings: counts.find((n) => n.channel === c.id)?.n ?? 0, lastSyncedAt: row?.lastSyncedAt ?? null,
    };
  });
}

async function modeOf(sql: Db, channel: ChannelId): Promise<ChannelMode> {
  const [row] = await sql<{ mode: ChannelMode }[]>`select mode from channel_settings where channel = ${channel}`;
  return row?.mode ?? "OFF";
}

async function adapterFor(sql: Db, live: ChannelAdapters, channel: ChannelId): Promise<{ adapter: ChannelAdapter; simulated: boolean }> {
  const mode = await modeOf(sql, channel);
  if (mode === "SIMULATION") return { adapter: simulationAdapter(channel), simulated: true };
  if (mode === "LIVE" && live[channel]) return { adapter: live[channel], simulated: false };
  if (mode === "LIVE") throw new DomainError("CHANNEL_NOT_CONFIGURED", `no connector is configured for ${channel}`);
  throw new DomainError("CHANNEL_DISABLED", `channel ${channel} is switched off`);
}

export async function setChannelMode(sql: Db, live: ChannelAdapters, channel: ChannelId, mode: ChannelMode, actor: string): Promise<void> {
  if (mode === "LIVE" && !live[channel]) throw new DomainError("CHANNEL_NOT_CONFIGURED", `no connector is configured for ${channel}`);
  return withTx(sql, async (tx) => {
    const before = await modeOf(tx, channel);
    await tx`
      insert into channel_settings (channel, mode) values (${channel}, ${mode})
      on conflict (channel) do update set mode = excluded.mode, updated_at = now()`;
    // Les annonces de simulation n'existent nulle part : elles s'arrêtent avec la simulation.
    if (before === "SIMULATION" && mode !== "SIMULATION") {
      await tx`update listings set status = 'ENDED', updated_at = now() where channel = ${channel} and simulated and status <> 'ENDED'`;
    }
    await tx`
      insert into audit_events (actor, action, entity, entity_id, before, after)
      values (${actor}, 'channel_mode_changed', 'channel', ${channel}, ${tx.json({ mode: before })}, ${tx.json({ mode })})`;
  });
}

// ───────────────────────── Annonces ─────────────────────────

/** Publie l'offre sur le canal, ou met à jour son annonce (texte, prix, quantité, photos) si elle y est déjà. */
export async function publishListing(sql: Db, live: ChannelAdapters, input: { offerId: string; channel: ChannelId; actor: string }): Promise<ListingState> {
  const { adapter, simulated } = await adapterFor(sql, live, input.channel);
  const offer = (await listListingOffers(sql, { offerId: input.offerId })).items[0];
  if (!offer || offer.available <= 0) throw new DomainError("OFFER_NOT_SELLABLE", "this offer has no sellable stock");
  const missing = listingBlockers(offer);
  if (missing.length > 0) throw new DomainError("LISTING_NOT_READY", "the offer is not ready to be listed", { missing });

  const composed = offer.photos.filter((p) => p.kind === "LISTING");
  const published = await adapter.publish({
    offerSku: offer.offerSku, title: offer.text.title, description: offer.text.description, priceCents: offer.targetPriceCents!,
    quantity: offer.available, condition: offer.condition,
    imageUrls: (composed.length ? composed : offer.photos).map((p) => p.url),
  });
  return withTx(sql, async (tx) => {
    const [existing] = await tx<{ id: string }[]>`
      select id from listings where channel = ${input.channel} and offer_id = ${offer.offerId} and status <> 'ENDED' for update`;
    const [row] = existing
      ? await tx<ListingState[]>`
          update listings set status = 'ACTIVE', external_id = ${published.externalId}, url = ${published.url}, title = ${offer.text.title},
                 price_cents = ${offer.targetPriceCents}, quantity_sent = ${offer.available}, simulated = ${simulated}, error_code = null,
                 last_synced_at = now(), updated_at = now()
           where id = ${existing.id} returning ${listingColumns(tx)}`
      : await tx<ListingState[]>`
          insert into listings (offer_id, channel, external_id, url, title, price_cents, status, quantity_sent, simulated, last_synced_at)
          values (${offer.offerId}, ${input.channel}, ${published.externalId}, ${published.url}, ${offer.text.title}, ${offer.targetPriceCents},
                  'ACTIVE', ${offer.available}, ${simulated}, now())
          returning ${listingColumns(tx)}`;
    await tx`
      insert into audit_events (actor, action, entity, entity_id, after)
      values (${input.actor}, 'listing_published', 'listing', ${row!.id}, ${tx.json({ channel: input.channel, offerSku: offer.offerSku, priceCents: offer.targetPriceCents, quantity: offer.available, simulated })})`;
    return row!;
  });
}

async function liveListing(sql: Db, listingId: string) {
  const [row] = await sql<(ListingState & { offerSku: string })[]>`
    select l.id, l.offer_id, l.channel, l.status, l.external_id, l.url, l.price_cents, l.quantity_sent, l.simulated, l.error_code, l.last_synced_at, o.offer_sku
      from listings l join offers o on o.id = l.offer_id
     where l.id = ${listingId} and l.status <> 'ENDED'`;
  if (!row) throw new DomainError("LISTING_NOT_FOUND", `listing ${listingId} does not exist or has ended`);
  return row;
}

export async function endListing(sql: Db, live: ChannelAdapters, input: { listingId: string; actor: string }): Promise<void> {
  const listing = await liveListing(sql, input.listingId);
  const adapter = listing.simulated ? simulationAdapter(listing.channel) : (await adapterFor(sql, live, listing.channel)).adapter;
  if (listing.externalId) await adapter.end(listing.externalId, listing.offerSku);
  await sql`update listings set status = 'ENDED', updated_at = now() where id = ${listing.id}`;
  await sql`
    insert into audit_events (actor, action, entity, entity_id, after)
    values (${input.actor}, 'listing_ended', 'listing', ${listing.id}, ${sql.json({ channel: listing.channel, offerSku: listing.offerSku })})`;
}

// ───────────────────────── Synchronisation ─────────────────────────

/**
 * Aligne la quantité annoncée sur le stock vendable (moins la marge de sécurité). C'est le garde-fou contre la
 * double vente entre canaux : une carte vendue ici doit disparaître là-bas. Une annonce sans stock est mise en pause.
 */
export async function syncQuantities(sql: Db, live: ChannelAdapters): Promise<{ updated: number; errors: number }> {
  const stale = await sql<{ id: string; channel: ChannelId; externalId: string | null; offerSku: string; simulated: boolean; quantity: number }[]>`
    select l.id, l.channel, l.external_id, o.offer_sku, l.simulated, greatest(stock.available - l.buffer, 0)::int as quantity
      from listings l
      join offers o on o.id = l.offer_id
      join lateral (
        select coalesce(sum(on_hand - reserved - inspection - quarantine), 0)::int as available
          from stock_items where offer_id = l.offer_id and lifecycle = 'ACTIVE'
      ) stock on true
     where l.status in ('ACTIVE', 'PAUSED', 'ERROR') and l.external_id is not null
       and (l.quantity_sent <> greatest(stock.available - l.buffer, 0) or l.status = 'ERROR')`;
  let updated = 0;
  let errors = 0;
  for (const l of stale) {
    try {
      const adapter = l.simulated ? simulationAdapter(l.channel) : (await adapterFor(sql, live, l.channel)).adapter;
      await adapter.setQuantity(l.externalId!, l.offerSku, l.quantity);
      await sql`
        update listings set quantity_sent = ${l.quantity}, status = ${l.quantity > 0 ? "ACTIVE" : "PAUSED"}, error_code = null,
               last_synced_at = now(), updated_at = now()
         where id = ${l.id}`;
      updated++;
    } catch (e) {
      // L'écart reste visible (statut ERROR) et sera retenté à la prochaine synchronisation.
      await sql`update listings set status = 'ERROR', error_code = ${e instanceof DomainError ? e.code : "SYNC_FAILED"}, updated_at = now() where id = ${l.id}`;
      errors++;
    }
  }
  return { updated, errors };
}

/** Fait entrer une commande de canal dans le circuit habituel : import idempotent, réservation, envoi à préparer. */
export function ingestChannelOrder(sql: Db, channel: ChannelId, order: ChannelOrder, actor: string): Promise<{ orderId: string; created: boolean; oversold: boolean }> {
  return withTx(sql, async (tx) => {
    const { orderId, created } = await importOrder(tx, {
      channel,
      externalId: order.externalId,
      paymentStatus: "PAID",
      grossCents: order.lines.reduce((sum, l) => sum + l.qty * l.unitPriceCents, 0) + order.shippingChargedCents,
      currency: "EUR",
      orderedAt: order.orderedAt,
      shippingAddress: order.buyerName ? { name: order.buyerName } : undefined,
      lines: order.lines,
    });
    if (!created) return { orderId, created, oversold: false };
    // Une commande de canal est déjà conclue : si le stock manque, elle part en survente au lieu d'être refusée.
    const results = await allocateOrder(tx, orderId, actor);
    await createShipment(tx, { orderId, mode: order.shippingMode });
    return { orderId, created, oversold: results.some((r) => r.status === "OVERSOLD") };
  });
}

/** Synchronisation complète : commandes des canaux réels, puis quantités annoncées. */
export async function syncChannels(sql: Db, live: ChannelAdapters, actor: string): Promise<{ orders: number; updated: number; errors: number }> {
  let orders = 0;
  let errors = 0;
  for (const channel of await listChannels(sql, live)) {
    if (channel.mode !== "LIVE" || !live[channel.id]) continue;
    try {
      for (const order of await live[channel.id]!.fetchOrders(channel.lastSyncedAt)) {
        if ((await ingestChannelOrder(sql, channel.id, order, actor)).created) orders++;
      }
      await sql`update channel_settings set last_synced_at = now() where channel = ${channel.id}`;
    } catch {
      errors++;
    }
  }
  const quantities = await syncQuantities(sql, live);
  return { orders, updated: quantities.updated, errors: errors + quantities.errors };
}

/** Simulation : un acheteur fictif commande sur l'annonce, comme le ferait le canal. */
export async function simulateOrder(sql: Db, live: ChannelAdapters, input: { listingId: string; qty: number; actor: string }): Promise<{ orderId: string; oversold: boolean }> {
  const listing = await liveListing(sql, input.listingId);
  if (!listing.simulated) throw new DomainError("NOT_SIMULATED", "orders can only be simulated on a simulated listing");
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new DomainError("INVALID_QUANTITY", "quantity must be a positive integer");
  const [seq] = await sql<{ n: string }[]>`select nextval('simulated_order_seq') as n`;
  const { orderId, oversold } = await ingestChannelOrder(sql, listing.channel, {
    externalId: `SIM-${seq!.n.padStart(6, "0")}`, orderedAt: new Date(), buyerName: "Acheteur de test", shippingChargedCents: 0,
    shippingMode: "LETTER_TRACKED", lines: [{ externalLineId: "1", offerSku: listing.offerSku, qty: input.qty, unitPriceCents: listing.priceCents }],
  }, input.actor);
  await syncQuantities(sql, live);
  return { orderId, oversold };
}
