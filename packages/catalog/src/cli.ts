import { parseArgs } from "node:util";
import { createDb } from "@dexlane/db";
import { createTcgdexClient, syncSet, syncSetList } from "./index";

const { values } = parseArgs({
  options: {
    lang: { type: "string", default: "fr" },
    set: { type: "string", multiple: true },
    "list-only": { type: "boolean", default: false },
    "no-prices": { type: "boolean", default: false },
  },
});

const usage = "usage: sync --lang fr (--set swsh3 [--set sv01 …] | --list-only) [--no-prices]";
const sql = createDb();
const client = createTcgdexClient();
const lang = values.lang!;

try {
  if (values["list-only"]) {
    console.log(`${await syncSetList(sql, client, lang)} sets synced (${lang})`);
  } else if (values.set?.length) {
    for (const setId of values.set) {
      const s = await syncSet(sql, client, lang, setId, { prices: !values["no-prices"] });
      console.log(
        `${lang}/${setId}: ${s.cards} cards, ${s.variants} variants (${s.incompleteVariants} incomplete), ` +
          `${s.pricesInserted} new price snapshots, ${s.errors.length} errors`,
      );
      for (const e of s.errors) console.error(`  ${e.cardId}: ${e.message}`);
    }
  } else {
    console.error(usage);
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
