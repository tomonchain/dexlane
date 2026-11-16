import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createDb } from "@dexlane/db";
import { DEFAULT_MODEL, checkClaudeAccess, createClaudeRecognizer } from "./claude";
import { loadLabeledDir, resultsToCsv, runBench, sampleFromCatalog, summarize } from "./bench";

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    "catalog-sample": { type: "string" },
    set: { type: "string", multiple: true },
    lang: { type: "string", default: "fr" },
    model: { type: "string", default: DEFAULT_MODEL },
    effort: { type: "string", default: "medium" },
    concurrency: { type: "string", default: "3" },
    out: { type: "string" },
  },
});

const usage = `usage:
  bench --dir <photos-dir>                       # photos + labels.csv (file,set_id,local_number,language)
  bench --catalog-sample 20 [--set swsh3]        # visuels officiels TCGdex (optimiste)
options: --model ${DEFAULT_MODEL} --effort low|medium|high --concurrency 3 --out results.csv --lang fr`;

if (!values.dir && !values["catalog-sample"]) {
  console.error(usage);
  process.exit(1);
}

try {
  await checkClaudeAccess(values.model);
} catch (e) {
  console.error(`Cannot use ${values.model}: ${(e as Error).message}`);
  console.error("Set ANTHROPIC_API_KEY (or run `ant auth login`) and check the model id.");
  process.exit(1);
}

const sql = createDb();
try {
  const samples = values.dir
    ? await loadLabeledDir(values.dir)
    : await sampleFromCatalog(sql, { language: values.lang!, size: Number(values["catalog-sample"]), setIds: values.set });
  if (samples.length === 0) throw new Error("no samples (is the catalog synced for this language/set?)");

  const model = values.model!;
  const recognizer = createClaudeRecognizer({ model, effort: values.effort as "low" | "medium" | "high" });
  console.log(`${samples.length} samples, model ${model}, effort ${values.effort}`);

  const results = await runBench(sql, recognizer, samples, {
    concurrency: Number(values.concurrency),
    defaultLanguage: values.lang,
    onResult: (r) => {
      const mark = r.error ? "ERR " : r.silentError ? "SILENT-WRONG" : r.top1 ? (r.requiresReview ? "ok/review" : "ok") : "wrong/review";
      console.log(`  ${mark.padEnd(12)} ${r.id} → ${r.predicted ? `${r.predicted.setId}-${r.predicted.localNumber} (${r.predicted.score})` : "-"}${r.error ? `  ${r.error}` : ""}`);
    },
  });

  console.log("\n" + JSON.stringify(summarize(results, model), null, 2));
  if (values.out) {
    await writeFile(values.out, resultsToCsv(results));
    console.log(`per-sample results → ${values.out}`);
  }
} finally {
  await sql.end();
}
