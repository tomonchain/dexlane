"use client";

import { STRATEGY_OPTIONS } from "@/lib/pricing";
import { t } from "@/lib/i18n";
import type { PricingSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Carte d'exemple : annonce la moins chère 8 €, ventes récentes 9 €, plus haut soutenu 10,40 €. */
const EXAMPLE: Record<PricingSettings["strategy"], string> = { FAST: "8,10 €", BALANCED: "9,70 €", MARGIN: "10 €" };

/** Choix de l'arbitrage entre vitesse de vente et marge, avec ce que chaque option donne sur une même carte. */
export function StrategyPicker({ value, onChange }: { value: PricingSettings["strategy"]; onChange: (value: PricingSettings["strategy"]) => void }) {
  return (
    <div className="grid gap-2">
      <div role="radiogroup" aria-label={t("Stratégie de prix")} className="grid gap-2 sm:grid-cols-3">
        {STRATEGY_OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                "grid content-start gap-1.5 rounded-lg border bg-card p-3 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/30",
                selected && "border-foreground ring-1 ring-foreground hover:bg-card",
              )}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">{t(option.label)}</span>
                <span className="tabular text-sm text-muted-foreground">{t(EXAMPLE[option.value])}</span>
              </span>
              <span className="text-[13px] leading-snug text-muted-foreground">{t(option.hint)}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("Exemple pour une carte dont l'annonce la moins chère est à 8 €, les ventes récentes à 9 € et le plus haut prix soutenu à 10,40 €.")}{" "}
        {t("Dans tous les cas, le prix ne descend jamais sous ton prix d'achat.")}
      </p>
    </div>
  );
}
