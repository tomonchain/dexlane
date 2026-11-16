import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { join } from "node:path";
import type { Db } from "@dexlane/db";
import { identifyCard, type IdentifyOptions } from "./identify";
import { RecognitionError, mediaTypeFromPath, type CardImage, type CardRecognizer } from "./recognizer";

/** Une photo annotée : la vérité terrain attendue. */
export interface LabeledSample {
  id: string;
  load: () => Promise<CardImage>;
  expected: { setId: string; localNumber: string; language: string };
}

export interface SampleResult {
  id: string;
  expected: LabeledSample["expected"];
  predicted: { setId: string; localNumber: string; score: number } | null;
  top1: boolean;
  inTop3: boolean;
  requiresReview: boolean;
  /** Accepté automatiquement ET faux : l'erreur que le système ne doit jamais commettre. */
  silentError: boolean;
  reviewReasons: string[];
  servedBy: string | null;
  latencyMs: number | null;
  costUsd: number | null;
  error: string | null;
}

export interface BenchSummary {
  samples: number;
  errors: number;
  top1Accuracy: number;
  top3Accuracy: number;
  autoAcceptRate: number;
  /** Précision automatique (spec §1) : parmi les acceptations sans revue, part de bonnes identifications. */
  autoAcceptPrecision: number | null;
  silentErrors: number;
  medianLatencyMs: number | null;
  p90LatencyMs: number | null;
  meanCostUsd: number | null;
  totalCostUsd: number | null;
  fallbacks: number;
}

export async function runBench(
  sql: Db,
  recognizer: CardRecognizer,
  samples: LabeledSample[],
  opts: IdentifyOptions & { concurrency?: number; model?: string; onResult?: (r: SampleResult) => void } = {},
): Promise<SampleResult[]> {
  const results: SampleResult[] = new Array(samples.length);
  let next = 0;
  const worker = async () => {
    while (next < samples.length) {
      const i = next++;
      results[i] = await runOne(sql, recognizer, samples[i]!, opts);
      opts.onResult?.(results[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, worker));
  return results;
}

async function runOne(
  sql: Db,
  recognizer: CardRecognizer,
  sample: LabeledSample,
  opts: IdentifyOptions & { model?: string },
): Promise<SampleResult> {
  const base = { id: sample.id, expected: sample.expected };
  try {
    const result = await identifyCard(sql, recognizer, await sample.load(), {
      ...opts,
      defaultLanguage: opts.defaultLanguage ?? sample.expected.language,
    });
    const isExpected = (c: { setId: string; localNumber: string }) =>
      c.setId === sample.expected.setId && c.localNumber === sample.expected.localNumber;
    const top = result.match.candidates[0] ?? null;
    const top1 = !!top && isExpected(top);
    return {
      ...base,
      predicted: top ? { setId: top.setId, localNumber: top.localNumber, score: top.score } : null,
      top1,
      inTop3: result.match.candidates.slice(0, 3).some(isExpected),
      requiresReview: result.requiresReview,
      silentError: !result.requiresReview && !top1,
      reviewReasons: [...result.reviewReasons, ...(result.match.ambiguous ? ["ambiguous candidates"] : [])],
      servedBy: result.recognition.servedBy,
      latencyMs: result.recognition.latencyMs,
      costUsd: result.recognition.usage.costUsd,
      error: null,
    };
  } catch (e) {
    // Erreurs de configuration (clé invalide, droits, modèle inconnu) : inutile de continuer le banc.
    if (
      e instanceof Anthropic.AuthenticationError ||
      e instanceof Anthropic.PermissionDeniedError ||
      e instanceof Anthropic.NotFoundError
    ) {
      throw e;
    }
    const message = e instanceof RecognitionError ? `${e.code}: ${e.message}` : (e as Error).message;
    return {
      ...base, predicted: null, top1: false, inTop3: false, requiresReview: true, silentError: false,
      reviewReasons: [], servedBy: null, latencyMs: null, costUsd: null, error: message,
    };
  }
}

export function summarize(results: SampleResult[], model?: string): BenchSummary {
  const n = results.length;
  const ratio = (k: number, d: number) => (d === 0 ? 0 : Math.round((k / d) * 1000) / 1000);
  const accepted = results.filter((r) => !r.requiresReview);
  const latencies = results.flatMap((r) => (r.latencyMs == null ? [] : [r.latencyMs])).sort((a, b) => a - b);
  const costs = results.flatMap((r) => (r.costUsd == null ? [] : [r.costUsd]));
  const pct = (p: number) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))]! : null);
  const total = costs.reduce((a, b) => a + b, 0);
  return {
    samples: n,
    errors: results.filter((r) => r.error).length,
    top1Accuracy: ratio(results.filter((r) => r.top1).length, n),
    top3Accuracy: ratio(results.filter((r) => r.inTop3).length, n),
    autoAcceptRate: ratio(accepted.length, n),
    autoAcceptPrecision: accepted.length ? ratio(accepted.filter((r) => r.top1).length, accepted.length) : null,
    silentErrors: results.filter((r) => r.silentError).length,
    medianLatencyMs: pct(0.5),
    p90LatencyMs: pct(0.9),
    meanCostUsd: costs.length ? Math.round((total / costs.length) * 100_000) / 100_000 : null,
    totalCostUsd: costs.length ? Math.round(total * 10_000) / 10_000 : null,
    fallbacks: model ? results.filter((r) => r.servedBy && r.servedBy !== model).length : 0,
  };
}

