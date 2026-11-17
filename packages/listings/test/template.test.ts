import { describe, expect, it } from "vitest";
import {
  DEFAULT_LISTING_SETTINGS, buildListingText, renderTemplate, truncateTitle, unknownVariables, validateListingSettings, variablesOf,
  type ListingSubject,
} from "../src";

const charizard: ListingSubject = {
  name: "Dracaufeu", localNumber: "004", setId: "base1", setName: "Set de Base", serieName: "Wizards", officialCount: 102, language: "fr",
  rarity: "Rare", finish: "holo", edition: "1st", subtype: "", stamp: "", condition: "NM", offerSku: "OF-BASE1-004-FR-H1-NM",
  targetPriceCents: 25000,
};

describe("listing variables", () => {
  it("prints the collector number the way it is printed on the card", () => {
    expect(variablesOf(charizard).numero).toBe("4/102");
    expect(variablesOf({ ...charizard, localNumber: "TG05" }).numero).toBe("TG05");
    expect(variablesOf({ ...charizard, officialCount: null }).numero).toBe("004");
  });

  it("names the variant, the language, the condition and the price in plain words", () => {
    expect(variablesOf(charizard)).toMatchObject({
      variante: "Holo Édition 1", langue: "FR", langue_nom: "Français", etat: "NM", etat_nom: "Near Mint", serie_code: "BASE1", bloc: "Wizards",
    });
    expect(variablesOf(charizard).prix).toMatch(/^250\s€$/);
    expect(variablesOf({ ...charizard, targetPriceCents: 150 }).prix).toMatch(/^1,50\s€$/);
    expect(variablesOf({ ...charizard, targetPriceCents: null }).prix).toBe("");
  });
});

describe("rendering a template", () => {
  it("fills the default title and description", () => {
    const text = buildListingText(charizard, DEFAULT_LISTING_SETTINGS);
    expect(text.title).toBe("Dracaufeu 4/102 Set de Base Holo Édition 1 FR NM Carte Pokémon");
    expect(text.description).toContain("Dracaufeu — Set de Base (4/102)");
    expect(text.description).toContain("État : Near Mint (NM)");
    expect(text.description).toContain("Référence : OF-BASE1-004-FR-H1-NM");
    expect(text.warnings).toEqual([]);
  });

  it("drops a line whose variables are all empty and tightens the gaps left by an empty one", () => {
    const values = { nom: "Pikachu", rarete: "", bloc: "" };
    expect(renderTemplate("{nom}\nRareté : {rarete}\nFin", values)).toBe("Pikachu\nFin");
    expect(renderTemplate("{nom} {rarete} ({bloc}) carte", values)).toBe("Pikachu carte");
    expect(renderTemplate("A\n\n{rarete}\n\nB", values)).toBe("A\n\nB");
  });

  it("flags a title over the channel limit and cuts it at a word boundary", () => {
    const text = buildListingText({ ...charizard, name: "Dracaufeu de Giovanni brillant chromatique obscur" }, DEFAULT_LISTING_SETTINGS);
    expect(text.warnings).toContain("TITLE_TOO_LONG");
    expect(text.title.length).toBeLessThanOrEqual(80);
    expect(text.title.endsWith(" ")).toBe(false);
    expect(truncateTitle("a".repeat(100))).toHaveLength(80);
  });

  it("reports unknown variables instead of silently publishing them", () => {
    expect(unknownVariables("{nom} {nmo} {prix} {nmo}")).toEqual(["nmo"]);
    expect(buildListingText(charizard, { titleTemplate: "{nom} {nmo}", descriptionTemplate: "x" })).toMatchObject({
      title: "Dracaufeu {nmo}", warnings: ["UNKNOWN_VARIABLE"],
    });
  });
});

describe("validating listing settings", () => {
  it("accepts the defaults and refuses empty templates, odd sizes and invalid colors", () => {
    const d = DEFAULT_LISTING_SETTINGS;
    expect(validateListingSettings(d)).toBeNull();
    expect(validateListingSettings({ ...d, titleTemplate: "  " })).toMatch(/titre/);
    expect(validateListingSettings({ ...d, photo: { ...d.photo, size: 200 } })).toMatch(/taille/);
    expect(validateListingSettings({ ...d, photo: { ...d.photo, background: { type: "color", color: "red" } } })).toMatch(/Couleur/);
    expect(validateListingSettings({ ...d, photo: { ...d.photo, background: { type: "image", photoId: "x" } } })).toBeNull();
  });
});
