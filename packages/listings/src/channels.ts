import { recordEvent, withTx, type Db } from "@dexlane/db";
import { allocateOrder, cancelOrder, createShipment, importOrder, refundOrder, setOrderFees, type CardCondition, type ShippingMode } from "@dexlane/inventory";
import { DomainError } from "@dexlane/shared";
import { listListingOffers, listingBlockers, listingColumns, promoPhotoUrl, type ListingState } from "./store";
import { CHANNELS, type ChannelId } from "./channel-ids";
import type { CardDetails } from "./ebay/aspects";
import { checkQuota, hasFeature, recordPublication, type PublicationBatch } from "./quota";

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
  /** Ce qu'on sait de la carte, pour les caractéristiques structurées du canal (jeu, extension, langue…). */
  details?: CardDetails;
}

/** Commande reçue d'un canal, ramenée à ce dont le stock a besoin. */
export interface ChannelOrder {
  externalId: string;
  orderedAt: Date;
  buyerName: string | null;
  shippingChargedCents: number;
  shippingMode: ShippingMode;
  lines: { externalLineId: string; offerSku: string; qty: number; unitPriceCents: number }[];
  /** Adresse de livraison, une ligne par élément (sans le nom). */
  addressLines?: string[];
  /** Date limite d'expédition fixée par le canal. */
  shipBy?: Date;
  /** Pays de livraison (code ISO à deux lettres), quand le canal le donne. */
  countryCode?: string | null;
}

/** L'état d'une commande sur le canal, après son import. */
export interface ChannelOrderUpdate {
  externalId: string;
  /** Frais de la marketplace pour toute la commande, en centimes ; null tant que le canal ne les donne pas. */
  feeCents: number | null;
  /** Remboursement complet de l'acheteur. */
  refunded: boolean;
  /** Commande annulée sur le canal. */
  cancelled: boolean;
}

/**
 * Connecteur d'un canal. Le modèle suit celui d'eBay, le plus contraignant : une annonce par référence d'offre,
 * une quantité qu'on tient à jour, des commandes qu'on vient chercher.
 */
export interface ChannelAdapter {
  publish(input: PublishInput): Promise<{ externalId: string; url: string | null }>;
  /** Peut remettre en ligne une annonce close faute de stock : elle renvoie alors sa nouvelle référence. */
  setQuantity(externalId: string, offerSku: string, quantity: number): Promise<void | { externalId: string; url: string | null }>;
  end(externalId: string, offerSku: string): Promise<void>;
  /** Commandes payées depuis la date donnée ; peut renvoyer des commandes déjà vues (l'import est idempotent). */
  fetchOrders(since: Date | null): Promise<ChannelOrder[]>;
  /**
   * Ce qui a changé depuis la date donnée sur des commandes déjà importées, y compris remises : frais de la marketplace,
   * remboursement complet, annulation. Facultatif : un canal sans cette méthode n'en dit rien.
   */
  fetchOrderUpdates?(since: Date | null): Promise<ChannelOrderUpdate[]>;
  /** Le connecteur peut-il servir (compte connecté, réglages faits) ? Sans cette méthode : toujours. */
  status?(): Promise<{ ready: boolean; reason?: string }>;
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
  /** Un connecteur réel est configuré et prêt : le mode réel peut être activé. */
  liveAvailable: boolean;
  /** Un connecteur réel existe mais n'est pas prêt : la raison (compte à connecter, réglages à faire). */
  liveBlocker: string | null;
  liveListings: number;
  lastSyncedAt: Date | null;
}

