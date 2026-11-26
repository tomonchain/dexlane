"use client";

import { ChevronRight, ScrollText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink, EmptyState, Loading, Page, PageHeader } from "@/components/ui/misc";
import { insights, periodName, type RecapSummary } from "@/lib/insights";
import { t, tn } from "@/lib/i18n";

/** Les récaps passés : un par mois où le compte a publié ou vendu, un par année. */
export default function RecapsPage() {
  const [recaps, setRecaps] = useState<RecapSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    insights.recaps().then((r) => setRecaps(r.recaps)).catch((e: Error) => setError(e.message));
  }, []);
  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader back={<BackLink href="/account">{t("Compte")}</BackLink>} title={t("Récaps")}
        description={t("Le 1er de chaque mois, ce que ton mois a donné ; le 1er janvier, ton année.")} />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!recaps && !error && <Loading />}
      {recaps?.length === 0 && (
        <EmptyState icon={<ScrollText />} title={t("Pas encore de récap")}>
          {t("Le premier arrive le 1er du mois prochain, si tu as publié ou vendu au moins une carte ce mois-ci.")}
        </EmptyState>
      )}
      {recaps && recaps.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card" data-testid="recap-list">
          {recaps.map((r) => (
            <li key={r.period}>
              <Link href={`/recap/${r.period}`} className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-accent/60 focus-visible:bg-accent">
                <span className="grid flex-1 gap-0.5">
                  <span className="text-sm font-medium first-letter:uppercase">{r.kind === "year" ? t("Année {year}", { year: r.period }) : periodName(r.period)}</span>
                  <span className="text-xs text-muted-foreground">{tn(r.cardsSold, "{n} carte vendue", "{n} cartes vendues")}</span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
