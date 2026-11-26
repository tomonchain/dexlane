import { createDb, withAccount } from "@dexlane/db";
import { defaultTimezone } from "./config/progression";
import { rebuildJournal } from "./journal";
import { evaluateProgress } from "./progression";

/**
 * Attribution rétroactive au lancement (#86) : pour chaque compte, reconstruit le journal d'après l'historique, puis
 * calcule niveau et succès, sans notification individuelle (les comptes qui existaient avant la migration 0039 sont
 * marqués « rétroactif en attente »). Idempotent : relancé, il n'attribue rien de plus.
 *
 * La tâche quotidienne fait la même chose de son côté ; ce script permet de le faire tout de suite, au déploiement.
 * Les bonus de cartes des avantages de niveau ne sont pas appliqués ici (ils passent par l'API de la version hébergée).
 *
 * Usage : pnpm --filter @dexlane/insights retro [--dry-run]
 */
const [command, ...flags] = process.argv.slice(2);
if (command !== "retro") {
  console.error("usage: cli.ts retro [--dry-run]");
  process.exit(1);
}
const dryRun = flags.includes("--dry-run");
const sql = createDb(process.env.DATABASE_URL, { max: 1 });
class DryRun extends Error {}
try {
  const accounts = await sql<{ id: string }[]>`select id from accounts order by created_at, id`;
  for (const { id } of accounts) {
    try {
      await withAccount(sql, id, async (tx) => {
        const rebuilt = await rebuildJournal(tx);
        const r = await evaluateProgress(tx, { timezone: defaultTimezone });
        console.log(`${id}: ${rebuilt} events rebuilt, level ${r.level}, ${r.confirmed} confirmed sales, ${r.unlocked.length} achievements (${r.retroactive ? "retroactive" : "live"})`);
        if (dryRun) throw new DryRun();
      });
    } catch (e) {
      if (!(e instanceof DryRun)) throw e;
    }
  }
  if (dryRun) console.log("dry run: nothing was written");
} finally {
  await sql.end();
}
