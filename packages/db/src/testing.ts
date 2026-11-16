import { afterAll, beforeEach } from "vitest";
import { createDb, type Db } from "./index";
import { migrate } from "./migrate";

/**
 * URL de la base de test d'un package. Chaque package a sa propre base pour que
 * `pnpm -r test` puisse exécuter les packages en parallèle.
 * Base : TEST_DATABASE_URL (défaut postgres://localhost:5432/dexlane_test) → dexlane_<scope>_test.
 */
export function testDatabaseUrl(scope: string): string {
  const base = new URL(process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/dexlane_test");
  const name = base.pathname.slice(1);
  // Garde-fou : les tests vident la base. Refuser toute base qui n'est pas explicitement une base de test.
  if (!name.endsWith("_test")) throw new Error(`refusing to run tests against non-test database "${name}"`);
  base.pathname = `/${name.slice(0, -"_test".length)}_${scope}_test`;
  return base.toString();
}

/** À appeler depuis le globalSetup Vitest : crée la base si besoin, repart d'un schéma vierge, migre. */
export async function prepareTestDatabase(scope: string): Promise<void> {
  const url = new URL(testDatabaseUrl(scope));
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

/** Connexion partagée par fichier de test ; toutes les tables vidées avant chaque test. */
export function useTestDb(scope: string): Db {
  const sql = createDb(testDatabaseUrl(scope), { max: 10 });
  beforeEach(async () => {
    const tables = await sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'`;
    await sql.unsafe(`truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`);
  });
  afterAll(() => sql.end());
  return sql;
}
