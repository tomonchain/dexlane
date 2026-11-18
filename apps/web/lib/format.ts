import type { CandidateVariant, Movement, Position } from "./types";

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
export const formatEuros = (cents: number) => eur.format(cents / 100);

/** « 12,34 » | « 12.3 » | « 12 » → 1234 ; null si la saisie n'est pas un montant positif valide. */
export function parseEuros(input: string): number | null {
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

const FINISH: Record<string, string> = { normal: "Normale", holo: "Holo", reverse: "Reverse", unknown: "Finition inconnue" };

export function variantLabel(v: Pick<CandidateVariant, "finish" | "edition" | "stamp" | "subtype">): string {
  return [
    FINISH[v.finish] ?? v.finish,
    v.edition === "1st" ? "1re édition" : v.edition,
    v.subtype,
    v.stamp && `tampon ${v.stamp}`,
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
  for (const [pattern, label] of REASONS) if (pattern.test(reason)) return label;
  return reason.replace(/^model note: /, "remarque du modèle : ");
}

const MOVEMENTS: Record<string, string> = {
  RECEIVE: "Entrée", MOVE: "Déplacement", ALLOCATE: "Réservation", RELEASE: "Libération", PICK: "Prélèvement",
  SHIP_OUT: "Expédition", RETURN_IN: "Retour", INSPECT_OK: "Contrôle OK", INSPECT_KO: "Contrôle KO",
  QUARANTINE: "Quarantaine", UNQUARANTINE: "Fin de quarantaine", BULK_EXTRACT: "Extraction du vrac",
  ADJUST: "Correction", LOST: "Perte", DISPOSED: "Mise au rebut",
};
export const movementLabel = (m: Pick<Movement, "movementType">) => MOVEMENTS[m.movementType] ?? m.movementType;

export const LIFECYCLE: Record<string, string> = { DRAFT: "Brouillon", ACTIVE: "Active", ARCHIVED: "Archivée" };

export function positionTitle(p: Pick<Position, "card" | "bulk">): string {
  return p.card?.name ?? p.bulk?.label ?? "Position";
}

export function positionSubtitle(p: Pick<Position, "card" | "bulk" | "offer">): string {
  if (p.card) {
    return [`${p.card.setId} ${p.card.localNumber}`, p.card.language.toUpperCase(), variantLabel({ ...p.card, stamp: "", subtype: "" }), p.offer?.condition]
      .filter(Boolean).join(" · ");
  }
  return "Lot de vrac";
}

const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

const shortDay = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
/** « 2026-11-18 » → « mer. 18 nov » */
export const dayLabel = (day: string) => shortDay.format(new Date(`${day}T12:00:00`)).replace(/\.$/, "");
