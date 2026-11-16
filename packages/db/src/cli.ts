import { createDb, migrate } from "./index";

const [command] = process.argv.slice(2);
const sql = createDb();
try {
  if (command === "migrate") {
    const applied = await migrate(sql);
    console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
  } else {
    console.error("usage: cli.ts migrate");
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
