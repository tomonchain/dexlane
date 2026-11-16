import { beforeEach, describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { findCandidates, syncSet } from "../src";
import { card, fakeClient } from "./fixtures";

const sql = useTestDb("catalog");

beforeEach(async () => {
  const client = fakeClient(["swsh3-136", "base1-4", "sv03.5-151", "svp-001"].map(card));
  for (const set of ["swsh3", "base1", "sv03.5", "svp"]) await syncSet(sql, client, "fr", set);
  // Réimpressions homonymes, pour éprouver l'ambiguïté.
  await sql`insert into catalog_sets (id, language, name, card_count_official) values ('xy1', 'fr', 'XY', 146), ('sm1', 'fr', 'Soleil et Lune', 149)`;
  await sql`insert into catalog_cards (set_id, local_number, name, language)
            values ('xy1', '110', 'Fouinar', 'fr'), ('sm1', '136', 'Fouinar', 'fr'), ('xy1', '11', 'Dracaufeu', 'fr')`;
});

describe("findCandidates", () => {
  it("identifies a card from name and full collector number with high confidence", async () => {
    const r = await findCandidates(sql, { language: "fr", name: "Fouinar", collectorNumber: "136/189" });
    expect(r.candidates[0]).toMatchObject({ setId: "swsh3", localNumber: "136", score: 1 });
    expect(r.candidates[0]!.variants.map((v) => v.finish)).toEqual(["normal", "reverse"]);
    expect(r).toMatchObject({ ambiguous: false, requiresReview: false });
  });

  it("returns at most 3 candidates", async () => {
    const r = await findCandidates(sql, { language: "fr", name: "Fouinar" });
    expect(r.candidates.length).toBeLessThanOrEqual(3);
  });

  it("requires review when only the name is readable and it was reprinted", async () => {
    const r = await findCandidates(sql, { language: "fr", name: "Fouinar" });
    expect(r.candidates.map((c) => c.setId).sort()).toEqual(["sm1", "swsh3", "xy1"]);
    expect(r).toMatchObject({ ambiguous: true, requiresReview: true });
  });

  it("uses the printed total to tell apart two cards with the same name and number", async () => {
    const r = await findCandidates(sql, { language: "fr", name: "Fouinar", collectorNumber: "136/149" });
    expect(r.candidates[0]!.setId).toBe("sm1");
    expect(r.ambiguous).toBe(false);
  });

  it("tolerates OCR typos and missing accents in the name", async () => {
    const r = await findCandidates(sql, { language: "fr", name: "DRACAUFEU", collectorNumber: "4/102" });
    expect(r.candidates[0]).toMatchObject({ setId: "base1", localNumber: "4" });

    const typo = await findCandidates(sql, { language: "fr", name: "Fouinarr", collectorNumber: "136/189" });
    expect(typo.candidates[0]!.setId).toBe("swsh3");
    expect(typo.requiresReview).toBe(true); // nom imparfait : score < 0,95
  });

  it("matches zero-padded promo numbers", async () => {
    const r = await findCandidates(sql, { language: "fr", collectorNumber: "001", setId: "svp" });
    expect(r.candidates[0]).toMatchObject({ setId: "svp", localNumber: "001" });
  });

  it("always requires review when no name was read, even on an exact number match", async () => {
    const r = await findCandidates(sql, { language: "fr", collectorNumber: "136/189" });
    expect(r.candidates[0]).toMatchObject({ setId: "swsh3", score: 1 });
    expect(r.requiresReview).toBe(true);
  });

  it("does not match cards from another language", async () => {
    const r = await findCandidates(sql, { language: "en", name: "Fouinar", collectorNumber: "136/189" });
    expect(r.candidates).toEqual([]);
    expect(r.requiresReview).toBe(true);
  });

  it("exposes incomplete variants so the UI can block them", async () => {
    await syncSet(sql, fakeClient([card("me06-104")]), "fr", "me06");
    const r = await findCandidates(sql, { language: "fr", name: "Maskadra", collectorNumber: "104/103" });
    expect(r.candidates[0]!.variants).toMatchObject([{ incomplete: true }]);
  });
});