/**
 * Lit `labels.csv` (en-tête obligatoire) : `file,set_id,local_number,language`.
 * Les chemins de fichiers sont relatifs au dossier du CSV.
 */
export async function loadLabeledDir(dir: string): Promise<LabeledSample[]> {
  const csv = await readFile(join(dir, "labels.csv"), "utf8");
  const [header, ...lines] = csv.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  const cols = header!.split(",").map((c) => c.trim());
  const idx = (name: string) => {
    const i = cols.indexOf(name);
    if (i < 0) throw new Error(`labels.csv: missing column "${name}"`);
    return i;
  };
  const [iFile, iSet, iNum, iLang] = [idx("file"), idx("set_id"), idx("local_number"), idx("language")];
  return lines.map((line, n) => {
    const cells = line.split(",").map((c) => c.trim());
    const file = cells[iFile]!;
    const mediaType = mediaTypeFromPath(file);
    if (!mediaType) throw new Error(`labels.csv line ${n + 2}: unsupported image type for ${file} (use jpg, png, webp)`);
    return {
      id: file,
      load: async () => ({ data: await readFile(join(dir, file)), mediaType }),
      expected: { setId: cells[iSet]!, localNumber: cells[iNum]!, language: cells[iLang]! },
    };
  });
}

/**
 * Échantillon tiré du catalogue synchronisé, avec les visuels officiels TCGdex.
 * Ce sont des rendus numériques nets : résultats optimistes par rapport à de vraies photos.
 */
export async function sampleFromCatalog(
  sql: Db,
  opts: { language: string; size: number; setIds?: string[]; fetchImpl?: typeof fetch },
): Promise<LabeledSample[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const rows = await sql<{ setId: string; localNumber: string; imageUrl: string }[]>`
    select set_id, local_number, image_url from catalog_cards
     where language = ${opts.language} and image_url is not null
       ${opts.setIds?.length ? sql`and set_id in ${sql(opts.setIds)}` : sql``}
     order by md5(id::text)
     limit ${opts.size}`;
  return rows.map((r) => ({
    id: `${r.setId}-${r.localNumber}`,
    expected: { setId: r.setId, localNumber: r.localNumber, language: opts.language },
    load: async () => {
      const res = await doFetch(`${r.imageUrl}/high.webp`);
      if (!res.ok) throw new Error(`image download failed: HTTP ${res.status}`);
      return { data: Buffer.from(await res.arrayBuffer()), mediaType: "image/webp" as const };
    },
  }));
}

export function resultsToCsv(results: SampleResult[]): string {
  const head = "id,expected,predicted,score,top1,in_top3,requires_review,silent_error,served_by,latency_ms,cost_usd,review_reasons,error";
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = results.map((r) =>
    [
      r.id,
      `${r.expected.setId}-${r.expected.localNumber}`,
      r.predicted ? `${r.predicted.setId}-${r.predicted.localNumber}` : "",
      r.predicted?.score,
      r.top1, r.inTop3, r.requiresReview, r.silentError, r.servedBy, r.latencyMs, r.costUsd,
      r.reviewReasons.join("; "), r.error,
    ].map(esc).join(","),
  );
  return [head, ...rows].join("\n") + "\n";
}
