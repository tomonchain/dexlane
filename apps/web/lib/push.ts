"use client";

import { api } from "./api";
import { getLocale } from "./i18n";

/**
 * Notifications sur cet appareil (Web Push). Sur iPhone et iPad, elles ne fonctionnent qu'une fois l'application
 * ajoutée à l'écran d'accueil (iOS 16.4 ou plus récent), et ouverte depuis cette icône.
 */
export type PushSupport = "ready" | "unsupported" | "install-first" | "denied";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!capable) return isIos() && !standalone() ? "install-first" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "ready";
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** L'abonnement de cet appareil, s'il existe. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ready") return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

const keyBytes = (base64url: string) => {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

/** Demande la permission, abonne l'appareil et l'enregistre côté serveur. Renvoie false si la permission est refusée. */
export async function enablePush(publicKey: string): Promise<boolean> {
  if ((await Notification.requestPermission()) !== "granted") return false;
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const subscription = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.subscribePush({ endpoint: json.endpoint, keys: json.keys, locale: getLocale() });
  return true;
}

/** Désabonne cet appareil, ici et côté serveur. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api.unsubscribePush(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
}
