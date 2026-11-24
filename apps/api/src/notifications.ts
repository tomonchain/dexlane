import type { Db } from "@dexlane/db";
import { listWatched } from "@dexlane/pricing";
import webpush from "web-push";

/**
 * Notifications sur le téléphone (Web Push). Chaque appareil s'abonne depuis Réglages › Notifications ; les clés qui
 * signent les envois sont créées au premier besoin et gardées en base. Chaque matin, après la tâche quotidienne, un
 * résumé part s'il y a du nouveau : ventes arrivées des marketplaces, cartes suivies passées sous leur prix cible,
 * mises en ligne publiées ou en échec.
 */

export type PushLocale = "fr" | "en";
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  locale: PushLocale;
  userAgent?: string;
}
export interface PushMessage {
  title: string;
  body: string;
  /** Écran ouvert quand on touche la notification. */
  url: string;
  tag: string;
}
interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: PushLocale;
}
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}
/** Envoi d'un message à un appareil ; « gone » : l'abonnement n'existe plus (appli désinstallée, permission retirée). */
export type PushSender = (subscription: StoredSubscription, message: PushMessage, keys: VapidKeys) => Promise<"sent" | "gone">;

export interface NotificationPreferences {
  sales: boolean;
  watched: boolean;
  publications: boolean;
  /** Fournitures passées sous leur seuil de commande. */
  supplies: boolean;
  /** Avis à demander, 24 h après la livraison d'une vente. */
  reviews: boolean;
}
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = { sales: true, watched: true, publications: true, supplies: true, reviews: true };

/** Envoi réel par les services de notification des navigateurs (Apple, Google, Mozilla). */
export const webPushSender: PushSender = async (subscription, message, keys) => {
  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(message),
      { vapidDetails: { subject: site ? `https://${site}` : "https://localhost", publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 12 * 3600 },
    );
    return "sent";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone";
    throw e;
  }
};

/** Clés de signature des envois, créées une fois pour toutes au premier besoin. */
export async function vapidKeys(sql: Db): Promise<VapidKeys> {
  const [existing] = await sql<VapidKeys[]>`select public_key, private_key from push_keys`;
  if (existing) return existing;
  const fresh = webpush.generateVAPIDKeys();
  await sql`insert into push_keys (public_key, private_key) values (${fresh.publicKey}, ${fresh.privateKey}) on conflict (id) do nothing`;
  const [kept] = await sql<VapidKeys[]>`select public_key, private_key from push_keys`;
  return kept!;
}

export async function saveSubscription(sql: Db, input: PushSubscriptionInput): Promise<void> {
  await sql`
    insert into push_subscriptions (endpoint, p256dh, auth, locale, user_agent)
    values (${input.endpoint}, ${input.keys.p256dh}, ${input.keys.auth}, ${input.locale}, ${input.userAgent ?? null})
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, locale = excluded.locale, user_agent = excluded.user_agent`;
}

export async function removeSubscription(sql: Db, endpoint: string): Promise<void> {
  await sql`delete from push_subscriptions where endpoint = ${endpoint}`;
}

