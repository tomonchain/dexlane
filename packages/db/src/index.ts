import postgres from "postgres";

export type Db = postgres.Sql<{}>;

export function createDb(url = process.env.DATABASE_URL, options: postgres.Options<{}> = {}): Db {
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    max: 10,
    onnotice: () => {},
    // Colonnes snake_case en base → camelCase dans les résultats.
    transform: { column: { from: postgres.toCamel } },
    ...options,
  });
}

/**
 * Exécute `fn` dans une transaction. Le handle `tx` est typé comme `Db`
 * (contourne la perte de signature d'appel de `TransactionSql` dans les types postgres.js).
 */
export function withTx<T>(sql: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return sql.begin((tx) => fn(tx as unknown as Db)) as Promise<T>;
}

// `migrate` vit dans "@dexlane/db/migrate" : il lit des fichiers .sql sur disque et ne doit pas
// être embarqué dans un bundle applicatif (Next).
