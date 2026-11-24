import { createHash } from "node:crypto";
import type { Carrier, ShipmentToTrack, TrackingResult } from "@dexlane/inventory";

/**
 * Suivi des colis chez les transporteurs. Chaque connecteur répond pour un envoi : son état (en route, livré,
 * retourné), le dernier événement et la date de livraison ; null quand le transporteur ne connaît pas encore le
 * numéro. Un connecteur n'existe que si ses identifiants sont configurés.
 */
export type TrackingAdapter = (shipment: ShipmentToTrack) => Promise<TrackingResult | null>;
export type TrackingAdapters = Partial<Record<Carrier, TrackingAdapter>>;

/**
 * La Poste et Colissimo : API « Suivi v2 » (developer.laposte.fr), clé gratuite dans `LAPOSTE_OKAPI_KEY`.
 * Codes d'événement : DI1 livré, DI2 retourné à l'expéditeur ; le reste est « en route ».
 */
export function laPosteAdapter(key: string, fetcher: typeof fetch = fetch): TrackingAdapter {
  return async ({ tracking }) => {
    const res = await fetcher(`https://api.laposte.fr/suivi/v2/idships/${encodeURIComponent(tracking)}?lang=fr_FR`, {
      headers: { "X-Okapi-Key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 400) return null; // numéro pas encore connu
    if (!res.ok) throw new Error(`La Poste tracking: HTTP ${res.status}`);
    const body = (await res.json()) as {
      shipment?: { deliveryDate?: string; isFinal?: boolean; event?: { code: string; label: string; date: string }[] };
    };
    const events = [...(body.shipment?.event ?? [])].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    if (events.length === 0) return null;
    const last = events[0]!;
    const delivered = events.find((e) => e.code === "DI1");
    const returned = events.some((e) => e.code === "DI2");
    return {
      status: returned ? "RETURNED" : delivered ? "DELIVERED" : "IN_TRANSIT",
      event: last.label,
      eventAt: new Date(last.date),
      deliveredAt: delivered ? new Date(body.shipment?.deliveryDate ?? delivered.date) : null,
    };
  };
}

const xmlValue = (xml: string, tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1]?.trim() ?? null;

/**
 * Mondial Relay : service web « WSI2_TracingColisDetaille » (code enseigne et clé privée du compte, dans
 * `MONDIAL_RELAY_ENSEIGNE` et `MONDIAL_RELAY_PRIVATE_KEY`). STAT 82 : livré ; 80 et 81 : enregistré, en route.
 */
export function mondialRelayAdapter(enseigne: string, privateKey: string, fetcher: typeof fetch = fetch): TrackingAdapter {
  return async ({ tracking }) => {
    const langue = "FR";
    const security = createHash("md5").update(`${enseigne}${tracking}${langue}${privateKey}`).digest("hex").toUpperCase();
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<WSI2_TracingColisDetaille xmlns="http://www.mondialrelay.fr/webservice/">
<Enseigne>${enseigne}</Enseigne><Expedition>${tracking}</Expedition><Langue>${langue}</Langue><Security>${security}</Security>
</WSI2_TracingColisDetaille></soap:Body></soap:Envelope>`;
    const res = await fetcher("https://api.mondialrelay.com/Web_Services.asmx", {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "http://www.mondialrelay.fr/webservice/WSI2_TracingColisDetaille" },
      body: envelope,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Mondial Relay tracking: HTTP ${res.status}`);
    const xml = await res.text();
    const stat = xmlValue(xml, "STAT");
    if (stat === null || !["80", "81", "82"].includes(stat)) return null; // inconnu, ou erreur d'identification
    const label = xmlValue(xml, "Libelle01") ?? xmlValue(xml, "Libelle02");
    return { status: stat === "82" ? "DELIVERED" : "IN_TRANSIT", event: label, eventAt: null, deliveredAt: stat === "82" ? new Date() : null };
  };
}

/** Connecteurs configurés d'après l'environnement. */
export function trackingFromEnv(env: Record<string, string | undefined>): TrackingAdapters {
  const adapters: TrackingAdapters = {};
  if (env.LAPOSTE_OKAPI_KEY) adapters.LA_POSTE = laPosteAdapter(env.LAPOSTE_OKAPI_KEY);
  if (env.MONDIAL_RELAY_ENSEIGNE && env.MONDIAL_RELAY_PRIVATE_KEY) adapters.MONDIAL_RELAY = mondialRelayAdapter(env.MONDIAL_RELAY_ENSEIGNE, env.MONDIAL_RELAY_PRIVATE_KEY);
  return adapters;
}