export async function countSubscriptions(sql: Db): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from push_subscriptions`;
  return row!.n;
}

/** Envoie un message à chaque appareil abonné, dans sa langue ; les abonnements disparus sont retirés. */
export async function broadcast(sql: Db, send: PushSender, build: (locale: PushLocale) => PushMessage): Promise<{ sent: number; removed: number; failed: number }> {
  const subscriptions = await sql<StoredSubscription[]>`select endpoint, p256dh, auth, locale from push_subscriptions order by created_at`;
  if (subscriptions.length === 0) return { sent: 0, removed: 0, failed: 0 };
  const keys = await vapidKeys(sql);
  let sent = 0, removed = 0, failed = 0;
  for (const subscription of subscriptions) {
    try {
      if ((await send(subscription, build(subscription.locale), keys)) === "gone") {
        await removeSubscription(sql, subscription.endpoint);
        removed++;
      } else sent++;
    } catch {
      failed++; // un appareil injoignable n'empêche pas les autres
    }
  }
  return { sent, removed, failed };
}

const euros = (cents: number, locale: PushLocale) =>
  new Intl.NumberFormat(locale === "en" ? "en-GB" : "fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
const plural = (n: number, locale: PushLocale, fr: [string, string], en: [string, string]) =>
  locale === "en" ? (n === 1 ? en[0] : en[1]) : n <= 1 ? fr[0] : fr[1];

export interface Digest {
  /** Ventes arrivées des marketplaces depuis le dernier résumé. */
  newOrders: number;
  /** Ventes encore à préparer (toutes origines). */
  toPrepare: number;
  /** Cartes suivies passées sous leur prix cible depuis le dernier résumé. */
  targets: { name: string; cents: number }[];
  published: number;
  failed: number;
  /** Fournitures à commander (sous le seuil, pas encore commandées). */
  suppliesToReorder: number;
}

/** Ce qui s'est passé depuis le dernier résumé, selon les préférences. */
export async function collectDigest(sql: Db, preferences: NotificationPreferences): Promise<{ digest: Digest; since: Date; notified: string[] }> {
  const [state] = await sql<{ lastDigestAt: Date; notified: { targets?: string[] } }[]>`select last_digest_at, notified from notification_state`;
  const since = state?.lastDigestAt ?? new Date(Date.now() - 24 * 3600 * 1000);
  const alreadyNotified = new Set(state?.notified.targets ?? []);
  const [orders] = await sql<{ fresh: number; toPrepare: number }[]>`
    select count(*) filter (where channel <> 'direct' and created_at > ${since})::int as fresh,
           count(*) filter (where fulfillment_status = 'PENDING')::int as to_prepare
      from orders where fulfillment_status <> 'CANCELLED'`;
  const [publications] = await sql<{ published: number; failed: number }[]>`
    select count(*) filter (where status = 'DONE')::int as published, count(*) filter (where status = 'FAILED')::int as failed
      from scheduled_publications where done_at > ${since}`;
  const [supplies] = await sql<{ n: number }[]>`
    select count(*)::int as n from supplies where archived_at is null and ordered_at is null and on_hand <= reorder_point`;
  const watched = preferences.watched ? (await listWatched(sql)).items.filter((w) => w.alerts.includes("TARGET_REACHED")) : [];
  const reached = watched.map((w) => ({ id: w.id, name: w.card.name, cents: w.cardmarket.lowCents ?? 0 }));
  return {
    since,
    notified: reached.map((r) => r.id),
    digest: {
      newOrders: preferences.sales ? orders!.fresh : 0,
      toPrepare: preferences.sales ? orders!.toPrepare : 0,
      targets: reached.filter((r) => !alreadyNotified.has(r.id)).map(({ name, cents }) => ({ name, cents })),
      published: preferences.publications ? publications!.published : 0,
      failed: preferences.publications ? publications!.failed : 0,
      suppliesToReorder: preferences.supplies ? supplies!.n : 0,
    },
  };
}

/** Le résumé en une notification ; null s'il n'y a rien de nouveau qui mérite de déranger. */
export function digestMessage(d: Digest, locale: PushLocale): PushMessage | null {
  const lines: string[] = [];
  if (d.newOrders > 0) {
    lines.push(locale === "en"
      ? `${d.newOrders} new ${plural(d.newOrders, locale, ["", ""], ["sale", "sales"])} to prepare`
      : `${d.newOrders} ${plural(d.newOrders, locale, ["nouvelle vente", "nouvelles ventes"], ["", ""])} à préparer`);
  }
  if (d.targets.length === 1) {
    const [t] = d.targets;
    lines.push(locale === "en" ? `${t!.name} is below your target price (${euros(t!.cents, locale)})` : `${t!.name} est sous votre prix cible (${euros(t!.cents, locale)})`);
  } else if (d.targets.length > 1) {
    lines.push(locale === "en" ? `${d.targets.length} watched cards below your target price` : `${d.targets.length} cartes suivies sous votre prix cible`);
  }
  if (d.failed > 0) {
    lines.push(locale === "en"
      ? `${d.failed} ${plural(d.failed, locale, ["", ""], ["listing", "listings"])} could not be published`
      : `${d.failed} ${plural(d.failed, locale, ["mise en ligne en échec", "mises en ligne en échec"], ["", ""])}`);
  }
  // Les publications réussies et les ventes en attente complètent un résumé, sans le déclencher à elles seules.
  if (lines.length === 0) return null;
  if (d.published > 0) {
    lines.push(locale === "en"
      ? `${d.published} ${plural(d.published, locale, ["", ""], ["card", "cards"])} listed`
      : `${d.published} ${plural(d.published, locale, ["carte mise en ligne", "cartes mises en ligne"], ["", ""])}`);
  }
  if (d.suppliesToReorder > 0) {
    lines.push(locale === "en"
      ? `${d.suppliesToReorder} ${plural(d.suppliesToReorder, locale, ["", ""], ["supply", "supplies"])} to reorder`
      : `${d.suppliesToReorder} ${plural(d.suppliesToReorder, locale, ["fourniture à commander", "fournitures à commander"], ["", ""])}`);
  }
  if (d.newOrders === 0 && d.toPrepare > 0) {
    lines.push(locale === "en" ? `${d.toPrepare} ${plural(d.toPrepare, locale, ["", ""], ["sale", "sales"])} waiting to be prepared` : `${d.toPrepare} ${plural(d.toPrepare, locale, ["vente attend", "ventes attendent"], ["", ""])} d'être préparée${d.toPrepare > 1 ? "s" : ""}`);
  }
  const url = d.newOrders > 0 ? "/ventes" : d.targets.length > 0 ? "/achats" : "/mises-en-ligne";
  return { title: "Dexlane", body: lines.join(" · "), url, tag: "digest" };
}

