/** Montants en centimes entiers — jamais de flottants pour l'argent. */
export type Cents = number;

/** "12.34" | "12,34" | "12" → 1234. Rejette les valeurs ambiguës. */
export function parseEuros(input: string): Cents {
  const s = input.trim().replace(",", ".");
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`invalid amount: ${input}`);
  const [, sign, units, frac = ""] = m;
  const cents = Number(units) * 100 + Number(frac.padEnd(2, "0"));
  return sign ? -cents : cents;
}

export function assertCents(value: number, name = "amount"): Cents {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer number of cents`);
  return value;
}

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
export const formatEuros = (cents: Cents): string => eur.format(cents / 100);
