import { AsyncLocalStorage } from "node:async_hooks";
import { withAccount, type Db } from "@dexlane/db";

/**
 * Portée d'une requête : le compte pour lequel elle travaille et la transaction cloisonnée ouverte pour lui.
 * Les routes et le cœur métier reçoivent un `sql` qui suit cette portée, sans avoir à la connaître.
 */
const storage = new AsyncLocalStorage<{ sql: Db; accountId: string }>();

/** Exécute `fn` pour un compte : toutes les requêtes SQL faites via `scopedDb` pendant `fn` sont cloisonnées. */
export function runForAccount<T>(root: Db, accountId: string, fn: () => Promise<T>): Promise<T> {
  return withAccount(root, accountId, (tx) => storage.run({ sql: tx, accountId }, fn));
}

/**
 * Un `sql` qui exécute chaque requête dans la transaction du compte en cours ; hors de toute portée (authentification,
 * catalogue commun), il s'adresse directement à la base.
 */
export function scopedDb(root: Db): Db {
  const current = () => storage.getStore()?.sql ?? root;
  return new Proxy(root, {
    apply: (_target, _self, args) => Reflect.apply(current() as unknown as (...a: unknown[]) => unknown, undefined, args),
    get: (_target, prop) => {
      const target = current() as unknown as Record<PropertyKey, unknown>;
      const value = target[prop];
      // Dans une transaction, « begin » n'existe pas : une sous-transaction est un point de sauvegarde.
      if (prop === "begin" && value === undefined) return target.savepoint;
      return typeof value === "function" ? value.bind(target) : value;
    },
    has: (_target, prop) => prop in (current() as unknown as object),
  }) as Db;
}
