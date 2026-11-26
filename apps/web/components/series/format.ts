/**
 * Pages publiques des séries et des cartes : adresses, libellés et formats. Le site public est en français ; ses
 * textes ne passent pas par `t()`, comme le reste du site marketing.
 */
import { cardSlug, setSlug, type PublicSet, type PublicVariant } from "@dexlane/catalog";

export const SERIES_PATH = "/series";
export const setPath = (set: Pick<PublicSet, "id" | "name">) => `${SERIES_PATH}/${setSlug(set)}`;
export const cardPath = (set: Pick<PublicSet, "id" | "name">, card: { localNumber: string; name: string }) => `${setPath(set)}/${cardSlug(card)}`;

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
export const formatPrice = (cents: number) => euros.format(cents / 100);

const day = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" });
export const formatDay = (d: Date | string) => day.format(typeof d === "string" ? new Date(d) : d);

const month = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "Europe/Paris" });
/** « novembre 2026 », pour une date de sortie AAAA-MM-JJ. */
export const formatRelease = (date: string | null) => (date ? month.format(new Date(`${date}T12:00:00Z`)) : null);

/** « 4/102 », ou le numéro seul quand le dénominateur imprimé est inconnu. */
export const printedNumber = (localNumber: string, official: number | null) => (official ? `${localNumber}/${official}` : localNumber);

const FINISH: Record<string, string> = { normal: "Normale", holo: "Holo", reverse: "Reverse", unknown: "Finition inconnue" };

/** « Holo · 1re édition · sans ombre » : ce qui distingue une impression d'une autre. */
export function variantName(v: Pick<PublicVariant, "finish" | "edition" | "subtype" | "stamp">): string {
  return [
    FINISH[v.finish] ?? v.finish,
    v.edition === "1st" ? "1re édition" : v.edition === "unlimited" ? "" : v.edition,
    v.subtype,
    v.stamp && `tampon ${v.stamp}`,
  ].filter(Boolean).join(" · ");
}

/** Visuel TCGdex : l'URL du catalogue est une base à compléter par la qualité et le format. */
export const cardImage = (imageUrl: string | null, quality: "low" | "high" = "low") => (imageUrl ? `${imageUrl}/${quality}.webp` : null);
export const PRICE_SOURCE = "Cote tendance Cardmarket, via TCGdex, toutes conditions confondues.";
