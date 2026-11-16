/**
 * Normalise un numéro de carte pour comparaison : minuscules, sans espaces, zéros de tête retirés
 * devant chaque groupe de chiffres. « 001 » → « 1 », « TG05 » → « tg5 », « SWSH050 » → « swsh50 ».
 * Doit rester identique à la colonne générée `catalog_cards.number_normalized` (migration 0002).
 */
export function normalizeNumber(raw: string): string {
  return raw.replace(/\s/g, "").toLowerCase().replace(/(^|[a-z-])0+([0-9])/g, "$1$2");
}

export interface CollectorNumber {
  number: string;
  /** Dénominateur imprimé s'il est numérique (« 136/189 » → 189). */
  printedTotal?: number;
}

/**
 * Lit un numéro de collection tel qu'imprimé/OCRisé : « 136/189 », « 136 / 189 », « TG05/TG30 », « SWSH050 ».
 * Retourne null si rien d'exploitable.
 */
export function parseCollectorNumber(text: string): CollectorNumber | null {
  const cleaned = text.trim().replace(/[\\|]/g, "/");
  const slash = /([A-Za-z-]*\d+[A-Za-z]?)\s*\/\s*([A-Za-z-]*)(\d+)/.exec(cleaned);
  if (slash) {
    const [, number, totalPrefix, totalDigits] = slash;
    return totalPrefix ? { number: number! } : { number: number!, printedTotal: Number(totalDigits) };
  }
  const single = /^([A-Za-z-]*\d+[A-Za-z]?)$/.exec(cleaned);
  return single ? { number: single[1]! } : null;
}
