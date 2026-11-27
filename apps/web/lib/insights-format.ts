import { levelNames } from "@dexlane/insights/config";
import { intlLocale, t, tn } from "./i18n";

/** Mise en forme des statistiques, de la progression et des récaps ; sans appel d'API (utilisable côté serveur). */

export interface Amount { currency: string; cents: number }

/** Montant dans sa devise, sans conversion. */
export const formatAmount = (a: Amount, options: Intl.NumberFormatOptions = {}) =>
  new Intl.NumberFormat(intlLocale(), { style: "currency", currency: a.currency, ...options }).format(a.cents / 100);

/** Plusieurs devises : une valeur par devise, la principale d'abord. */
export const formatAmounts = (amounts: Amount[], options?: Intl.NumberFormatOptions) => amounts.map((a) => formatAmount(a, options)).join(" · ");

/** « 2 h 40 » ou « 35 min ». */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t("{n} min", { n: m });
  return m === 0 ? t("{h} h", { h }) : t("{h} h {m}", { h, m: String(m).padStart(2, "0") });
}

/** Le nom du niveau, celui de la matière du cadre de la carte vendeur (« Bois ») ; à défaut, « Niveau 2 ». */
export const levelLabel = (level: number, names: readonly string[] = levelNames) =>
  names[level - 1] ? t(names[level - 1]!) : t("Niveau {n}", { n: level });

export const salesToGo = (n: number) => tn(n, "encore {n} vente", "encore {n} ventes");

/** « novembre 2026 », ou « 2026 » pour un récap annuel. */
export function periodName(period: string): string {
  if (/^\d{4}$/.test(period)) return period;
  return new Intl.DateTimeFormat(intlLocale(), { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));
}
