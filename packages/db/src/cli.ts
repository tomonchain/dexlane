import { createDb } from "./index";
import { migrate } from "./migrate";

// Les migrations prennent un verrou consultatif de session : il leur faut une connexion directe,
// pas un pooler en mode transaction. DATABASE_URL_UNPOOLED est fourni par Neon (intégration Vercel).
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

const [command, ...flags] = process.argv.slice(2);
if (command !== "migrate") {
  console.error("usage: cli.ts migrate [--skip-if-unconfigured] [--not-on-preview]");
  process.exit(1);
}
if (flags.includes("--not-on-preview") && process.env.VERCEL_ENV === "preview" && process.env.MIGRATE_ON_PREVIEW !== "1") {
  // Une prévisualisation partage par défaut la base de production : du code non relu ne doit pas en changer le schéma.
  // Avec une base par prévisualisation (branche Neon), poser MIGRATE_ON_PREVIEW=1 pour la migrer.
  console.warn("preview deployment: migrations skipped (set MIGRATE_ON_PREVIEW=1 when previews have their own database)");
  process.exit(0);
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
