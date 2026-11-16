import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Db } from "./index";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../../infra/migrations", import.meta.url));

const LOCK_KEY = 7_420_011; // verrou consultatif : une seule migration à la fois

/** Applique dans l'ordre les fichiers .sql non encore appliqués, chacun dans sa transaction. */
export async function migrate(sql: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  const applied: string[] = [];
  await sql.reserve().then(async (conn) => {
    try {
      await conn`select pg_advisory_lock(${LOCK_KEY})`;
      await conn`
        create table if not exists schema_migrations (
          name text primary key,
          applied_at timestamptz not null default now()
        )`;
      const done = new Set((await conn<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
      const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files) {
        if (done.has(file)) continue;
        const body = await readFile(join(dir, file), "utf8");
        await conn`begin`;
        try {
          await conn.unsafe(body);
          await conn`insert into schema_migrations (name) values (${file})`;
          await conn`commit`;
        } catch (e) {
          await conn`rollback`;
          throw new Error(`migration ${file} failed: ${(e as Error).message}`, { cause: e });
        }
        applied.push(file);
      }
    } finally {
      await conn`select pg_advisory_unlock(${LOCK_KEY})`;
      conn.release();
    }
  });
  return applied;
}
