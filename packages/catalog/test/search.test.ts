import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { searchCatalog, syncSet } from "../src";
import { card, fakeClient } from "./fixtures";

const sql = useTestDb("catalog");
const client = fakeClient([card("swsh3-136"), card("base1-4"), card("sv03.5-151")]);

describe("free-text catalogue search", () => {
  it("finds cards by name, number or set in one entry, ignoring accents and case", async () => {
    for (const set of ["swsh3", "base1", "sv03.5"]) await syncSet(sql, client, "fr", set);
    const names = async (q: string) => [...new Set((await searchCatalog(sql, q)).map((h) => `${h.name} ${h.localNumber}`))];

    expect(await names("dracaufeu")).toEqual(["Dracaufeu 4"]);
    expect((await searchCatalog(sql, "dracaufeu")).map((h) => h.subtype)).toHaveLength(4); // une ligne par variante
    expect(await names("DRACAUFEU 4/102")).toEqual(["Dracaufeu 4"]);
    expect(await names("dracaufeu 5")).toEqual([]);
    expect(await names("fouinar tenebres")).toEqual(["Fouinar 136"]); // nom + série, sans accent
    expect(await names("mew 151")).toEqual(["Mew-ex 151"]);
    expect(await names("136")).toEqual(["Fouinar 136"]);
    expect(await names("x")).toEqual([]); // trop court
    expect((await searchCatalog(sql, "mew"))[0]).toMatchObject({ name: "Mew-ex", setName: "151", prefix: true, finish: "holo" });
  });
});
