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
 * Appelé depuis une transaction déjà ouverte (requête faite pour un compte, voir `withAccount`), ouvre un point de
 * sauvegarde : l'échec de `fn` n'annule que ce qu'elle a fait.
 */
export function withTx<T>(sql: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  const savepoint = (sql as unknown as { savepoint?: (cb: (tx: unknown) => Promise<T>) => Promise<T> }).savepoint;
  if (typeof savepoint === "function") return savepoint((tx) => fn(tx as Db));
  return sql.begin((tx) => fn(tx as unknown as Db)) as Promise<T>;
}

/** Le compte d'installation : le propriétaire d'origine, et le compte par défaut hors de toute portée. */
export const OWNER_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Exécute `fn` pour un compte : dans une transaction où Postgres ne laisse voir et modifier que les lignes de ce compte
 * (row-level security, migration 0033). Le rôle `dexlane_tenant` n'est pas propriétaire des tables : il ne peut pas
 * contourner le cloisonnement.
 */
export function withAccount<T>(sql: Db, accountId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.account_id', ${accountId}, true)`;
    await tx.unsafe("set local role dexlane_tenant");
    return fn(tx as unknown as Db);
  }) as Promise<T>;
}

// `migrate` vit dans "@dexlane/db/migrate" : il lit des fichiers .sql sur disque et ne doit pas
// être embarqué dans un bundle applicatif (Next).
export * from "./events";
