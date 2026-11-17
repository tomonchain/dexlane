"use client";

import { TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatEuros } from "@/lib/format";
import { CATEGORY_LABEL, CATEGORY_VARIANT, age, quoteLabel, reasonLabel } from "@/lib/pricing";
import type { CardCondition, VariantQuote } from "@/lib/types";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
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
          <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Estimation</h2>
          {quote && <Badge variant={CATEGORY_VARIANT[quote.category]}>{CATEGORY_LABEL[quote.category]}</Badge>}
        </div>
        {!variantId || !condition ? (
          <p className="text-sm text-muted-foreground">Choisissez la variante et l'état pour voir le prix de référence.</p>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">Estimation indisponible pour le moment.</p>
        ) : !quote ? (
          <Skeleton className="h-12" />
        ) : (
          <>
            <div className="flex items-end justify-between gap-4">
              <div className="grid gap-0.5">
                <span className="text-xs text-muted-foreground">Prix estimé pour cet état</span>
                <span className="tabular text-2xl leading-none font-semibold tracking-tight">{quote.suggestedCents === null ? "—" : formatEuros(quote.suggestedCents)}</span>
              </div>
              {quote.reference && (
                <span className="text-right text-xs text-muted-foreground">
                  {quoteLabel(quote.reference.quoteType)} Cardmarket <span className="tabular font-medium text-foreground">{formatEuros(quote.reference.amountCents)}</span>
                  <br />relevée {age(quote.reference.observedAt)}
                </span>
              )}
            </div>
            {quote.reasons.length > 0 && (
              <Alert variant="warning">
                {quote.reasons.length === 1 ? reasonLabel(quote.reasons[0]!) : (
                  <ul className="list-disc pl-4">{quote.reasons.map((r) => <li key={r}>{reasonLabel(r)}</li>)}</ul>
                )}
              </Alert>
            )}
            <p className="text-xs text-muted-foreground">Référence toutes langues et tous états confondus, corrigée par un coefficient d'état. Le prix se décide ensuite dans « Prix ».</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
