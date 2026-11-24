import { describe, expect, it } from "vitest";
import { detectCarrier } from "@dexlane/inventory";
import { laPosteAdapter, mondialRelayAdapter, trackingFromEnv } from "../src/tracking";

const shipment = (tracking: string) => ({ id: "s", orderId: "o", carrier: "LA_POSTE" as const, tracking, postcode: null });
const fakeFetch = (status: number, body: string, seen?: { url?: string; init?: RequestInit }) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    if (seen) Object.assign(seen, { url: String(url), init });
    return new Response(body, { status });
  }) as typeof fetch;

describe("carriers", () => {
  it("recognises La Poste and Mondial Relay numbers", () => {
    expect(detectCarrier("6A12345678901")).toBe("LA_POSTE");
    expect(detectCarrier("1k 0000 0000 001")).toBe("LA_POSTE");
    expect(detectCarrier("LA123456789FR")).toBe("LA_POSTE");
    expect(detectCarrier("12345678")).toBe("MONDIAL_RELAY");
    expect(detectCarrier("ABC")).toBeNull();
    expect(detectCarrier(null)).toBeNull();
  });

  it("reads La Poste events: delivered, returned, in transit, unknown", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const events = (codes: [string, string][]) => JSON.stringify({ shipment: { deliveryDate: "2026-11-20T10:00:00+01:00", event: codes.map(([code, date]) => ({ code, label: `label ${code}`, date })) } });
    const delivered = await laPosteAdapter("KEY", fakeFetch(200, events([["PC1", "2026-11-18T09:00:00+01:00"], ["DI1", "2026-11-20T10:00:00+01:00"]]), seen))(shipment("6A12345678901"));
    expect(seen.url).toBe("https://api.laposte.fr/suivi/v2/idships/6A12345678901?lang=fr_FR");
    expect((seen.init?.headers as Record<string, string>)["X-Okapi-Key"]).toBe("KEY");
    expect(delivered).toEqual({ status: "DELIVERED", event: "label DI1", eventAt: new Date("2026-11-20T10:00:00+01:00"), deliveredAt: new Date("2026-11-20T10:00:00+01:00") });
    expect((await laPosteAdapter("K", fakeFetch(200, events([["DI2", "2026-11-21T10:00:00+01:00"]])))(shipment("x")))!.status).toBe("RETURNED");
    expect((await laPosteAdapter("K", fakeFetch(200, events([["ET1", "2026-11-19T10:00:00+01:00"]])))(shipment("x")))).toMatchObject({ status: "IN_TRANSIT", deliveredAt: null });
    expect(await laPosteAdapter("K", fakeFetch(404, "{}"))(shipment("x"))).toBeNull();
    await expect(laPosteAdapter("K", fakeFetch(500, "{}"))(shipment("x"))).rejects.toThrow("HTTP 500");
  });

  it("asks Mondial Relay with the signed request and reads its status", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const answer = (stat: string) => `<soap:Envelope><soap:Body><WSI2_TracingColisDetailleResponse><WSI2_TracingColisDetailleResult><STAT>${stat}</STAT><Libelle01>Colis livré au destinataire</Libelle01></WSI2_TracingColisDetailleResult></WSI2_TracingColisDetailleResponse></soap:Body></soap:Envelope>`;
    const result = await mondialRelayAdapter("BDTEST13", "PrivateK", fakeFetch(200, answer("82"), seen))(shipment("12345678"));
    expect(result).toMatchObject({ status: "DELIVERED", event: "Colis livré au destinataire" });
    expect(String(seen.init?.body)).toContain("<Expedition>12345678</Expedition>");
    // MD5 en majuscules de « BDTEST13 » + « 12345678 » + « FR » + clé privée.
    expect(String(seen.init?.body)).toMatch(/<Security>[0-9A-F]{32}<\/Security>/);
    expect((await mondialRelayAdapter("E", "K", fakeFetch(200, answer("81")))(shipment("1")))!.status).toBe("IN_TRANSIT");
    expect(await mondialRelayAdapter("E", "K", fakeFetch(200, answer("97")))(shipment("1"))).toBeNull();
  });

  it("only connects the carriers whose credentials are set", () => {
    expect(Object.keys(trackingFromEnv({}))).toEqual([]);
    expect(Object.keys(trackingFromEnv({ LAPOSTE_OKAPI_KEY: "k", MONDIAL_RELAY_ENSEIGNE: "e" }))).toEqual(["LA_POSTE"]);
    expect(Object.keys(trackingFromEnv({ LAPOSTE_OKAPI_KEY: "k", MONDIAL_RELAY_ENSEIGNE: "e", MONDIAL_RELAY_PRIVATE_KEY: "p" }))).toEqual(["LA_POSTE", "MONDIAL_RELAY"]);
  });
});
