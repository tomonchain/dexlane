import { beforeEach, describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { syncSet } from "@dexlane/catalog";
import { card, fakeClient } from "../../catalog/test/fixtures";
import {
  identifyCard, runBench, summarize, resultsToCsv,
  type CardReadingRaw, type CardRecognizer, type LabeledSample,
} from "../src";

const sql = useTestDb("scan");

beforeEach(async () => {
  const client = fakeClient(["swsh3-136", "base1-4"].map(card));
  await syncSet(sql, client, "fr", "swsh3");
  await syncSet(sql, client, "fr", "base1");
});

const clear: CardReadingRaw = {
  card_detected: true, name: "Fouinar", collector_number: "136/189", set_code: "DAA", language: "fr",
  finish_hint: "reverse", first_edition_stamp: false, name_legibility: "clear", number_legibility: "clear", notes: null,
};

/** Reconnaisseur factice : renvoie une lecture prédéfinie par identifiant d'image. */
function scripted(readings: Record<string, Partial<CardReadingRaw> | Error>): CardRecognizer {
  return {
    async recognize(image) {
      const r = readings[image.data.toString()];
      if (r instanceof Error) throw r;
      return {
        reading: { ...clear, ...r }, model: "claude-opus-5-5", servedBy: "claude-opus-5-5",
        usage: { inputTokens: 1000, outputTokens: 200, costUsd: 0.008 }, latencyMs: 1200,
      };
    },
  };
}
const img = (key: string) => ({ data: Buffer.from(key), mediaType: "image/jpeg" as const });

describe("identifyCard", () => {
  it("auto-identifies a clear reading and preselects the matching variant", async () => {
    const r = await identifyCard(sql, scripted({ a: {} }), img("a"));
    expect(r.match.candidates[0]).toMatchObject({ setId: "swsh3", localNumber: "136" });
    expect(r.requiresReview).toBe(false);
    const reverse = r.match.candidates[0]!.variants.find((v) => v.finish === "reverse")!;
    expect(r.suggestedVariantId).toBe(reverse.id);
  });

  it("lets a 100 % match through despite a model note, but keeps the note as a reason when the match is not exact", async () => {
    const sleeved = await identifyCard(sql, scripted({ a: { notes: "card is inside a sleeve" } }), img("a"));
    expect(sleeved.match.candidates[0]!.score).toBe(1);
    expect(sleeved).toMatchObject({ requiresReview: false, reviewReasons: [] });
    expect(sleeved.recognition.reading.notes).toBe("card is inside a sleeve");

    const approximate = await identifyCard(sql, scripted({ a: { name: "Fouinard", notes: "glare on the name" } }), img("a"));
    expect(approximate.match.candidates[0]!.score).toBeLessThan(1);
    expect(approximate.reviewReasons).toContain("model note: glare on the name");
    expect(approximate.requiresReview).toBe(true);
  });

  it("sends partially legible readings to review even when the match is strong", async () => {
    const r = await identifyCard(sql, scripted({ a: { number_legibility: "partial" } }), img("a"));
    expect(r.match.candidates[0]!.setId).toBe("swsh3");
    expect(r).toMatchObject({ requiresReview: true, reviewReasons: ["number partial"] });
  });

  it("ignores unreadable fields instead of trusting them", async () => {
    const r = await identifyCard(
      sql, scripted({ a: { collector_number: "4/102", number_legibility: "unreadable" } }), img("a"));
    expect(r.match.candidates[0]).toMatchObject({ setId: "swsh3", signals: { name: 1 } });
    expect(r.match.candidates[0]!.signals.number).toBeUndefined();
  });

  it("does not preselect a variant when the finish is unknown and several exist", async () => {
    const r = await identifyCard(sql, scripted({ a: { finish_hint: "unknown" } }), img("a"));
    expect(r.suggestedVariantId).toBeNull();
  });

  it("uses the language read on the card, falling back to the default", async () => {
    const en = await identifyCard(sql, scripted({ a: { language: "en" } }), img("a"));
    expect(en).toMatchObject({ language: "en", match: { candidates: [] }, requiresReview: true });

    const unknown = await identifyCard(sql, scripted({ a: { language: null } }), img("a"), { defaultLanguage: "fr" });
    expect(unknown.language).toBe("fr");
    expect(unknown.reviewReasons).toContain("language not determined");
  });
});

describe("bench", () => {
  it("stops the whole run on an authentication error instead of logging it per sample", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const authError = new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", new Headers());
    const recognizer = scripted({ a: authError });
    const s: LabeledSample = { id: "a", load: async () => img("a"), expected: { setId: "swsh3", localNumber: "136", language: "fr" } };
    await expect(runBench(sql, recognizer, [s])).rejects.toBeInstanceOf(Anthropic.AuthenticationError);
  });

  const sample = (key: string, setId: string, localNumber: string): LabeledSample => ({
    id: key, load: async () => img(key), expected: { setId, localNumber, language: "fr" },
  });

  it("measures accuracy, auto-accept precision, silent errors and cost", async () => {
    const recognizer = scripted({
      good: {},
      review: { name: "Fouinarr" },
      // Lecture nette mais fausse : la carte réelle est base1-4, le modèle lit 136/189.
      silent: {},
      boom: new Error("network down"),
    });
    const results = await runBench(sql, recognizer, [
      sample("good", "swsh3", "136"),
      sample("review", "swsh3", "136"),
      sample("silent", "base1", "4"),
      sample("boom", "swsh3", "136"),
    ], { concurrency: 2 });

    expect(results.map((r) => r.id)).toEqual(["good", "review", "silent", "boom"]);
    expect(summarize(results, "claude-opus-5-5")).toMatchObject({
      samples: 4, errors: 1, top1Accuracy: 0.5, top3Accuracy: 0.5,
      autoAcceptRate: 0.5, autoAcceptPrecision: 0.5, silentErrors: 1,
      medianLatencyMs: 1200, meanCostUsd: 0.008, totalCostUsd: 0.024, fallbacks: 0,
    });
    const csv = resultsToCsv(results);
    expect(csv.split("\n")[3]).toContain("silent,base1-4,swsh3-136");
  });
});
