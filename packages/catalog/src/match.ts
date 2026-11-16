import type { Db } from "@dexlane/db";
import { normalizeNumber, parseCollectorNumber } from "./number";

/** Ce que l'étape vision/OCR a pu lire sur la carte. Tous les champs sont facultatifs. */
export interface CardReading {
  language: string;
  name?: string;
  /** Texte brut du numéro : « 136/189 », « TG05/TG30 », « SWSH050 ». */
  collectorNumber?: string;
  /** Série si déjà connue (sélection opérateur, symbole reconnu…). */
  setId?: string;
  /** Code d'extension imprimé (« DAA », « TEM », « PAR »), officiel ou localisé. */
  setCode?: string;
}

export interface CandidateVariant {
  id: string;
  finish: string;
  edition: string;
  stamp: string;
  subtype: string;
  incomplete: boolean;
}

export interface Candidate {
  catalogCardId: string;
  setId: string;
  setName: string | null;
  localNumber: string;
  name: string;
  rarity: string | null;
  imageUrl: string | null;
  score: number;
  signals: { name?: number; number?: number; printedTotal?: number; set?: number };
  variants: CandidateVariant[];
}

export interface MatchResult {
  candidates: Candidate[];
  /** Les deux premiers candidats sont trop proches pour trancher. */
  ambiguous: boolean;
  /**
   * Validation humaine obligatoire (spec 4.1) : score sous le seuil, ambiguïté, nom illisible ou aucun candidat.
   * Le choix de la variante (normal/reverse/holo, édition) reste toujours confirmé par l'opérateur.
   */
  requiresReview: boolean;
}

const WEIGHTS = { name: 0.45, number: 0.3, printedTotal: 0.15, set: 0.1 } as const;
const AMBIGUITY_MARGIN = 0.05;

/**
 * Propose les meilleures cartes du catalogue pour une lecture OCR.
 * Score = moyenne pondérée des signaux disponibles (nom par similarité trigramme sans accents,
 * numéro exact, dénominateur imprimé = taille officielle de la série, série).
 */
export async function findCandidates(
  sql: Db,
  reading: CardReading,
  opts: { limit?: number; threshold?: number } = {},
): Promise<MatchResult> {
  const limit = opts.limit ?? 3;
  const threshold = opts.threshold ?? 0.95;
  const name = reading.name?.trim() || null;
  const parsed = reading.collectorNumber ? parseCollectorNumber(reading.collectorNumber) : null;
  const number = parsed ? normalizeNumber(parsed.number) : null;
  const printedTotal = parsed?.printedTotal ?? null;
  const setIds = reading.setId
    ? [reading.setId]
    : reading.setCode
      ? await resolveSetCode(sql, reading.language, reading.setCode)
      : [];
  const setId = setIds[0] ?? null;

  if (!name && !number && !setId) return { candidates: [], ambiguous: false, requiresReview: true };

  const rows = await sql<{
    id: string; setId: string; setName: string | null; localNumber: string; numberNormalized: string;
    name: string; rarity: string | null; imageUrl: string | null;
    cardCountOfficial: number | null; cardCountTotal: number | null; nameSim: number;
  }[]>`
    select c.id, c.set_id, s.name as set_name, c.local_number, c.number_normalized, c.name, c.rarity, c.image_url,
           s.card_count_official, s.card_count_total,
           case when ${name}::text is null then 0
                else similarity(f_unaccent(lower(c.name)), f_unaccent(lower(${name}::text))) end as name_sim
      from catalog_cards c
      left join catalog_sets s on s.id = c.set_id and s.language = c.language
     where c.language = ${reading.language}
       and (
            (${number}::text is not null and c.number_normalized = ${number}::text)
         or (${name}::text is not null and f_unaccent(lower(c.name)) % f_unaccent(lower(${name}::text)))
         or (${number}::text is null and ${name}::text is null and c.set_id = ${setId}::text)
       )
     limit 500`;

  const scored = rows.map((r) => {
    const signals: Candidate["signals"] = {};
    if (name) signals.name = Number(r.nameSim);
    if (number) signals.number = r.numberNormalized === number ? 1 : 0;
    if (printedTotal != null) {
      signals.printedTotal = printedTotal === r.cardCountOfficial || printedTotal === r.cardCountTotal ? 1 : 0;
    }
    if (setIds.length) signals.set = setIds.includes(r.setId) ? 1 : 0;
    let weighted = 0;
    let weights = 0;
    for (const [k, v] of Object.entries(signals) as [keyof typeof WEIGHTS, number][]) {
      weighted += WEIGHTS[k] * v;
      weights += WEIGHTS[k];
    }
    return { row: r, signals, score: Math.round((weighted / weights) * 1000) / 1000 };
  });

  scored.sort((a, b) => b.score - a.score || a.row.setId.localeCompare(b.row.setId));
  const top = scored.slice(0, limit);

  const ids = top.map((t) => t.row.id);
  const variants = ids.length
    ? await sql<(CandidateVariant & { catalogCardId: string })[]>`
        select id, catalog_card_id, finish, edition, stamp, subtype, incomplete
          from card_variants where catalog_card_id in ${sql(ids)}
         order by finish, edition, subtype`
    : [];

  const candidates: Candidate[] = top.map(({ row, signals, score }) => ({
    catalogCardId: row.id,
    setId: row.setId,
    setName: row.setName,
    localNumber: row.localNumber,
    name: row.name,
    rarity: row.rarity,
    imageUrl: row.imageUrl,
    score,
    signals,
    variants: variants
      .filter((v) => v.catalogCardId === row.id)
      .map(({ catalogCardId: _, ...v }) => v),
  }));

  const [first, second] = candidates;
  const ambiguous = !!first && !!second && first.score - second.score < AMBIGUITY_MARGIN;
  // Sans nom lu, un seul chiffre mal reconnu suffit à désigner une autre carte : jamais d'acceptation automatique.
  const nameRead = name !== null;
  return { candidates, ambiguous, requiresReview: !first || !nameRead || first.score < threshold || ambiguous };
}

/** Code imprimé → séries possibles (un même code peut exister dans plusieurs langues ou être réutilisé). */
async function resolveSetCode(sql: Db, language: string, code: string): Promise<string[]> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return [];
  const rows = await sql<{ id: string }[]>`
    select id from catalog_sets
     where language = ${language}
       and (upper(abbreviation) = ${normalized} or upper(abbreviation_localized) = ${normalized})
     order by id`;
  return rows.map((r) => r.id);
}
