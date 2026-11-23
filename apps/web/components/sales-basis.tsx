import { formatEuros } from "@/lib/format";
import { t } from "@/lib/i18n";
import { CONFIDENCE_HINT, CONFIDENCE_LABEL, age, quoteLabel } from "@/lib/pricing";
import type { SalesEstimate } from "@/lib/types";
import { cn } from "@/lib/utils";

const DOT: Record<SalesEstimate["confidence"], string> = { HIGH: "bg-success", MEDIUM: "bg-warning", LOW: "bg-muted-foreground/50" };

/**
 * D'où vient le prix estimé d'une carte : les ventes réussies relevées (semaine, mois, veille) et leur fiabilité,
 * ou, faute de vente récente, la cote d'annonces qui sert de repère.
 */
export function SalesBasis({ reference, sales, className }: {
  reference: { quoteType: string; amountCents: number; observedAt: string } | null;
  sales: SalesEstimate | null;
  className?: string;
}) {
  if (!reference) return <p className={className}>{t("Aucune cote connue pour cette carte.")}</p>;
  if (!sales) {
    return (
      <p className={className} data-testid="sales-basis">
        {t("Aucune vente récente.")} {t("{source} des annonces Cardmarket", { source: quoteLabel(reference.quoteType) })}{" "}
        <span className="tabular font-medium text-foreground">{formatEuros(reference.amountCents)}</span>{t(", relevée {age}.", { age: age(reference.observedAt) })}
      </p>
    );
  }
  return (
    <div className={cn("grid gap-0.5", className)} data-testid="sales-basis">
      <p>
        {t("Ventes réussies")} <span className="tabular font-medium text-foreground">{formatEuros(sales.cents)}</span>
        <span className="ml-2 inline-flex items-center gap-1.5 align-baseline" title={t(CONFIDENCE_HINT[sales.confidence])}>
          <span className={cn("size-1.5 rounded-full", DOT[sales.confidence])} aria-hidden />
          {t(CONFIDENCE_LABEL[sales.confidence])}
        </span>
      </p>
      <p className="tabular text-xs">
        {sales.sales.map((s) => `${quoteLabel(s.quoteType)} ${formatEuros(s.amountCents)}`).join(" · ")} — {t("Cardmarket, relevées {age}", { age: age(reference.observedAt) })}
      </p>
    </div>
  );
}
