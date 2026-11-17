import { createDb } from "./index";
import { migrate } from "./migrate";

// Les migrations prennent un verrou consultatif de session : il leur faut une connexion directe,
// pas un pooler en mode transaction. DATABASE_URL_UNPOOLED est fourni par Neon (intégration Vercel).
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

const [command, ...flags] = process.argv.slice(2);
if (command !== "migrate") {
  console.error("usage: cli.ts migrate [--skip-if-unconfigured]");
  process.exit(1);
}
if (!url && flags.includes("--skip-if-unconfigured")) {
  // Premier déploiement, avant que la base ne soit branchée : le build passe, l'application signalera l'absence de base.
  console.warn("no database URL configured: migrations skipped");
  process.exit(0);
}

const sql = createDb(url, { max: 1 });
try {
  const applied = await migrate(sql);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
} finally {
  await sql.end();
}
