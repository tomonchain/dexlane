/**
 * Données fictives pour regarder les écrans des statistiques, des récaps et de la progression (captures, essais à la
 * main). À lancer sur une base de développement vide, jamais sur une vraie base :
 *
 *   DATABASE_URL=postgres://…/dexlane_demo tsx packages/insights/test/demo-seed.ts
 *
 * Six mois d'une boutique : cartes entrées, mises en ligne, vendues (eBay, ventes directes, quelques retours et
 * annulations), des cartes qui dorment depuis plus de trois mois. Puis le journal est reconstruit, la progression
 * calculée (attribution rétroactive) et le récap d'octobre 2026 généré.
 */
import { createDb, OWNER_ACCOUNT_ID } from "@dexlane/db";
import { migrate } from "@dexlane/db/migrate";
import { allocateOrder, importOrder } from "@dexlane/inventory";
import { evaluateProgress, generateDueRecaps, rebuildJournal } from "../src";

const url = process.env.DATABASE_URL ?? "";
if (!/demo|localhost|127\.0\.0\.1/.test(url)) throw new Error("refusing to seed demo data outside a local or demo database");
const sql = createDb(url, { max: 2 });
await migrate(sql);

const [existing] = await sql<{ n: number }[]>`select count(*)::int as n from offers`;
if (existing!.n > 0) throw new Error("this database already has offers: seed an empty database");

const NOW = new Date();
const DAY = 86_400_000;
const ago = (days: number, hour = 14) => {
  const d = new Date(NOW.getTime() - days * DAY);
  d.setUTCHours(hour, (days * 7) % 60, 0, 0);
  return d;
};
// Un générateur déterministe : les mêmes données à chaque lancement.
let seed = 42;
const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);

const SETS = [
  { id: "sv03.5", name: "151" }, { id: "sv03", name: "Flammes Obsidiennes" }, { id: "swsh7", name: "Évolution Céleste" },
  { id: "sv06", name: "Mascarade Crépusculaire" }, { id: "swsh12.5", name: "Zénith Suprême" },
];
const CARDS: [string, number, number][] = [
  // nom, prix en centimes, exemplaires
  ["Dracaufeu ex", 18_900, 1], ["Mew ex", 6_400, 2], ["Pikachu", 450, 12], ["Évoli", 320, 10], ["Lugia V", 8_900, 1],
  ["Ronflex", 280, 8], ["Mewtwo ex", 3_900, 2], ["Rayquaza VMAX", 12_500, 1], ["Salamèche", 650, 6], ["Bulbizarre", 520, 6],
  ["Carapuce", 540, 6], ["Ectoplasma", 1_200, 4], ["Lokhlass", 380, 5], ["Dracolosse", 2_200, 2], ["Lucario", 890, 4],
  ["Gardevoir ex", 2_600, 2], ["Magicarpe", 90, 20], ["Léviator", 1_450, 3], ["Noctali", 2_950, 2], ["Mentali", 1_800, 2],
  ["Aquali", 1_250, 3], ["Pyroli", 1_150, 3], ["Voltali", 1_100, 3], ["Givrali V", 4_200, 1], ["Nymphali VMAX", 21_000, 1],
  ["Florizarre ex", 4_800, 1], ["Tortank ex", 3_600, 1], ["Alakazam ex", 2_100, 2], ["Mackogneur", 310, 6], ["Kangourex", 260, 6],
];

for (const s of SETS) {
  await sql`insert into catalog_sets (id, language, name) values (${s.id}, 'fr', ${s.name}) on conflict do nothing`;
}
await sql`insert into locations (code) values ('CLASSEUR-A'), ('CLASSEUR-B'), ('BOITE-01'), ('BOITE-02') on conflict do nothing`;
const locations = await sql<{ id: string; code: string }[]>`select id, code from locations order by code`;
await sql`
  insert into app_settings (account_id, settings) values (${OWNER_ACCOUNT_ID}, ${sql.json({ onboardingDone: true, seller: { name: "Les Cartes de Sam", address: "", legal: "" } })})
  on conflict (account_id) do update set settings = excluded.settings`;
await sql`insert into channel_settings (channel, mode) values ('ebay', 'SIMULATION') on conflict do nothing`;

