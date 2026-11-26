/**
 * API de test pour les parcours e2e : vraie API, vraie base (dexlane_web_test, vidée au démarrage),
 * catalogue issu des réponses TCGdex enregistrées, et un lecteur de carte factice à la place de Claude.
 * Le scénario de lecture est choisi par la largeur du PNG envoyé (voir `SCENARIOS`).
 */
import { serve } from "@hono/node-server";
import { createApp } from "@dexlane/api";
import { createMemoryPhotoStore } from "@dexlane/api/photos";
import { syncSet } from "@dexlane/catalog";
import { createDb } from "@dexlane/db";
import { prepareTestDatabase, testDatabaseUrl } from "@dexlane/db/testing";
import type { CardReadingRaw, CardRecognizer } from "@dexlane/scan";
import { card, fakeClient } from "../../../packages/catalog/test/fixtures";
import { E2E_API_PORT, E2E_TOKEN, E2E_WEB_PORT } from "./constants";


const clear: CardReadingRaw = {
  card_detected: true, name: "Fouinar", collector_number: "136/189", set_code: "DAA", language: "fr",
  finish_hint: "reverse", first_edition_stamp: false, name_legibility: "clear", number_legibility: "clear", notes: null,
};

/** Largeur du PNG → lecture renvoyée. Largeur inconnue : panne du service de lecture. */
const SCENARIOS: Record<number, Partial<CardReadingRaw>> = {
  10: {},
  11: { name: "Fouin", name_legibility: "partial", finish_hint: "unknown" },
  13: { notes: "card is inside a sleeve, slight glare" },
  14: { finish_hint: "unknown" },
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
const BLOCKS: Record<string, [string, string[]]> = {
  base: ["Wizards", ["base1"]],
  swsh: ["Épée et Bouclier", ["swsh3"]],
  sv: ["Écarlate et Violet", ["sv03.5"]],
};

// Le catalogue de départ contient deux séries ; « 151 » (sv03.5) reste à synchroniser depuis l'écran Catalogue.
const client = fakeClient(["swsh3-136", "base1-4", "sv03.5-151"].map(card), {
  listSets: async () => [{ id: "swsh3", name: "Ténèbres Embrasées" }, { id: "sv03.5", name: "151", cardCount: { official: 165, total: 207 } }],
  listSeries: async () => [{ id: "base", name: "Wizards" }, { id: "swsh", name: "Épée et Bouclier" }, { id: "sv", name: "Écarlate et Violet" }],
  getSerie: async (_language, id) => ({ id, name: BLOCKS[id]?.[0] ?? id, sets: (BLOCKS[id]?.[1] ?? []).map((setId) => ({ id: setId, name: setId })) }),
});
for (const set of ["swsh3", "base1"]) await syncSet(sql, client, "fr", set);
// Les cotations enregistrées datent de la capture des réponses : on les rajeunit pour qu'elles servent de référence.
await sql`update price_snapshots set observed_at = now() - interval '1 day'`;
// Un relevé plus ancien, moitié moins cher : de quoi mesurer une variation de cote (tableau de bord).
await sql`
  insert into price_snapshots (variant_id, condition, source, quote_type, currency, amount_cents, source_scope, observed_at, variant_ambiguous)
  select variant_id, condition, source, quote_type, currency, greatest(amount_cents / 2, 1), source_scope, observed_at - interval '10 days', variant_ambiguous
    from price_snapshots`;

const mails: { to: string; subject: string; text: string }[] = [];
const app = createApp({
  sql, token: E2E_TOKEN, recognizer: () => recognizer, tcgdex: () => client, photos: createMemoryPhotoStore(),
  // BetterAuth : sa propre connexion à la base de test, et l'adresse du site servi par Next pour les liens des e-mails.
  databaseUrl: testDatabaseUrl("web"), baseUrl: `http://127.0.0.1:${E2E_WEB_PORT}`,
  mailer: { send: async (mail) => void mails.push({ to: mail.to, subject: mail.subject, text: mail.text }) }, onError: () => undefined,
});

serve(
  {
    // Les e-mails ne partent nulle part : les tests lisent le dernier à /__test/mails.
    fetch: (req: Request) => (new URL(req.url).pathname === "/__test/mails" ? Response.json(mails) : app.fetch(req)),
    hostname: "127.0.0.1", port: E2E_API_PORT,
  },
  (info) => console.log(`e2e api listening on http://127.0.0.1:${info.port}`),
);