/** Résumé du matin : envoyé s'il y a du nouveau, puis la date et les alertes signalées sont retenues. */
export async function sendDigest(sql: Db, send: PushSender, preferences: NotificationPreferences) {
  const { digest, notified } = await collectDigest(sql, preferences);
  const anything = digestMessage(digest, "fr") !== null;
  const result = anything ? await broadcast(sql, send, (locale) => digestMessage(digest, locale)!) : { sent: 0, removed: 0, failed: 0 };
  await sql`
    insert into notification_state (last_digest_at, notified) values (now(), ${sql.json({ targets: notified })})
    on conflict (id) do update set last_digest_at = excluded.last_digest_at, notified = excluded.notified`;
  return { ...result, digest };
}

/** Fournitures passées sous leur seuil de commande : une notification par passage sous le seuil. */
export function suppliesMessage(items: { name: string; onHand: number }[], locale: PushLocale): PushMessage {
  const url = "/stock?categorie=fournitures";
  if (items.length === 1) {
    const [x] = items;
    const body = x!.onHand === 0
      ? (locale === "en" ? `${x!.name}: out of stock. Time to reorder.` : `${x!.name} : épuisé. Pensez à recommander.`)
      : (locale === "en" ? `${x!.name}: only ${x!.onHand} left. Time to reorder.` : `${x!.name} : plus que ${x!.onHand}. Pensez à recommander.`);
    return { title: locale === "en" ? "Supplies to reorder" : "Fournitures à commander", body, url, tag: "supplies" };
  }
  const names = items.map((x) => x.name).join(", ");
  return {
    title: locale === "en" ? "Supplies to reorder" : "Fournitures à commander",
    body: locale === "en" ? `${items.length} supplies are running low: ${names}.` : `${items.length} fournitures arrivent à leur seuil : ${names}.`,
    url,
    tag: "supplies",
  };
}

/** Avis à demander : les ventes livrées depuis 24 h, une notification pour toutes. */
export function reviewsMessage(items: { orderId: string; externalId: string; buyerName: string | null }[], locale: PushLocale): PushMessage {
  if (items.length === 1) {
    const [x] = items;
    const who = x!.buyerName ?? x!.externalId;
    return {
      title: locale === "en" ? "Ask for a review" : "Demander un avis",
      body: locale === "en" ? `${who} received their order yesterday: time to ask for a review.` : `${who} a reçu sa commande hier : c'est le moment de demander un avis.`,
      url: `/sales/${x!.orderId}`,
      tag: "reviews",
    };
  }
  return {
    title: locale === "en" ? "Ask for reviews" : "Demander des avis",
    body: locale === "en" ? `${items.length} orders were delivered yesterday: time to ask for reviews.` : `${items.length} commandes livrées hier : c'est le moment de demander des avis.`,
    url: "/sales?review=due",
    tag: "reviews",
  };
}

export const testMessage = (locale: PushLocale): PushMessage => locale === "en"
  ? { title: "Dexlane", body: "Notifications are on for this device.", url: "/reglages/notifications", tag: "test" }
  : { title: "Dexlane", body: "Les notifications sont activées sur cet appareil.", url: "/reglages/notifications", tag: "test" };
