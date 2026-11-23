import { describe, expect, it } from "vitest";
import { useTestDb } from "@dexlane/db/testing";
import { attachPhotos, createLocation, receiveCard, recordPhoto, saveListingPhoto } from "@dexlane/inventory";
import { DEFAULT_LISTING_SETTINGS, getListingSettings, listListingOffers, saveListingSettings } from "../src";

const sql = useTestDb("listings");
const ACTOR = "test";
let seq = 0;
const file = (name: string) => ({ storageKey: `${name}-${++seq}`, url: `https://blob.test/${name}-${seq}.jpg`, contentType: "image/jpeg", byteSize: 10 });

async function stockCharizard(opts: { draft?: boolean } = {}) {
  await sql`insert into catalog_sets (id, language, name, serie_name, card_count_official) values ('base1', 'fr', 'Set de Base', 'Wizards', 102) on conflict do nothing`;
  const [card] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language, rarity) values ('base1', ${String(++seq)}, 'Dracaufeu', 'fr', 'Rare') returning id`;
  const [variant] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish) values (${card!.id}, 'holo') returning id`;
  await createLocation(sql, { code: "BOX-01" });
  return receiveCard(sql, { variantId: variant!.id, condition: "EX", quantity: 2, location: { code: "BOX-01" }, unitCostCents: 0, draft: opts.draft, actor: ACTOR });
}

describe("listing settings", () => {
  it("starts from the defaults, saves changes with an audit trail and refuses invalid ones", async () => {
    expect(await getListingSettings(sql)).toEqual(DEFAULT_LISTING_SETTINGS);
    const next = { ...DEFAULT_LISTING_SETTINGS, titleTemplate: "{nom} {etat}", photo: { ...DEFAULT_LISTING_SETTINGS.photo, caption: "ma boutique" } };
    await saveListingSettings(sql, next, ACTOR);
    expect(await getListingSettings(sql)).toEqual(next);
    expect(await sql`select actor from audit_events where action = 'listing_settings_changed'`).toHaveLength(1);
    await expect(saveListingSettings(sql, { ...next, descriptionTemplate: "" }, ACTOR)).rejects.toMatchObject({ code: "INVALID_LISTING_SETTINGS" });
  });

  it("only accepts a background image that was uploaded as one", async () => {
    const scan = await recordPhoto(sql, { ...file("scan"), kind: "SCAN_FRONT" });
    const background = await recordPhoto(sql, { ...file("fond"), kind: "BACKGROUND" });
    const withImage = (photoId: string) => ({ ...DEFAULT_LISTING_SETTINGS, photo: { ...DEFAULT_LISTING_SETTINGS.photo, background: { type: "image" as const, photoId } } });
    await expect(saveListingSettings(sql, withImage(scan.id), ACTOR)).rejects.toMatchObject({ code: "INVALID_LISTING_SETTINGS" });
    await saveListingSettings(sql, withImage(background.id), ACTOR);
    expect((await getListingSettings(sql)).photo.background).toEqual({ type: "image", photoId: background.id });
  });

  it("keeps a shop logo uploaded as one, placed in a corner next to the powered-by mention", async () => {
    // Réglages enregistrés avant l'arrivée du logo : la mention « powered by » est là par défaut, sans logo.
    expect((await getListingSettings(sql)).photo).toMatchObject({ logoPhotoId: null, brandPosition: "bottom-left", poweredBy: true });
    const background = await recordPhoto(sql, { ...file("fond"), kind: "BACKGROUND" });
    const logo = await recordPhoto(sql, { ...file("logo"), kind: "LOGO" });
    const withLogo = (logoPhotoId: string) => ({ ...DEFAULT_LISTING_SETTINGS, photo: { ...DEFAULT_LISTING_SETTINGS.photo, logoPhotoId, brandPosition: "top-right" as const, poweredBy: false } });
    await expect(saveListingSettings(sql, withLogo(background.id), ACTOR)).rejects.toMatchObject({ code: "INVALID_LISTING_SETTINGS" });
    await saveListingSettings(sql, withLogo(logo.id), ACTOR);
    expect((await getListingSettings(sql)).photo).toMatchObject({ logoPhotoId: logo.id, brandPosition: "top-right", poweredBy: false });
  });
});

describe("offers to list", () => {
  it("returns sellable offers with their rendered text and photos, and skips drafts", async () => {
    const received = await stockCharizard();
    await stockCharizard({ draft: true });
    const scan = await recordPhoto(sql, { ...file("scan"), kind: "SCAN_FRONT" });
    await attachPhotos(sql, [scan.id], { stockItemId: received.stockItem.id, offerId: received.offer.id });

    const { items, total } = await listListingOffers(sql);
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ offerId: received.offer.id, cardName: "Dracaufeu", condition: "EX", available: 2 });
    expect(items[0]!.text.title).toMatch(/^Dracaufeu \d+\/102 Set de Base Holo FR EX Carte Pokémon$/);
    expect(items[0]!.photos.map((p) => p.kind)).toEqual(["SCAN_FRONT"]);
    expect((await listListingOffers(sql, { q: "pikachu" })).total).toBe(0);
  });

  it("keeps one composed listing photo per scan, attached like the scan", async () => {
    const received = await stockCharizard();
    const scan = await recordPhoto(sql, { ...file("scan"), kind: "SCAN_FRONT" });
    await attachPhotos(sql, [scan.id], { stockItemId: received.stockItem.id, offerId: received.offer.id });

    const first = await saveListingPhoto(sql, scan.id, file("annonce"));
    expect(first).toMatchObject({ replacedUrl: null, photo: { kind: "LISTING", offerId: received.offer.id, stockItemId: received.stockItem.id, sourcePhotoId: scan.id } });
    const second = await saveListingPhoto(sql, scan.id, file("annonce"));
    expect(second.replacedUrl).toBe(first.photo.url);
    const listed = (await listListingOffers(sql)).items[0]!;
    expect(listed.photos.map((p) => p.kind)).toEqual(["LISTING", "SCAN_FRONT"]);
    await expect(saveListingPhoto(sql, second.photo.id, file("annonce"))).rejects.toMatchObject({ code: "PHOTO_NOT_FOUND" });
  });
});