export async function listChannels(sql: Db, live: ChannelAdapters): Promise<ChannelState[]> {
  const rows = await sql<{ channel: string; mode: ChannelMode; lastSyncedAt: Date | null }[]>`select channel, mode, last_synced_at from channel_settings`;
  const counts = await sql<{ channel: string; n: number }[]>`
    select channel, count(*)::int as n from listings where status in ('ACTIVE', 'PAUSED') group by channel`;
  const states = await Promise.all(CHANNELS.map((c) => liveStatus(live, c.id)));
  return CHANNELS.map((c, i) => {
    const row = rows.find((r) => r.channel === c.id);
    return {
      ...c, mode: row?.mode ?? "OFF", liveAvailable: states[i]!.ready, liveBlocker: states[i]!.blocker,
      liveListings: counts.find((n) => n.channel === c.id)?.n ?? 0, lastSyncedAt: row?.lastSyncedAt ?? null,
    };
  });
}

async function liveStatus(live: ChannelAdapters, channel: ChannelId): Promise<{ ready: boolean; blocker: string | null }> {
  const adapter = live[channel];
  if (!adapter) return { ready: false, blocker: null };
  const status = adapter.status ? await adapter.status().catch(() => ({ ready: false, reason: "CHANNEL_UNAVAILABLE" })) : { ready: true };
  return { ready: status.ready, blocker: status.ready ? null : (status.reason ?? "CHANNEL_NOT_READY") };
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
  if (mode === "LIVE") {
    const { ready, blocker } = await liveStatus(live, channel);
    if (!ready) throw new DomainError("CHANNEL_NOT_READY", `the ${channel} connector is not ready yet`, { reason: blocker });
  }
  return withTx(sql, async (tx) => {
    const before = await modeOf(tx, channel);
    await tx`
      insert into channel_settings (channel, mode) values (${channel}, ${mode})
      on conflict (account_id, channel) do update set mode = excluded.mode, updated_at = now()`;
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

/**
 * Publie l'offre sur le canal, ou met à jour son annonce (texte, prix, quantité, photos) si elle y est déjà. Une première
 * mise en ligne compte dans le quota du forfait (voir quota.ts) ; `batch` : elle fait partie d'une publication en masse.
 */
export async function publishListing(
  sql: Db, live: ChannelAdapters, input: { offerId: string; channel: ChannelId; actor: string; batch?: PublicationBatch },
): Promise<ListingState> {
  const { adapter, simulated } = await adapterFor(sql, live, input.channel);
  const offer = (await listListingOffers(sql, { offerId: input.offerId })).items[0];
  if (!offer || offer.available <= 0) throw new DomainError("OFFER_NOT_SELLABLE", "this offer has no sellable stock");
  const missing = listingBlockers(offer);
  if (missing.length > 0) throw new DomainError("LISTING_NOT_READY", "the offer is not ready to be listed", { missing });
  const [current] = await sql<{ id: string }[]>`
    select id from listings where channel = ${input.channel} and offer_id = ${offer.offerId} and status <> 'ENDED'`;
  const quota = await checkQuota(sql, { offerId: offer.offerId, channel: input.channel, simulated, revision: !!current, batch: input.batch });

  const composed = offer.photos.filter((p) => p.kind === "LISTING");
  const promo = await promoPhotoUrl(sql);
  const published = await adapter.publish({
    offerSku: offer.offerSku, title: offer.text.title, description: offer.text.description, priceCents: offer.targetPriceCents!,
    quantity: offer.available, condition: offer.condition, details: offer.details,
    // Les photos de la carte d'abord (pour un lot : une par carte) ; l'image commerciale toujours en dernier.
    imageUrls: [...(offer.kind === "LOT" || composed.length === 0 ? offer.photos : composed).map((p) => p.url), ...(promo ? [promo] : [])],
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
    if (quota.count) await recordPublication(tx, { offerId: offer.offerId, channel: input.channel, overQuota: quota.overQuota });
    // Une nouvelle annonce publiée pour de vrai (une révision ou une annonce simulée n'en est pas une).
    if (!existing && !simulated) {
      await recordEvent(tx, { type: "listing_published", key: `listing_published:${row!.id}`, payload: { listingId: row!.id, offerId: offer.offerId, channel: input.channel } });
    }
    await tx`
      insert into audit_events (actor, action, entity, entity_id, after)
      values (${input.actor}, ${existing ? "listing_revised" : "listing_published"}, 'listing', ${row!.id}, ${tx.json({ channel: input.channel, offerSku: offer.offerSku, priceCents: offer.targetPriceCents, quantity: offer.available, simulated })})`;
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
 *
 * Avec la synchronisation du forfait (« sync »), toute différence est envoyée ; sans elle, seules les annonces dont le
 * stock est épuisé sont mises à zéro : une carte vendue n'est jamais revendue, même sur le forfait gratuit.
 */
export async function syncQuantities(sql: Db, live: ChannelAdapters): Promise<{ updated: number; errors: number }> {
  const full = await hasFeature(sql, "sync");
  const stale = await sql<{ id: string; channel: ChannelId; externalId: string | null; offerSku: string; simulated: boolean; quantity: number }[]>`
    select l.id, l.channel, l.external_id, o.offer_sku, l.simulated, greatest(stock.available - l.buffer, 0)::int as quantity
      from listings l
      join offers o on o.id = l.offer_id
      join lateral (
        select coalesce(sum(on_hand - reserved - inspection - quarantine), 0)::int as available
          from stock_items where offer_id = l.offer_id and lifecycle = 'ACTIVE'
      ) stock on true
     where l.status in ('ACTIVE', 'PAUSED', 'ERROR') and l.external_id is not null
       and (l.quantity_sent <> greatest(stock.available - l.buffer, 0) or l.status = 'ERROR')
       ${full ? sql`` : sql`and greatest(stock.available - l.buffer, 0) = 0`}`;
  let updated = 0;
  let errors = 0;
  for (const l of stale) {
    try {
      const adapter = l.simulated ? simulationAdapter(l.channel) : (await adapterFor(sql, live, l.channel)).adapter;
      const relisted = await adapter.setQuantity(l.externalId!, l.offerSku, l.quantity);
      await sql`
        update listings set quantity_sent = ${l.quantity}, status = ${l.quantity > 0 ? "ACTIVE" : "PAUSED"}, error_code = null,
               external_id = ${relisted ? relisted.externalId : l.externalId}, url = ${relisted ? relisted.url : sql`url`},
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

/**
 * Prix et texte synchronisés : une annonce dont le prix (ou le titre) a changé dans Dexlane est révisée sur le canal.
 * Une révision ne compte jamais dans le quota. Réservé aux forfaits avec la synchronisation ; sans elle, rien ne part.
 */
export async function syncPrices(sql: Db, live: ChannelAdapters, actor: string): Promise<{ revised: number; errors: number; skipped: boolean }> {
  if (!(await hasFeature(sql, "sync"))) return { revised: 0, errors: 0, skipped: true };
  const stale = await sql<{ id: string; offerId: string; channel: ChannelId }[]>`
    select l.id, l.offer_id, l.channel
      from listings l join offers o on o.id = l.offer_id
     where l.status in ('ACTIVE', 'PAUSED') and l.external_id is not null and o.target_price_cents is not null
       and (l.price_cents <> o.target_price_cents
            or (o.title_override is not null and l.title is distinct from o.title_override)
            or (o.kind = 'LOT' and l.title is distinct from o.lot_title))
     order by l.updated_at`;
  let revised = 0;
  let errors = 0;
  for (const l of stale) {
    try {
      await publishListing(sql, live, { offerId: l.offerId, channel: l.channel, actor });
      revised++;
    } catch (e) {
      await sql`update listings set status = 'ERROR', error_code = ${e instanceof DomainError ? e.code : "SYNC_FAILED"}, updated_at = now() where id = ${l.id}`;
      errors++;
    }
  }
  return { revised, errors, skipped: false };
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
      shipBy: order.shipBy,
      shippingAddress: order.buyerName || order.addressLines?.length || order.countryCode
        ? {
            ...(order.buyerName ? { name: order.buyerName } : {}), ...(order.addressLines?.length ? { lines: order.addressLines } : {}),
            ...(order.countryCode ? { country: order.countryCode.toUpperCase() } : {}),
          }
        : undefined,
      lines: order.lines,
    });
    if (!created) return { orderId, created, oversold: false };
    // Une commande de canal est déjà conclue : si le stock manque, elle part en survente au lieu d'être refusée.
    const results = await allocateOrder(tx, orderId, actor);
    await createShipment(tx, { orderId, mode: order.shippingMode });
    return { orderId, created, oversold: results.some((r) => r.status === "OVERSOLD") };
  });
}

/**
 * Synchronisation complète : commandes des canaux réels, puis quantités annoncées. Une commande qui ne passe pas
 * (référence d'offre inconnue, par exemple) n'empêche pas les autres d'entrer ; la date de synchronisation n'avance
 * alors pas, pour qu'elle soit retentée.
 */
export async function syncChannels(
  sql: Db, live: ChannelAdapters, actor: string, onError?: (err: unknown) => void,
): Promise<{ orders: number; updated: number; revised: number; errors: number }> {
  let orders = 0;
  let errors = 0;
  for (const channel of await listChannels(sql, live)) {
    if (channel.mode !== "LIVE" || !live[channel.id]) continue;
    const startedAt = new Date();
    try {
      let failed = 0;
      for (const order of await live[channel.id]!.fetchOrders(channel.lastSyncedAt)) {
        try {
          if ((await ingestChannelOrder(sql, channel.id, order, actor)).created) orders++;
        } catch (e) {
          onError?.(e);
          failed++;
        }
      }
      // Les commandes déjà importées : frais, remboursements, annulations faites sur le canal.
      const adapter = live[channel.id]!;
      if (adapter.fetchOrderUpdates) {
        try {
          await applyOrderUpdates(sql, channel.id, await adapter.fetchOrderUpdates(channel.lastSyncedAt), actor);
        } catch (e) {
          onError?.(e);
          failed++;
        }
      }
      errors += failed;
      if (failed === 0) await sql`update channel_settings set last_synced_at = ${startedAt} where channel = ${channel.id}`;
    } catch (e) {
      onError?.(e);
      errors++;
    }
  }
  const quantities = await syncQuantities(sql, live);
  const prices = await syncPrices(sql, live, actor);
  return { orders, updated: quantities.updated, revised: prices.revised, errors: errors + quantities.errors + prices.errors };
}

/**
 * Applique ce que le canal dit des commandes déjà importées : leurs frais (répartis sur les lignes), un remboursement
 * complet (la vente remise ne compte plus), une annulation (la vente pas encore remise est annulée, ses cartes
 * redeviennent disponibles). Les commandes inconnues de Dexlane sont ignorées.
 */
export async function applyOrderUpdates(
  sql: Db, channel: ChannelId, updates: ChannelOrderUpdate[], actor: string,
): Promise<{ fees: number; refunded: number; cancelled: number }> {
  const result = { fees: 0, refunded: 0, cancelled: 0 };
  const label = CHANNELS.find((c) => c.id === channel)?.label ?? channel;
  for (const u of updates) {
    const [order] = await sql<{ id: string; fulfillmentStatus: string; refundedAt: Date | null; feesSyncedAt: Date | null }[]>`
      select id, fulfillment_status, refunded_at, fees_synced_at from orders where channel = ${channel} and external_id = ${u.externalId}`;
    if (!order) continue;
    if (u.feeCents !== null) {
      await setOrderFees(sql, order.id, u.feeCents);
      if (!order.feesSyncedAt) result.fees++;
    }
    if ((u.refunded || u.cancelled) && order.fulfillmentStatus !== "SHIPPED" && order.fulfillmentStatus !== "CANCELLED") {
      await cancelOrder(sql, order.id, actor, u.refunded ? `remboursée sur ${label}` : `annulée sur ${label}`);
      result.cancelled++;
    } else if (u.refunded && order.fulfillmentStatus === "SHIPPED" && !order.refundedAt) {
      await refundOrder(sql, order.id, actor, `remboursée sur ${label}`);
      result.refunded++;
    }
  }
  return result;
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
