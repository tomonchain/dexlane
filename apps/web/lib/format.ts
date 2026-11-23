import { intlLocale, t } from "./i18n";
import type { CandidateVariant, Movement, Position } from "./types";

/** Montant en euros, dans le format de la langue de l'interface (« 12,50 € » ou « €12.50 »). */
export const formatEuros = (cents: number) => new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "EUR" }).format(cents / 100);
/** Nombre entier ou décimal, dans le format de la langue de l'interface. */
export const formatNumber = (n: number, options?: Intl.NumberFormatOptions) => n.toLocaleString(intlLocale(), options);

/** « 12,34 » | « 12.3 » | « 12 » → 1234 ; null si la saisie n'est pas un montant positif valide. */
export function parseEuros(input: string): number | null {
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

const FINISH: Record<string, string> = { normal: "Normale", holo: "Holo", reverse: "Reverse", unknown: "Finition inconnue" };

export function variantLabel(v: Pick<CandidateVariant, "finish" | "edition" | "stamp" | "subtype">): string {
  return [
    FINISH[v.finish] ? t(FINISH[v.finish]!) : v.finish,
    v.edition === "1st" ? t("1re édition") : v.edition,
    v.subtype,
    v.stamp && t("tampon {stamp}", { stamp: v.stamp }),
  ].filter(Boolean).join(" · ");
}

/** Visuel TCGdex : l'URL du catalogue est une base à compléter par qualité et format. */
export const cardImage = (imageUrl: string | null, quality: "low" | "high" = "low") =>
  imageUrl ? `${imageUrl}/${quality}.webp` : null;

const REASONS: [RegExp, string][] = [
  [/^no card detected$/, "aucune carte détectée sur la photo"],
  [/^name partial$/, "nom partiellement lisible"],
  [/^name unreadable$/, "nom illisible"],
  [/^number partial$/, "numéro partiellement lisible"],
  [/^number unreadable$/, "numéro illisible"],
  [/^language not determined$/, "langue non déterminée"],
];
export function reviewReason(reason: string): string {
  for (const [pattern, label] of REASONS) if (pattern.test(reason)) return t(label);
  return reason.replace(/^model note: /, t("remarque du modèle : "));
}

const MOVEMENTS: Record<string, string> = {
  RECEIVE: "Entrée", MOVE: "Déplacement", ALLOCATE: "Réservation", RELEASE: "Libération", PICK: "Prélèvement",
  SHIP_OUT: "Expédition", RETURN_IN: "Retour client", INSPECT_OK: "Contrôle OK", INSPECT_KO: "Contrôle KO",
  QUARANTINE: "Quarantaine", UNQUARANTINE: "Fin de quarantaine", BULK_EXTRACT: "Extraction du vrac",
  ADJUST: "Correction", LOST: "Perte", DISPOSED: "Mise au rebut",
};
export const movementLabel = (m: Pick<Movement, "movementType">) => (MOVEMENTS[m.movementType] ? t(MOVEMENTS[m.movementType]!) : m.movementType);

export const LIFECYCLE: Record<string, string> = { DRAFT: "Brouillon", ACTIVE: "Active", ARCHIVED: "Archivée" };

export function positionTitle(p: Pick<Position, "card" | "bulk">): string {
  return p.card?.name ?? p.bulk?.label ?? t("Position");
}

export function positionSubtitle(p: Pick<Position, "card" | "bulk" | "offer">): string {
  if (p.card) {
    return [`${p.card.setId} ${p.card.localNumber}`, p.card.language.toUpperCase(), variantLabel({ ...p.card, stamp: "", subtype: "" }), p.offer?.condition]
      .filter(Boolean).join(" · ");
  }
  return t("Lot de vrac");
}

export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat(intlLocale(), { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(iso));

/** « 2026-11-18 » → « mer. 18 nov » (« Wed 18 Nov » en anglais) */
export const dayLabel = (day: string) =>
  new Intl.DateTimeFormat(intlLocale(), { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00`)).replace(/\.$/, "");

/** Formateur de dates à la demande, dans la langue de l'interface (à créer au rendu, jamais au chargement du module). */
export const dateFormat = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlLocale(), options);
