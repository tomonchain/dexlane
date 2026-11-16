import { afterAll, beforeEach } from "vitest";
import { createDb, type Db } from "@dexlane/db";
import { importOrder, receiveStock, type StockKind } from "../src";
import { testDatabaseUrl } from "./db-url";

export const ACTOR = "test";

/** Connexion partagée par fichier de test ; tables vidées avant chaque test. */
export function useTestDb(): Db {
  const sql = createDb(testDatabaseUrl(), { max: 10 });
  beforeEach(async () => {
    const tables = await sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'`;
    await sql.unsafe(`truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`);
  });
  afterAll(() => sql.end());
  return sql;
}

let seq = 0;
const next = () => ++seq;

export async function makeLocation(sql: Db, code = `BOX-${next()}`) {
  const [row] = await sql<{ id: string }[]>`insert into locations (code) values (${code}) returning id`;
  return row!.id;
}

export async function makeOffer(
  sql: Db,
  opts: { isUnique?: boolean; condition?: string; sku?: string; status?: string } = {},
) {
  const n = next();
  const [card] = await sql<{ id: string }[]>`
    insert into catalog_cards (set_id, local_number, name, language)
    values ('base1', ${String(n)}, ${`Card ${n}`}, 'fr') returning id`;
  const [variant] = await sql<{ id: string }[]>`
    insert into card_variants (catalog_card_id, finish) values (${card!.id}, 'holo') returning id`;
  const [offer] = await sql<{ id: string; offerSku: string }[]>`
    insert into offers (offer_sku, variant_id, condition, is_unique, status, category)
    values (${opts.sku ?? `OF-${n}`}, ${variant!.id}, ${opts.condition ?? "NM"}, ${opts.isUnique ?? false},
            ${opts.status ?? "ACTIVE"}, 'SINGLE')
    returning id, offer_sku`;
  return { offerId: offer!.id, offerSku: offer!.offerSku, variantId: variant!.id };
}

export async function stock(
  sql: Db,
  offerId: string,
  locationId: string,
  quantity: number,
  kind: StockKind = "FUNGIBLE",
) {
  return receiveStock(sql, {
    unitSku: `SI-${next()}`,
    kind,
    offerId,
    locationId,
    unitCostCents: 100,
    quantity,
    activate: true,
    actor: ACTOR,
  });
}

export async function order(sql: Db, offerSku: string, qty = 1, externalId = `EXT-${next()}`, channel = "ebay") {
  return importOrder(sql, {
    channel,
    externalId,
    paymentStatus: "PAID",
    grossCents: 1000 * qty,
    currency: "EUR",
    orderedAt: new Date(),
    lines: [{ externalLineId: "L1", offerSku, qty, unitPriceCents: 1000 }],
  });
}

export async function lineOf(sql: Db, orderId: string) {
  const [l] = await sql<{ id: string }[]>`select id from order_lines where order_id = ${orderId}`;
  return l!.id;
}

export async function stockRow(sql: Db, id: string) {
  const [s] = await sql<{ onHand: number; reserved: number; lifecycle: string; locationId: string }[]>`
    select on_hand, reserved, lifecycle, location_id from stock_items where id = ${id}`;
  return s!;
}
