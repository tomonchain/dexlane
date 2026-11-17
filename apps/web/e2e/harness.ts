/**
 * API de test pour les parcours e2e : vraie API, vraie base (dexlane_web_test, vidée au démarrage),
 * catalogue issu des réponses TCGdex enregistrées, et un lecteur de carte factice à la place de Claude.
 * Le scénario de lecture est choisi par la largeur du PNG envoyé (voir `SCENARIOS`).
 */
import { serve } from "@hono/node-server";
import { createApp } from "@dexlane/api";
import { syncSet } from "@dexlane/catalog";
import { createDb } from "@dexlane/db";
import { prepareTestDatabase, testDatabaseUrl } from "@dexlane/db/testing";
import type { CardReadingRaw, CardRecognizer } from "@dexlane/scan";
import { card, fakeClient } from "../../../packages/catalog/test/fixtures";
import { E2E_API_PORT, E2E_TOKEN } from "./constants";


const clear: CardReadingRaw = {
  card_detected: true, name: "Fouinar", collector_number: "136/189", set_code: "DAA", language: "fr",
  finish_hint: "reverse", first_edition_stamp: false, name_legibility: "clear", number_legibility: "clear", notes: null,
};

/** Largeur du PNG → lecture renvoyée. Largeur inconnue : panne du service de lecture. */
const SCENARIOS: Record<number, Partial<CardReadingRaw>> = {
  10: {},
  11: { name: "Fouin", name_legibility: "partial", finish_hint: "unknown" },
};

const recognizer: CardRecognizer = {
  async recognize(image) {
    const scenario = SCENARIOS[image.data.readUInt32BE(16)];
    if (!scenario) throw new Error("recognition service down (e2e scenario)");
    return {
      reading: { ...clear, ...scenario }, model: "fake", servedBy: "fake",
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, latencyMs: 1,
    };
  },
};

await prepareTestDatabase("web");
const sql = createDb(testDatabaseUrl("web"));
// Le catalogue de départ contient deux séries ; « 151 » (sv03.5) reste à synchroniser depuis l'écran Catalogue.
const client = fakeClient(["swsh3-136", "base1-4", "sv03.5-151"].map(card), {
  listSets: async () => [{ id: "swsh3", name: "Ténèbres Embrasées" }, { id: "sv03.5", name: "151", cardCount: { official: 165, total: 207 } }],
});
for (const set of ["swsh3", "base1"]) await syncSet(sql, client, "fr", set);

serve(
  { fetch: createApp({ sql, token: E2E_TOKEN, recognizer: () => recognizer, tcgdex: () => client, onError: () => undefined }).fetch, hostname: "127.0.0.1", port: E2E_API_PORT },
  (info) => console.log(`e2e api listening on http://127.0.0.1:${info.port}`),
);
