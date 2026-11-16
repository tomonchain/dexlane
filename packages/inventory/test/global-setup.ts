import { createDb, migrate } from "@dexlane/db";
import { testDatabaseUrl } from "./db-url";

export default async function setup() {
  const url = new URL(testDatabaseUrl());
  const dbName = url.pathname.slice(1);

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = createDb(adminUrl.toString(), { max: 1 });
  const [exists] = await admin`select 1 from pg_database where datname = ${dbName}`;
  if (!exists) await admin.unsafe(`create database "${dbName}"`);
  await admin.end();

  const sql = createDb(url.toString(), { max: 1 });
  await sql.unsafe("drop schema public cascade; create schema public;");
  await migrate(sql);
  await sql.end();
}
