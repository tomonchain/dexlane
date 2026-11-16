import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { normalizeNumber, parseCollectorNumber } from "../src";

describe("normalizeNumber", () => {
  it.each([
    ["001", "1"], ["136", "136"], ["100", "100"], ["0", "0"], ["000", "0"],
    ["TG05", "tg5"], ["SWSH050", "swsh50"], ["SV-P 012", "sv-p12"], ["RC5", "rc5"],
  ])("%s → %s", (raw, expected) => expect(normalizeNumber(raw)).toBe(expected));
});

describe("parseCollectorNumber", () => {
  it.each([
    ["136/189", { number: "136", printedTotal: 189 }],
    [" 136 / 189 ", { number: "136", printedTotal: 189 }],
    ["004/102", { number: "004", printedTotal: 102 }],
    ["TG05/TG30", { number: "TG05" }],
    ["SWSH050", { number: "SWSH050" }],
    ["136|189", { number: "136", printedTotal: 189 }],
  ])("%s", (text, expected) => expect(parseCollectorNumber(text)).toEqual(expected));

  it("returns null for unreadable text", () => expect(parseCollectorNumber("illisible")).toBeNull());
});

describe("normalizeNumber matches the generated database column", () => {
  const sql = useTestDb("catalog");
  it("for every sample", async () => {
    const samples = ["001", "136", "100", "0", "000", "TG05", "SWSH050", "SV-P 012", "RC5", "H07", "SM-P 100"];
    for (const [i, raw] of samples.entries()) {
      await sql`insert into catalog_cards (set_id, local_number, name, language) values ('x', ${raw}, ${`c${i}`}, 'fr')`;
    }
    const rows = await sql<{ localNumber: string; numberNormalized: string }[]>`
      select local_number, number_normalized from catalog_cards`;
    for (const r of rows) expect(r.numberNormalized, r.localNumber).toBe(normalizeNumber(r.localNumber));
  });
});
