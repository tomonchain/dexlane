"use client";

import { formatEuros } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Jauge de prix d'une carte : le prix de vente en barre, le prix de revient en trait, la cote en point, sur une même
 * échelle. D'un coup d'œil : la marge (l'écart entre le trait et le bout de la barre) et la position face au marché
 * (le point avant ou après le bout de la barre). Barre rouge : prix sous le prix de revient.
 */
export function PriceGauge({ priceCents, costCents, quoteCents, size = "sm", className }: {
  priceCents: number | null;
  costCents: number;
  quoteCents: number | null;
  size?: "sm" | "lg";
  className?: string;
}) {
  const top = Math.max(priceCents ?? 0, costCents, quoteCents ?? 0);
  if (top <= 0) return null;
  const scale = top * 1.12; // de la place après la plus grande valeur, pour que rien ne colle au bord
  const at = (cents: number) => `${Math.min((cents / scale) * 100, 100)}%`;
  const below = priceCents !== null && priceCents < costCents;
  const margin = priceCents === null ? null : priceCents - costCents;
  const summary = [
    priceCents === null ? t("Pas de prix de vente") : t("Prix de vente {price}", { price: formatEuros(priceCents) }),
    t("revient {price}", { price: formatEuros(costCents) }),
    quoteCents === null ? t("pas de cote") : t("cote {price}", { price: formatEuros(quoteCents) }),
    ...(margin === null ? [] : [t("marge {price}", { price: formatEuros(margin) })]),
  ].join(" · ");
  const lg = size === "lg";

  return (
    <span className={cn("relative block", lg ? "h-4" : "h-3", className)} title={summary} role="img" aria-label={summary} data-testid="price-gauge">
      <span className={cn("absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-muted", lg ? "h-2" : "h-1.5")} />
      {priceCents !== null && (
        <span
          className={cn("absolute top-1/2 left-0 -translate-y-1/2 rounded-full", lg ? "h-2" : "h-1.5", below ? "bg-destructive" : "bg-success")}
          style={{ width: at(priceCents), minWidth: priceCents > 0 ? 3 : 0 }}
          data-testid="price-gauge-price"
        />
      )}
      <span className={cn("absolute top-0 bottom-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground")} style={{ left: at(costCents) }} data-testid="price-gauge-cost" />
      {quoteCents !== null && (
        <span
          className={cn("absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart-1 ring-2 ring-card", lg ? "size-3" : "size-2.5")}
          style={{ left: at(quoteCents) }}
          data-testid="price-gauge-quote"
        />
      )}
    </span>
  );
}

/** Légende de la jauge : ce que sont la barre, le trait et le point. */
export function PriceGaugeLegend({ className }: { className?: string }) {
  return (
    <span className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground", className)} data-testid="price-gauge-legend">
      <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-full bg-success" aria-hidden />{t("Prix de vente")}</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 rounded-full bg-foreground" aria-hidden />{t("Prix de revient")}</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-chart-1" aria-hidden />{t("Cote")}</span>
    </span>
  );
}