let sku = 0;
let order = 0;
for (const [i, [name, price, copies]] of CARDS.entries()) {
  const set = SETS[i % SETS.length]!;
  const [card] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language, rarity) values (${set.id}, ${String(10 + i)}, ${name}, 'fr', ${price > 3000 ? "Rare" : "Commune"}) returning id`;
  const [variant] = await sql<{ id: string }[]>`insert into card_variants (catalog_card_id, finish) values (${card!.id}, 'holo') returning id`;
  const unique = copies === 1;
  const [offer] = await sql<{ id: string; offerSku: string }[]>`
    insert into offers (offer_sku, variant_id, condition, is_unique, status, category, target_price_cents, grader, grade)
    values (${`OF-DEMO-${++sku}`}, ${variant!.id}, 'NM', ${unique}, 'ACTIVE', ${price > 3000 ? "PREMIUM" : "SINGLE"}, ${price},
            ${name === "Dracaufeu ex" ? "PSA" : null}, ${name === "Dracaufeu ex" ? "10" : null})
    returning id, offer_sku`;
  // Entrée en stock entre 200 et 20 jours avant aujourd'hui ; les 5 dernières cartes dorment depuis plus de 3 mois.
  const dormant = i >= CARDS.length - 5;
  const enteredDays = dormant ? 150 + i : 20 + Math.floor(rand() * 170);
  const location = locations[i % locations.length]!;
  const [item] = await sql<{ id: string }[]>`
    insert into stock_items (unit_sku, kind, offer_id, location_id, unit_cost_cents, on_hand, lifecycle, created_at)
    values (${`SI-DEMO-${sku}`}, ${unique ? "UNIQUE" : "FUNGIBLE"}, ${offer!.id}, ${location.id}, ${i % 4 === 3 ? 0 : Math.round(price * 0.45)}, ${copies}, 'ACTIVE', ${ago(enteredDays)})
    returning id`;
  await sql`
    insert into inventory_movements (stock_item_id, movement_type, bucket, qty_delta, to_location_id, actor, created_at)
    values (${item!.id}, 'RECEIVE', 'on_hand', ${copies}, ${location.id}, 'demo', ${ago(enteredDays)})`;
  const listedDays = enteredDays - 1 - Math.floor(rand() * 3);
  await sql`
    insert into listings (offer_id, channel, external_id, price_cents, status, quantity_sent, created_at, updated_at)
    values (${offer!.id}, 'ebay', ${`EB-DEMO-${sku}`}, ${price}, 'ACTIVE', ${copies}, ${ago(listedDays, 9)}, ${ago(listedDays, 9)})`;
  if (dormant) continue;

  // Les ventes : une partie des exemplaires, entre la mise en ligne et aujourd'hui.
  const sold = Math.max(1, Math.floor(copies * (0.4 + rand() * 0.5)));
  for (let k = 0; k < sold; k++) {
    const soldDays = Math.max(0, listedDays - 1 - Math.floor(rand() * Math.max(1, listedDays - 1)));
    const direct = (i + k) % 9 === 0;
    const { orderId } = await importOrder(sql, {
      channel: direct ? "direct" : "ebay", externalId: `${direct ? "V" : "EB"}-DEMO-${++order}`, paymentStatus: "PAID",
      grossCents: price, currency: (i + k) % 17 === 5 ? "GBP" : "EUR", orderedAt: ago(soldDays, 10 + (k % 10)),
      shippingAddress: { name: "Acheteur", country: (i + k) % 7 === 2 ? "BE" : "FR" },
      lines: [{ externalLineId: "1", offerSku: offer!.offerSku, qty: 1, unitPriceCents: Math.round(price * (0.9 + rand() * 0.2)) }],
    });
    await allocateOrder(sql, orderId, "demo");
    await sql`insert into shipments (order_id, mode, status, tracking) values (${orderId}, 'LETTER_TRACKED', ${(i + k) % 23 === 11 ? "RETURNED" : "PENDING"}, ${`LS${order}FR`})`;
    if ((i + k) % 19 === 7) await sql`update orders set fulfillment_status = 'CANCELLED' where id = ${orderId}`;
    if (k === 0 && i % 3 === 0) await sql`update orders set slip_printed_at = ${ago(soldDays, 18)} where id = ${orderId}`;
  }
}
// eBay connecté et ses règles choisies (pour le parcours de démarrage).
await sql`insert into channel_accounts (channel, environment, username, refresh_token, connected_at) values ('ebay', 'sandbox', 'cartes-de-sam', 'demo', ${ago(200)}) on conflict do nothing`;
await sql`
  update channel_settings set config = ${sql.json({ settings: { marketplaceId: "EBAY_FR", categoryId: "183454", fulfillmentPolicyId: "F1", paymentPolicyId: "P1", returnPolicyId: "R1", merchantLocationKey: "DEXLANE" } })}
   where channel = 'ebay'`;

const rebuilt = await rebuildJournal(sql);
const progress = await evaluateProgress(sql, { timezone: "Europe/Paris" });
const recaps = await generateDueRecaps(sql, { timezone: "Europe/Paris", now: new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1, 6)) });
console.log({ rebuilt, level: progress.level, confirmed: progress.confirmed, unlocked: progress.unlocked, recaps });
await sql.end();
