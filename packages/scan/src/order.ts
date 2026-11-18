// ───────────────────────── Ordre des fichiers du scanner ─────────────────────────

/** Tri « naturel » : scan_2 avant scan_10, comme l'ordre de passage dans le scanner. */
export const byFileName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export interface PlannedCard {
  /** Rang dans la pile (1 = première carte scannée). */
  position: number;
  front: string;
  back: string | null;
}

/**
 * Répartit les fichiers d'un dossier de scanner en cartes, dans l'ordre des noms.
 * En recto verso, deux fichiers par carte : un recto sans son verso (scan en cours) n'est pas encore une carte.
 */
export function planCards(fileNames: string[], paired: boolean): PlannedCard[] {
  const sorted = [...new Set(fileNames)].sort(byFileName);
  const cards: PlannedCard[] = [];
  for (let i = 0; i + (paired ? 1 : 0) < sorted.length; i += paired ? 2 : 1) {
    cards.push({ position: cards.length + 1, front: sorted[i]!, back: paired ? sorted[i + 1]! : null });
  }
  return cards;
}
