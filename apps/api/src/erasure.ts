/**
 * Droits d'un vendeur sur ses données (RGPD) : les récupérer (portabilité) et les effacer (effacement).
 *
 * Les données d'un compte sont les lignes de toutes les tables qui portent `account_id`, plus ses utilisateurs (tables
 * de BetterAuth) et la ligne du compte. La liste des tables est lue dans le schéma : une table ajoutée plus tard est
 * prise en compte sans toucher à ce fichier.
 */
import { withTx, type Db } from "@dexlane/db";

/** Tables de données : celles qui portent `account_id`. */
async function accountTables(sql: Db): Promise<string[]> {
  const rows = await sql<{ tableName: string }[]>`
    select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'account_id' and t.table_type = 'BASE TABLE'
     order by c.table_name`;
  return rows.map((r) => r.tableName);
}

/**
 * Ordre d'effacement : une table qui en référence une autre passe avant elle (les enfants d'abord), pour que les clés
 * étrangères ne bloquent pas. Les références d'une table à elle-même (emplacements parents) se règlent dans la table.
 */
async function deletionOrder(sql: Db, tables: string[]): Promise<string[]> {
  const edges = await sql<{ child: string; parent: string }[]>`
    select distinct cl.relname as child, pr.relname as parent
      from pg_constraint co
      join pg_class cl on cl.oid = co.conrelid
      join pg_class pr on pr.oid = co.confrelid
      join pg_namespace n on n.oid = cl.relnamespace
     where co.contype = 'f' and n.nspname = 'public' and cl.relname <> pr.relname`;
  const set = new Set(tables);
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  // Parcours en profondeur : une table n'est placée qu'après toutes celles qui la référencent.
  const visit = (table: string) => {
    if (done.has(table) || visiting.has(table)) return;
    visiting.add(table);
    for (const e of edges) if (e.parent === table && set.has(e.child)) visit(e.child);
    visiting.delete(table);
    done.add(table);
    ordered.push(table);
  };
  for (const t of tables) visit(t);
  return ordered;
}

/** Colonnes (pouvant être vides) par lesquelles une table référence ses propres lignes. */
async function selfReferences(sql: Db): Promise<Map<string, string[]>> {
  const rows = await sql<{ tableName: string; columnName: string }[]>`
    select cl.relname as table_name, a.attname as column_name
      from pg_constraint co
      join pg_class cl on cl.oid = co.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = co.conrelid and a.attnum = any (co.conkey)
     where co.contype = 'f' and co.conrelid = co.confrelid and n.nspname = 'public' and not a.attnotnull`;
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.tableName, [...(map.get(r.tableName) ?? []), r.columnName]);
  return map;
}

/** Colonnes jamais exportées : jetons, empreintes, clés de chiffrement des notifications. */
const SECRET_COLUMN = /(token|secret|hash|password|p256dh|^auth$|private|refresh|access)/i;
/** Tables techniques sans intérêt pour la personne (rejeu des requêtes, file d'événements internes). */
const TECHNICAL_TABLES = new Set(["idempotency_keys", "outbox_events", "channel_oauth_states"]);

/**
 * Toutes les données du compte en JSON, table par table, sans les secrets. `sql` est la base du compte (cloisonnée) :
 * elle ne voit que ses lignes.
 */
export async function exportAccount(root: Db, sql: Db, accountId: string): Promise<Record<string, unknown>> {
  const tables = (await accountTables(root)).filter((t) => !TECHNICAL_TABLES.has(t));
  const data: Record<string, unknown[]> = {};
  for (const table of tables) {
    const rows = await sql<Record<string, unknown>[]>`select * from ${sql(table)} where account_id = ${accountId}`;
    if (rows.length === 0) continue;
    data[table] = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !SECRET_COLUMN.test(k))));
  }
  const [account] = await root`select id, plan, plan_changed_at, created_at from accounts where id = ${accountId}`;
  const users = await root`
    select id, name, email, "emailVerified" as email_verified, "createdAt" as created_at from auth_users
     where "accountId" = ${accountId} order by "createdAt"`;
  return { format: "dexlane-export/1", exportedAt: new Date().toISOString(), account, users, data };
}

/**
 * Efface le compte : toutes ses données, ses utilisateurs (et leurs sessions) et le compte lui-même, en une
 * transaction. Renvoie les adresses des photos à supprimer du stockage, à faire une fois la transaction validée.
 */
export async function eraseAccount(root: Db, accountId: string): Promise<{ photoUrls: string[]; rows: number }> {
  return withTx(root, async (tx) => {
    // Seule exception aux journaux en ajout seul : l'effacement d'un compte (migration 0037).
    await tx`select set_config('app.erasing_account', ${accountId}, true)`;
    const photoUrls = (await tx<{ url: string }[]>`select url from photos where account_id = ${accountId}`).map((p) => p.url);
    const selfRefs = await selfReferences(tx);
    let rows = 0;
    for (const table of await deletionOrder(tx, await accountTables(tx))) {
      // Une table qui se référence elle-même (emplacements et leurs parents, photo et sa source) : liens coupés d'abord.
      for (const column of selfRefs.get(table) ?? []) {
        await tx`update ${tx(table)} set ${tx(column)} = null where account_id = ${accountId} and ${tx(column)} is not null`;
      }
      const deleted = await tx`delete from ${tx(table)} where account_id = ${accountId}`;
      rows += deleted.count;
    }
    // Utilisateurs : leurs sessions et identifiants suivent (on delete cascade).
    await tx`delete from auth_users where "accountId" = ${accountId}`;
    await tx`delete from accounts where id = ${accountId}`;
    return { photoUrls, rows };
  });
}

/** Un membre d'une équipe quitte le compte en supprimant son utilisateur : le compte et ses données restent. */
export async function eraseUser(root: Db, userId: string): Promise<void> {
  await root`delete from auth_users where id = ${userId}`;
}
