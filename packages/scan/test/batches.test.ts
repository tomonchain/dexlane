import { describe, expect, it } from "vitest";
import { syncSet } from "@dexlane/catalog";
import { useTestDb } from "@dexlane/db/testing";
import { createLocation, recordPhoto } from "@dexlane/inventory";
import { card, fakeClient } from "../../catalog/test/fixtures";
import { addItem, createBatch, getBatch, identifyCard, listBatches, listItems, planCards, receiveBatch, receiveReady, setItemBack, updateBatch, updateItem, type CardRecognizer } from "../src";

const sql = useTestDb("scan");
const ACTOR = "test";
const reading = {
  card_detected: true, name: "Fouinar", collector_number: "136/189", set_code: "DAA", language: "fr" as const,
  finish_hint: "reverse" as const, first_edition_stamp: false, name_legibility: "clear" as const, number_legibility: "clear" as const, notes: null,
};
const recognizer = (overrides: object = {}): CardRecognizer => ({
  recognize: async () => ({ reading: { ...reading, ...overrides }, model: "fake", servedBy: "fake", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, latencyMs: 1 }),
});
const image = { data: Buffer.from([1]), mediaType: "image/jpeg" as const };
let seq = 0;
const photo = (kind: "SCAN_FRONT" | "SCAN_BACK" = "SCAN_FRONT") =>
  recordPhoto(sql, { kind, storageKey: `p-${++seq}`, url: `https://blob.test/p-${seq}.jpg`, contentType: "image/jpeg", byteSize: 1 });

async function setup() {
  await syncSet(sql, fakeClient([card("swsh3-136"), card("base1-4")]), "fr", "swsh3");
  await syncSet(sql, fakeClient([card("swsh3-136"), card("base1-4")]), "fr", "base1");
  await createLocation(sql, { code: "BOITE-07" });
  return createBatch(sql, { location: { code: "BOITE-07" }, unitCostCents: 10 });
}
const scan = async (batchId: string, position: number, overrides: object = {}) =>
  addItem(sql, { batchId, position, fileName: `scan_${position}.jpg`, frontPhotoId: (await photo()).id, identification: await identifyCard(sql, recognizer(overrides), image) });

describe("ordering scanner files", () => {
  it("sorts files the way the scanner numbered them and pairs front with back", () => {
    expect(planCards(["scan_10.jpg", "scan_2.jpg", "scan_1.jpg"], false).map((c) => c.front)).toEqual(["scan_1.jpg", "scan_2.jpg", "scan_10.jpg"]);
    expect(planCards(["b_0004.jpg", "b_0001.jpg", "b_0003.jpg", "b_0002.jpg"], true)).toEqual([
      { position: 1, front: "b_0001.jpg", back: "b_0002.jpg" }, { position: 2, front: "b_0003.jpg", back: "b_0004.jpg" },
    ]);
    // Un recto dont le verso n'est pas encore arrivé attend : il ne devient pas une carte sans verso.
    expect(planCards(["a_1.jpg", "a_2.jpg", "a_3.jpg"], true)).toHaveLength(1);
  });
});

