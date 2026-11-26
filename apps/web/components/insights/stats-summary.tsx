"use client";

import { Info } from "lucide-react";
import Link from "next/link";
import { Tooltip } from "radix-ui";
import { useEffect, useState, type ReactNode } from "react";
import { DailyColumns } from "@/components/charts";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { SegmentedTabs } from "@/components/ui/tabs";
import { DashboardSkeleton } from "@/components/skeletons";
import { useCachedState } from "@/lib/cache";
import { dateFormat, formatNumber } from "@/lib/format";
import { formatAmount, formatAmounts, formatMinutes, insights, type SellerStats, type StatsPeriod } from "@/lib/insights";
import { t, tn } from "@/lib/i18n";
import { DormantCards } from "./dormant";

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: "this_month", label: "Ce mois-ci" },
  { value: "last_month", label: "Mois dernier" },
  { value: "90d", label: "90 derniers jours" },
  { value: "12m", label: "12 derniers mois" },
];

const NONE = "—";
const shortDate = () => dateFormat({ day: "numeric", month: "short", year: "numeric" });
const weekStart = () => dateFormat({ day: "numeric", month: "long", timeZone: "UTC" });

/** Une info-bulle au survol, au focus ou au toucher : le texte reste aussi lisible par un lecteur d'écran. */
export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root open={open} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-label={text} className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30">
            <Info className="size-3.5" aria-hidden />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content sideOffset={6} className="z-50 max-w-64 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
            {text}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function Indicator({ label, value, hint, tip, testId }: { label: string; value: ReactNode; hint?: ReactNode; tip?: string; testId?: string }) {
  return (
    <div className="grid content-start gap-1.5 bg-card p-3 sm:p-4">
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">{label}{tip && <InfoTip text={tip} />}</span>
      <span className="tabular text-lg leading-tight font-semibold tracking-tight break-words sm:text-2xl" data-testid={testId}>{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

/**
 * Résumé de la page Statistiques (#83) : ce qui aide à vendre mieux, sur une période choisie, dans le fuseau de
 * l'utilisateur. Sans donnée, un indicateur affiche « — », jamais 0.
 */
export function StatsSummary() {
  const [period, setPeriod] = useState<StatsPeriod>("this_month");
  const [data, setData] = useCachedState<SellerStats>(`insights:stats:${period}`);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    insights.stats(period).then(setData).catch((e: Error) => setError(e.message));
  }, [period]);

  return (
    <div className="grid gap-5" data-testid="stats-summary">
      <div>
        <SegmentedTabs label={t("Période")} value={period} onChange={setPeriod} tabs={PERIODS.map((p) => ({ ...p, label: t(p.label) }))} />
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {!data && !error && <DashboardSkeleton />}
      {data && <Summary data={data} />}
      <DormantCards />
    </div>
  );
}

function Summary({ data }: { data: SellerStats }) {
  const margin = data.margin;
  const weeks = data.weekly;
  return (
    <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border shadow-xs md:grid-cols-3 xl:grid-cols-6">
        <Indicator label={t("Chiffre d'affaires")} testId="kpi-revenue"
          value={data.revenue ? formatAmounts(data.revenue, { maximumFractionDigits: 0 }) : NONE}
          hint={data.revenue && data.revenue.length > 1 ? t("Une valeur par devise, sans conversion") : t("Hors port, ventes annulées ou remboursées exclues")} />
        <Indicator label={t("Marge")} testId="kpi-margin"
          value={margin && margin.amounts.length ? formatAmounts(margin.amounts, { maximumFractionDigits: 0 }) : NONE}
          hint={margin ? (
            <span className="grid">
              <span>{t("Calculée sur {x} % des ventes", { x: margin.coveragePercent })}</span>
              {margin.ebayFeesMissing && <span data-testid="kpi-fees-missing">{t("Frais eBay non inclus")}</span>}
            </span>
          ) : undefined} />
        <Indicator label={t("Cartes vendues")} testId="kpi-cards" value={data.cardsSold === null ? NONE : formatNumber(data.cardsSold)} hint={t("Un lot compte pour 1")} />
        <Indicator label={t("Taux d'écoulement")} testId="kpi-sell-through"
          value={data.sellThroughPercent === null ? NONE : t("{n} %", { n: formatNumber(data.sellThroughPercent) })}
          tip={t("Cartes vendues ÷ (cartes en ligne au début de la période + cartes mises en ligne pendant).")} />
        <Indicator label={t("Délai médian de vente")} testId="kpi-median"
          value={data.medianDaysToSell === null ? NONE : tn(Math.round(data.medianDaysToSell), "{n} jour", "{n} jours")}
          tip={t("La moitié des cartes vendues sur la période sont parties en moins de temps que ça après leur mise en ligne.")} />
        <Indicator label={t("Temps gagné")} testId="kpi-time"
          value={data.timeSaved ? formatMinutes(data.timeSaved.minutes) : NONE}
          hint={data.timeSaved ? tn(data.timeSaved.listings, "Estimation · {n} annonce publiée", "Estimation · {n} annonces publiées") : t("Estimation")}
          tip={t("Estimation : {n} minutes gagnées par annonce par rapport à une saisie manuelle sur eBay.", { n: data.timeSaved?.minutesPerListing ?? 4 })} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardContent className="grid gap-4">
            <div className="grid gap-1">
              <h2 className="text-[15px] font-semibold tracking-tight">{t("Ventes par semaine")}</h2>
              <p className="text-[13px] text-muted-foreground">{t("Cartes vendues, semaine par semaine (du lundi au dimanche).")}</p>
            </div>
            {data.cardsSold === null
              ? <p className="text-sm text-muted-foreground">{t("Aucune vente sur la période.")}</p>
              : (
                <DailyColumns
                  wholeNumbers
                  label={t("Cartes vendues par semaine")}
                  format={(n) => formatNumber(n)}
                  title={(day) => t("Semaine du {date}", { date: weekStart().format(new Date(`${day}T12:00:00Z`)) })}
                  data={weeks.map((w) => ({
                    day: w.week, value: w.cards,
                    details: [[tn(w.cards, "carte vendue", "cartes vendues"), formatNumber(w.cards)], ...w.revenue.map((a) => [a.currency, formatAmount(a)] as [string, string])],
                  }))}
                />
              )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid gap-3">
            <h2 className="text-[15px] font-semibold tracking-tight">{t("Meilleures ventes")}</h2>
            {data.topSales.length === 0 ? <p className="text-sm text-muted-foreground">{t("Aucune vente sur la période.")}</p> : (
              <ol className="grid gap-2 text-sm" data-testid="top-sales">
                {data.topSales.map((s, i) => (
                  <li key={s.orderLineId} className="flex items-baseline gap-3">
                    <span className="tabular w-5 shrink-0 text-xs text-muted-foreground">{i + 1}</span>
                    <span className="grid min-w-0 flex-1">
                      <Link href={`/card/${s.catalogCardId}`} className="truncate font-medium underline-offset-2 hover:underline">{s.name}</Link>
                      <span className="truncate text-xs text-muted-foreground">{[s.setName, shortDate().format(new Date(s.soldAt)), s.qty > 1 ? t("× {n}", { n: s.qty }) : null].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="tabular font-medium">{formatAmount({ currency: s.currency, cents: s.unitPriceCents })}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
