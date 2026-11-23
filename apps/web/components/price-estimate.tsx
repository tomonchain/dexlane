"use client";

import { TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatEuros } from "@/lib/format";
import { t } from "@/lib/i18n";
import { CATEGORY_LABEL, CATEGORY_VARIANT, reasonLabel } from "@/lib/pricing";
import type { CardCondition, VariantQuote } from "@/lib/types";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { SalesBasis } from "./sales-basis";
import { Card, CardContent } from "./ui/card";
import { Skeleton } from "./ui/misc";

/**
 * Estimation de prix pendant la confirmation d'une carte (Parcours A, étape 4) : la référence avec sa source
 * et sa date, ce qu'elle donne pour l'état choisi, et la catégorie de vente qui en découle.
 */
export function PriceEstimate({ variantId, condition, unique }: { variantId: string | null; condition: CardCondition | null; unique: boolean }) {
  const [quote, setQuote] = useState<VariantQuote | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setQuote(null);
    setFailed(false);
    if (!variantId || !condition) return;
    let current = true;
    api.variantQuote(variantId, condition, unique)
      .then((q) => current && setQuote(q))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [variantId, condition, unique]);

  return (
    <Card data-testid="price-estimate">
      <CardContent className="grid gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-primary" aria-hidden><TrendingUp className="size-3.5" /></span>
          <h2 className="flex-1 text-[15px] font-semibold tracking-tight">{t("Estimation")}</h2>
          {quote && <Badge variant={CATEGORY_VARIANT[quote.category]}>{t(CATEGORY_LABEL[quote.category])}</Badge>}
        </div>
        {!variantId || !condition ? (
          <p className="text-sm text-muted-foreground">{t("Choisissez la variante et l'état pour voir le prix de référence.")}</p>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">{t("Estimation indisponible pour le moment.")}</p>
        ) : !quote ? (
          <Skeleton className="h-12" />
        ) : (
          <>
            <div className="grid gap-0.5">
              <span className="text-xs text-muted-foreground">{t("Prix estimé pour cet état")}</span>
              <span className="tabular text-2xl leading-none font-semibold tracking-tight">{quote.suggestedCents === null ? "—" : formatEuros(quote.suggestedCents)}</span>
            </div>
            {quote.reference && <SalesBasis reference={quote.reference} sales={quote.sales} className="text-[13px] text-muted-foreground" />}
            {quote.reasons.length > 0 && (
              <Alert variant="warning">
                {quote.reasons.length === 1 ? reasonLabel(quote.reasons[0]!) : (
                  <ul className="list-disc pl-4">{quote.reasons.map((r) => <li key={r}>{reasonLabel(r)}</li>)}</ul>
                )}
              </Alert>
            )}
            <p className="text-xs text-muted-foreground">{t("Ventes toutes langues et tous états confondus, corrigées par un coefficient d'état. Le prix se décide ensuite dans le stock.")}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