describe("a scan batch", () => {
  it("keeps every scanned card at its rank, preselects sure readings and survives a replay", async () => {
    const batch = await setup();
    expect(batch).toMatchObject({ locationCode: "BOITE-07", unitCostCents: 10, defaultCondition: null, counts: { items: 0 } });
    expect(batch.name).toMatch(/^Lot du /);

    const sure = await scan(batch.id, 1);
    expect(sure).toMatchObject({ position: 1, sure: true, ready: false, card: { name: "Fouinar", setId: "swsh3" }, condition: null });
    expect(sure.card!.variants.find((v) => v.id === sure.variantId)!.finish).toBe("reverse");
    const doubtful = await scan(batch.id, 2, { name: "Fouin", name_legibility: "partial" });
    expect(doubtful).toMatchObject({ sure: false, card: null, variantId: null, reviewReasons: ["name partial"] });
    expect(doubtful.candidates[0]!.name).toBe("Fouinar");
    const failed = await addItem(sql, { batchId: batch.id, position: 3, fileName: "scan_3.jpg", frontPhotoId: null, identification: { error: "service de lecture indisponible" } });
    expect(failed).toMatchObject({ scanError: "service de lecture indisponible", card: null, candidates: [] });

    // Rejouer un rang déjà lu ne crée pas de doublon et ne change rien.
    expect((await scan(batch.id, 1, { name: "Dracaufeu" })).id).toBe(sure.id);
    expect((await listItems(sql, batch.id)).map((i) => i.position)).toEqual([1, 2, 3]);
    expect((await getBatch(sql, batch.id)).counts).toEqual({ items: 3, toReview: 3, received: 0, skipped: 0 });
  });

  it("is received in scan order once every card is decided, with photos attached", async () => {
    const batch = await setup();
    const first = await scan(batch.id, 1, { name: "Fouin", name_legibility: "partial" });
    const second = await scan(batch.id, 2);
    const third = await scan(batch.id, 3);
    await setItemBack(sql, second.id, (await photo("SCAN_BACK")).id);

    await expect(receiveBatch(sql, batch.id, ACTOR)).rejects.toMatchObject({ code: "BATCH_NOT_READY", details: { positions: [1, 2, 3] } });
    await updateBatch(sql, batch.id, { defaultCondition: "NM" });
    await expect(receiveBatch(sql, batch.id, ACTOR)).rejects.toMatchObject({ details: { positions: [1] } });

    // Revue : la première carte est choisie à la main avec un état à elle, la troisième est écartée.
    const candidate = first.candidates[0]!;
    await expect(updateItem(sql, first.id, { variantId: crypto.randomUUID() })).rejects.toMatchObject({ code: "VARIANT_NOT_FOUND" });
    const chosen = await updateItem(sql, first.id, { catalogCardId: candidate.catalogCardId, variantId: candidate.variants.find((v) => v.finish === "normal")!.id, condition: "EX" });
    expect(chosen).toMatchObject({ ready: true, sure: false, condition: "EX" });
    await updateItem(sql, third.id, { skipped: true });
    expect((await getBatch(sql, batch.id)).counts).toEqual({ items: 3, toReview: 0, received: 0, skipped: 1 });

    const priced: string[] = [];
    const result = await receiveBatch(sql, batch.id, ACTOR, async (_tx, r) => priced.push(r.offer.offerSku));
    expect(result.received).toBe(2);
    expect(Number(result.lastSku!.slice(3))).toBe(Number(result.firstSku!.slice(3)) + 1);
    expect(priced).toEqual(["OF-SWSH3-136-FR-N-EX", "OF-SWSH3-136-FR-R-NM"]);

    const items = await listItems(sql, batch.id);
    expect(items.map((i) => i.unitSku)).toEqual([result.firstSku, result.lastSku, null]);
    const photos = await sql`select kind from photos where stock_item_id is not null order by kind`;
    expect(photos.map((p) => p.kind)).toEqual(["SCAN_BACK", "SCAN_FRONT", "SCAN_FRONT"]);
    const [stock] = await sql`select l.code, s.unit_cost_cents from stock_items s join locations l on l.id = s.location_id where s.unit_sku = ${result.firstSku}`;
    expect(stock).toMatchObject({ code: "BOITE-07", unitCostCents: 10 });

    // Un lot entré en stock ne se rejoue pas et ne se modifie plus.
    expect(await receiveBatch(sql, batch.id, ACTOR)).toMatchObject({ received: 0 });
    await expect(updateItem(sql, first.id, { condition: "PO" })).rejects.toMatchObject({ code: "ITEM_ALREADY_RECEIVED" });
    await expect(updateBatch(sql, batch.id, { defaultCondition: "PO" })).rejects.toMatchObject({ code: "BATCH_ALREADY_RECEIVED" });
    expect((await listBatches(sql))[0]).toMatchObject({ id: batch.id, counts: { items: 3, received: 2, skipped: 1 } });
  });

  it("on autopilot, receives complete cards as they come without waiting for the doubtful ones", async () => {
    // Le pilote automatique exige un état par défaut : sans lui, aucune carte n'est complète.
    await setup();
    await expect(createBatch(sql, { location: { code: "BOITE-07" }, autopilot: true })).rejects.toMatchObject({ code: "AUTOPILOT_NEEDS_CONDITION" });
    await expect(createBatch(sql, { location: { code: "BOITE-07" }, autopilot: true, defaultCondition: "NM", publishMode: "DAILY" })).rejects.toMatchObject({ code: "INVALID_SCHEDULE" });
    const batch = await createBatch(sql, { location: { code: "BOITE-07" }, autopilot: true, defaultCondition: "NM", publishMode: "DAILY", publishPerDay: 20, paired: false });
    expect(batch).toMatchObject({ autopilot: true, publishMode: "DAILY", publishPerDay: 20 });

    const first = await scan(batch.id, 1);
    const doubtful = await scan(batch.id, 2, { name: "Fouin", name_legibility: "partial" });
    const third = await scan(batch.id, 3);
    const priced: string[] = [];
    const run = await receiveReady(sql, batch.id, ACTOR, async (_tx, r) => priced.push(r.offer.offerSku));
    // Les cartes 1 et 3 entrent, dans l'ordre du scan ; la 2 attend une décision sans bloquer les autres.
    expect(run.received.map((r) => r.offer.offerSku)).toEqual(["OF-SWSH3-136-FR-R-NM", "OF-SWSH3-136-FR-R-NM"]);
    expect(priced).toHaveLength(2);
    let items = await listItems(sql, batch.id);
    expect(items.map((i) => !!i.unitSku)).toEqual([true, false, true]);
    expect(Number(items[2]!.unitSku!.slice(3))).toBe(Number(items[0]!.unitSku!.slice(3)) + 1);
    expect((await getBatch(sql, batch.id))).toMatchObject({ receivedAt: null, counts: { items: 3, toReview: 1, received: 2 } });
    expect((await receiveReady(sql, batch.id, ACTOR)).received).toEqual([]); // rien de nouveau : rien n'est repris

    // Une fois corrigée, la carte douteuse suit ; le lot reste ouvert pour les cartes suivantes.
    const candidate = doubtful.candidates[0]!;
    await updateItem(sql, doubtful.id, { catalogCardId: candidate.catalogCardId, variantId: candidate.variants.find((v) => v.finish === "normal")!.id });
    expect((await receiveReady(sql, batch.id, ACTOR)).received.map((r) => r.offer.offerSku)).toEqual(["OF-SWSH3-136-FR-N-NM"]);
    expect((await scan(batch.id, 4)).position).toBe(4);
    // Couper le pilote automatique ne demande rien d'autre ; retirer l'état par défaut en le gardant est refusé.
    await expect(updateBatch(sql, batch.id, { defaultCondition: null })).rejects.toMatchObject({ code: "AUTOPILOT_NEEDS_CONDITION" });
    expect(await updateBatch(sql, batch.id, { autopilot: false, publishMode: "NONE" })).toMatchObject({ autopilot: false, publishMode: "NONE", publishPerDay: null });
    void first; void third;
  });

  it("on autopilot with front and back scans, waits for the back before receiving a card", async () => {
    await setup();
    const batch = await createBatch(sql, { location: { code: "BOITE-07" }, autopilot: true, defaultCondition: "NM" });
    const withBack = await scan(batch.id, 1);
    const frontOnly = await scan(batch.id, 2);
    await setItemBack(sql, withBack.id, (await photo("SCAN_BACK")).id);
    expect((await receiveReady(sql, batch.id, ACTOR)).received).toHaveLength(1);
    expect((await listItems(sql, batch.id)).map((i) => !!i.unitSku)).toEqual([true, false]);
    // Le verso n'est jamais arrivé : passé le délai, la carte entre avec son seul recto.
    expect((await receiveReady(sql, batch.id, ACTOR, undefined, { now: new Date(Date.now() + 61_000) })).received).toHaveLength(1);
    void frontOnly;
  });
});
