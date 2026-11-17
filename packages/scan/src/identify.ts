import type { Db } from "@dexlane/db";
import { findCandidates, type MatchResult } from "@dexlane/catalog";
import type { CardImage, CardRecognizer, Recognition } from "./recognizer";

export interface IdentifyOptions {
  /** Langue retenue si le modèle ne la détermine pas (spec : FR prioritaire). */
  defaultLanguage?: string;
  threshold?: number;
}

export interface Identification {
  recognition: Recognition;
  language: string;
  match: MatchResult;
  /** Variante à présélectionner dans l'UI ; l'opérateur confirme toujours. null si aucune ne correspond clairement. */
  suggestedVariantId: string | null;
  /** Motifs de revue humaine, en plus de ceux du rapprochement catalogue. */
  reviewReasons: string[];
  requiresReview: boolean;
}

/** Photo → lecture Claude → candidats catalogue (spec Parcours A, étapes 1–3). */
export async function identifyCard(
  sql: Db,
  recognizer: CardRecognizer,
  image: CardImage,
  opts: IdentifyOptions = {},
): Promise<Identification> {
  const recognition = await recognizer.recognize(image);
  const r = recognition.reading;
  const reviewReasons: string[] = [];

  if (!r.card_detected) reviewReasons.push("no card detected");
  if (r.name_legibility !== "clear") reviewReasons.push(`name ${r.name_legibility}`);
  if (r.number_legibility !== "clear") reviewReasons.push(`number ${r.number_legibility}`);

  let language = opts.defaultLanguage ?? "fr";
  if (r.language && r.language !== "other") language = r.language;
  else reviewReasons.push("language not determined");

  const match = await findCandidates(
    sql,
    {
      language,
      name: r.name_legibility === "unreadable" ? undefined : (r.name ?? undefined),
      collectorNumber: r.number_legibility === "unreadable" ? undefined : (r.collector_number ?? undefined),
      setCode: r.set_code ?? undefined,
    },
    { threshold: opts.threshold },
  );

  // Une remarque du modèle (pochette, reflet) impose une vérification, sauf quand tout concorde par ailleurs :
  // nom et numéro lus nettement, et une seule carte du catalogue qui correspond à 100 %.
  const exact =
    match.candidates[0]?.score === 1 && !match.ambiguous &&
    match.candidates[0].signals.name === 1 && match.candidates[0].signals.number === 1;
  if (r.notes && !exact) reviewReasons.push(`model note: ${r.notes}`);

  return {
    recognition,
    language,
    match,
    suggestedVariantId: suggestVariant(match, r.finish_hint, r.first_edition_stamp),
    reviewReasons,
    requiresReview: match.requiresReview || reviewReasons.length > 0,
  };
}

function suggestVariant(match: MatchResult, finish: string, firstEdition: boolean): string | null {
  const top = match.candidates[0];
  if (!top) return null;
  const complete = top.variants.filter((v) => !v.incomplete);
  if (complete.length === 1) return complete[0]!.id;
  if (finish === "unknown") return null;
  const fits = complete.filter((v) => v.finish === finish && (v.edition === "1st") === firstEdition);
  return fits.length === 1 ? fits[0]!.id : null;
}
