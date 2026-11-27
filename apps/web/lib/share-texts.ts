import type { ShareCard, ShareMetric } from "@dexlane/insights/share";
import { formatNumber } from "./format";
import { formatAmount, formatAmounts, formatMinutes, levelLabel, periodName } from "./insights-format";
import { t, tn } from "./i18n";
import type { ShareTexts } from "./share-image";

/** Les textes de l'image de partage dans la langue en cours (calculés d'un coup, avant le rendu). */
export function shareTexts(card: ShareCard): ShareTexts {
  const eyebrow = card.kind === "year" ? t("Mon récap de l'année") : t("Mon récap du mois");
  const name = periodName(card.period);
  const heading = name.charAt(0).toUpperCase() + name.slice(1);
  const metrics = new Map<ShareMetric["key"], { value: string; label: string }>();
  for (const m of card.metrics) {
    if (m.key === "cardsSold") metrics.set(m.key, { value: formatNumber(m.value), label: tn(m.value, "carte vendue", "cartes vendues") });
    if (m.key === "timeSaved") metrics.set(m.key, { value: formatMinutes(m.minutes), label: t("gagnées grâce à Dexlane (estimation)") });
    if (m.key === "achievements") metrics.set(m.key, { value: String(m.value), label: tn(m.value, "succès débloqué", "succès débloqués") });
    if (m.key === "level") metrics.set(m.key, { value: levelLabel(m.value), label: t("niveau {n} de la boutique", { n: m.value }) });
    if (m.key === "revenue") metrics.set(m.key, { value: formatAmounts(m.amounts, { maximumFractionDigits: 0 }), label: t("de chiffre d'affaires") });
  }
  const bestSale = card.bestSale
    ? card.bestSale.unitPriceCents === null
      ? t("Meilleure vente : {name}", { name: card.bestSale.name })
      : t("Meilleure vente : {name}, {price}", { name: card.bestSale.name, price: formatAmount({ currency: card.bestSale.currency, cents: card.bestSale.unitPriceCents }) })
    : null;
  return { eyebrow, heading, metric: (m) => metrics.get(m.key)!, bestSale: () => bestSale ?? "" };
}
