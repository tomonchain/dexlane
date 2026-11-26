"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, BellRing, Check, Lightbulb, RefreshCw, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertRules } from "@/components/alert-rules";
import { StatsSummary } from "@/components/insights/stats-summary";
import { CardThumb } from "@/components/card-chooser";
import { HorizontalBars, MonthlyColumns, PairedMonthlyColumns, Sparkline } from "@/components/charts";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Eyebrow } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, Page, PageHeader, Spinner } from "@/components/ui/misc";
import { SegmentedTabs } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { dateFormat, formatDateTime, formatEuros, formatNumber, parseEuros, variantLabel } from "@/lib/format";
import { intlLocale, t, tn } from "@/lib/i18n";
import { CATEGORY_LABEL, eurosInput, type Category } from "@/lib/pricing";
import type { AlertSettings, Dashboard, PriceMove, PriceMoves, SalesInsights } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DashboardSkeleton, ListSkeleton } from "@/components/skeletons";
import { useCachedState } from "@/lib/cache";

const CHANNEL_LABEL: Record<string, string> = { direct: "Vente directe", ebay: "eBay", cardtrader: "CardTrader" };
const wholeEuros = () => new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const compactEuros = (cents: number) => wholeEuros().format(cents / 100);
const signed = (cents: number) => `${cents > 0 ? "+" : "−"}${formatEuros(Math.abs(cents))}`;
const percent = () => new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1, signDisplay: "always" });
const day = () => dateFormat({ day: "numeric", month: "short" });
/** « 12 % » en français, « 12% » en anglais. */
const pct = (n: number | string) => t("{n} %", { n });
/** Nom du jour dans la langue de l'interface : 1 = lundi … 7 = dimanche (le 1er janvier 2024 est un lundi). */
const weekdayName = (weekday: number) => dateFormat({ weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, weekday)));

function Tile({ label, value, children, href }: { label: string; value: ReactNode; children?: ReactNode; href?: string }) {
  const body = (
    <CardContent className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="tabular text-2xl leading-none font-semibold tracking-tight">{value}</span>
      {children && <span className="text-xs text-muted-foreground">{children}</span>}
    </CardContent>
  );
  return href ? (
    <Link href={href} className="rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"><Card className="h-full transition-colors hover:bg-accent/40">{body}</Card></Link>
  ) : <Card>{body}</Card>;
}

type View = "RESUME" | "VENTES" | "COTES";
const PERIODS: { value: string; label: string }[] = [
  { value: "30", label: "30 jours" },
  { value: "90", label: "90 jours" },
  { value: "365", label: "12 mois" },
];

export default function StatisticsPage() {
  return (
    <Suspense>
      <Statistics />
    </Suspense>
  );
}

/** Statistiques : le résumé de la période et les cartes dormantes (par défaut), ce qui se vend, puis la valeur du stock et les variations de cote. */
function Statistics() {
  const params = useSearchParams();
  const asked = params.get("view");
  const [view, setView] = useState<View>(asked === "cotes" || asked === "prices" ? "COTES" : asked === "ventes" ? "VENTES" : "RESUME");
  return (
    <Page>
      <PageHeader title={t("Statistiques")} description={t("Ce qui se vend, à quel prix et à quelle vitesse ; puis la valeur de votre stock et les cotes qui bougent.")} />
      <div>
        <SegmentedTabs label={t("Vue")} value={view} onChange={setView} tabs={[{ value: "RESUME", label: t("Résumé") }, { value: "VENTES", label: t("Ce qui se vend") }, { value: "COTES", label: t("Stock et cotes") }]} />
      </div>
      {view === "RESUME" ? <StatsSummary /> : view === "VENTES" ? <SalesView /> : <StockView />}
    </Page>
  );
}

// ───────────────────────── Ventes ─────────────────────────

const share = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));
const evolution = (now: number, before: number) => (before === 0 ? null : Math.round(((now - before) / before) * 100));

/** Les enseignements les plus utiles de la période, en phrases : ce qu'on retient sans lire chaque graphique. */
function takeaways(d: SalesInsights): string[] {
  const out: string[] = [];
  const totals = d.totals;
  const band = [...d.byPriceBand].sort((a, b) => b.cards - a.cards)[0];
  if (band && band.cards > 0) out.push(t("La tranche qui se vend le plus : {band}, {percent} % des cartes vendues.", { band: t(band.label).toLowerCase(), percent: share(band.cards, totals.cards) }));
  const flowing = d.bySet.filter((x) => x.cards >= 3).sort((a, b) => b.sellThroughPercent - a.sellThroughPercent)[0];
  if (flowing) out.push(t("{set} s'écoule le mieux : {percent} % de ce que vous en aviez est vendu.", { set: flowing.label, percent: Math.round(flowing.sellThroughPercent) }));
  if (totals.medianDaysToSell !== null) {
    out.push(totals.medianDaysToSell === 0
      ? t("La moitié des cartes vendues partent le jour même de leur entrée en stock.")
      : tn(totals.medianDaysToSell, "La moitié des cartes vendues partent en moins de {n} jour après leur entrée en stock.", "La moitié des cartes vendues partent en moins de {n} jours après leur entrée en stock."));
  }
  const peak = [...d.byWeekday].sort((a, b) => b.orders - a.orders)[0];
  if (peak && totals.orders >= 5 && peak.orders > totals.orders / 7) {
    out.push(tn(peak.orders, "Le {day} est le jour où vous vendez le plus ({n} vente).", "Le {day} est le jour où vous vendez le plus ({n} ventes).", { day: weekdayName(peak.weekday) }));
  }
  const trend = evolution(totals.revenueCents, d.previous.revenueCents);
  if (trend !== null && Math.abs(trend) >= 5) {
    out.push(trend > 0
      ? t("Chiffre d'affaires en hausse de {percent} % par rapport à la période précédente.", { percent: Math.abs(trend) })
      : t("Chiffre d'affaires en baisse de {percent} % par rapport à la période précédente.", { percent: Math.abs(trend) }));
  }
  return out.slice(0, 4);
}

function Delta({ now, before }: { now: number; before: number }) {
  const change = evolution(now, before);
  if (change === null) return null;
  const Arrow = change >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("tabular inline-flex items-center gap-0.5 text-xs font-medium", change > 0 ? "text-success" : change < 0 ? "text-destructive" : "text-muted-foreground")}>
      <Arrow className="size-3.5" aria-hidden /> {pct(`${change > 0 ? "+" : ""}${change}`)}
    </span>
  );
}

function Kpi({ label, value, hint, delta, testId }: { label: string; value: ReactNode; hint?: ReactNode; delta?: ReactNode; testId?: string }) {
  return (
    <div className="grid content-start gap-1.5 bg-card p-3 sm:p-4">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="tabular text-lg leading-none font-semibold tracking-tight sm:text-2xl" data-testid={testId}>{value}</span>
        {delta}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Panel({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="grid content-start gap-4">
        <div className="grid gap-1">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

const cardsNote = (n: number) => tn(n, "{n} carte", "{n} cartes");

/**
 * Équilibre entre ce qu'on met en vente et ce qui part. Le rapport vendues ÷ mises en vente est « équilibré » entre
 * 80 et 125 % : en dessous, le stock en vente s'accumule ; au-dessus, il se vide. « En croissance » quand les deux
 * flux progressent d'au moins 5 % sur la période précédente.
 */
function balance(d: Pick<SalesInsights, "totals" | "previous">) {
  const { listed, cards: sold } = d.totals;
  const ratio = listed === 0 ? null : Math.round((sold / listed) * 100);
  const growing = (now: number, before: number) => before > 0 && now >= before * 1.05;
  const shrinking = (now: number, before: number) => before > 0 && now <= before * 0.95;
  const trend = growing(listed, d.previous.listed) && growing(sold, d.previous.cards) ? "UP"
    : shrinking(listed, d.previous.listed) && shrinking(sold, d.previous.cards) ? "DOWN" : "FLAT";
  const state = ratio === null ? (sold > 0 ? "DRAINING" : "NONE") : ratio < 80 ? "PILING" : ratio > 125 ? "DRAINING" : "BALANCED";
  return { ratio, trend, state } as const;
}

function BalancePanel({ data }: { data: SalesInsights }) {
  const { ratio, trend, state } = balance(data);
  const { listed, cards: sold } = data.totals;
  const verdict = {
    BALANCED: { badge: trend === "UP" ? t("Équilibré et en croissance") : t("Équilibré"), variant: "success" as const,
      text: trend === "UP" ? t("Vous mettez en vente à peu près ce que vous vendez, et les deux progressent : c'est le bon rythme.")
        : trend === "DOWN" ? t("Mises en vente et ventes s'équilibrent, mais reculent toutes les deux par rapport à la période précédente.")
        : t("Vous mettez en vente à peu près ce que vous vendez. Pour grandir, augmentez les deux ensemble.") },
    PILING: { badge: t("Le stock s'accumule"), variant: "warning" as const,
      text: t("Vous mettez en vente plus que vous ne vendez : ralentissez les mises en ligne ou revoyez les prix de ce qui ne part pas.") },
    DRAINING: { badge: t("Le stock se vide"), variant: "warning" as const,
      text: t("Vous vendez plus que vous ne mettez en vente : remettez des cartes en ligne pour ne pas manquer de stock.") },
    NONE: { badge: null, variant: "neutral" as const, text: t("Aucune carte mise en vente ni vendue sur la période.") },
  }[state];
  const ratioOf = (s: number, l: number) => (l === 0 ? "—" : pct(Math.round((s / l) * 100)));
  return (
    <Panel title={t("Mises en vente et ventes")} description={t("Le but : un rapport équilibré, avec des mises en vente et des ventes qui progressent ensemble.")}>
      <div className="grid gap-4" data-testid="sales-balance">
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
          <Kpi label={t("Mises en vente")} testId="balance-listed" value={formatNumber(listed)} delta={<Delta now={listed} before={data.previous.listed} />} />
          <Kpi label={t("Vendues")} value={formatNumber(sold)} delta={<Delta now={sold} before={data.previous.cards} />} />
          <Kpi label={t("Vendues ÷ mises en vente")} testId="balance-ratio" value={ratio === null ? "—" : pct(ratio)}
            hint={data.previous.listed > 0 ? t("{ratio} la période précédente", { ratio: ratioOf(data.previous.cards, data.previous.listed) }) : undefined} />
        </div>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 text-sm">
          {verdict.badge && <Badge variant={verdict.variant} data-testid="balance-verdict">{verdict.badge}</Badge>}
          <p className="min-w-0 flex-1 basis-64 text-muted-foreground">{verdict.text}</p>
        </div>
        <PairedMonthlyColumns
          label={t("Mises en vente et ventes par mois")}
          series={[t("Mises en vente"), t("Vendues")]}
          format={(n) => formatNumber(Math.round(n))}
          data={data.months.map((m) => ({
            key: m.month, month: m.month, values: [m.listed, m.cards],
            details: [[t("Mises en vente"), formatNumber(m.listed)], [t("Vendues"), formatNumber(m.cards)], [t("Vendues ÷ mises en vente"), ratioOf(m.cards, m.listed)]],
          }))}
        />
        <p className="text-xs text-muted-foreground">
          {t("Une carte compte comme mise en vente à sa première mise en ligne, ou le jour de sa vente si elle part en direct sans être passée en ligne.")}
        </p>
      </div>
    </Panel>
  );
}

function SalesView() {
  const [days, setDays] = useState("90");
  const [data, setData] = useCachedState<SalesInsights>(`stats:sales:${days}`);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // Une période déjà consultée s'affiche tout de suite, puis se met à jour.
    api.salesInsights(Number(days)).then(setData).catch((e: Error) => setError(e.message));
  }, [days]);

  const period = PERIODS.find((p) => p.value === days)!.label;
  return (
    <div className="grid gap-5" data-testid="sales-insights">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs label={t("Période")} value={days} onChange={setDays} tabs={PERIODS.map((p) => ({ ...p, label: t(p.label) }))} />
        <p className="text-xs text-muted-foreground">{t("Ventes enregistrées sur les {period} écoulés, hors ventes annulées.", { period: t(period) })}</p>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {!data && !error && <DashboardSkeleton />}
      {data && data.totals.cards === 0 && data.totals.listed > 0 && <BalancePanel data={data} />}
      {data && data.totals.cards === 0 && (
        <EmptyState icon={<TrendingUp />} title={t("Aucune vente sur les {period} écoulés", { period: t(period) })}>
          {t("Les statistiques se remplissent avec vos ventes : séries qui partent, prix qui se vendent, délai de vente.")}
          {days !== "365" && ` ${t("Élargissez la période pour voir plus loin.")}`}
        </EmptyState>
      )}
      {data && data.totals.cards > 0 && <SalesReport data={data} />}
    </div>
  );
}

function SalesReport({ data }: { data: SalesInsights }) {
  const totals = data.totals;
  const notes = takeaways(data);
  const channelLabel = (c: string) => (CHANNEL_LABEL[c] ? t(CHANNEL_LABEL[c]!) : c);
  return (
    <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border shadow-xs lg:grid-cols-4">
        <Kpi label={t("Chiffre d'affaires")} testId="sales-revenue" value={compactEuros(totals.revenueCents)} delta={<Delta now={totals.revenueCents} before={data.previous.revenueCents} />}
          hint={t("Cartes seules · marge {margin} après coût d'achat", { margin: compactEuros(totals.marginCents) })} />
        <Kpi label={t("Cartes vendues")} testId="sales-cards" value={formatNumber(totals.cards)} delta={<Delta now={totals.cards} before={data.previous.cards} />}
          hint={tn(totals.orders, "{n} vente · panier moyen {price}", "{n} ventes · panier moyen {price}", { price: formatEuros(totals.averageOrderCents) })} />
        <Kpi label={t("Prix moyen d'une carte")} value={formatEuros(totals.averageCardCents)} hint={t("Prix de vente, hors port")} />
        <Kpi label={t("Délai de vente")} value={totals.medianDaysToSell === null ? "—" : t("{n} j", { n: totals.medianDaysToSell })}
          hint={totals.sellThroughPercent === null ? t("Délai médian depuis l'entrée en stock") : t("Délai médian · {percent} % du stock écoulé", { percent: Math.round(totals.sellThroughPercent) })} />
      </div>

      {notes.length > 0 && (
        <Card className="border-brand/30 bg-brand-soft/40">
          <CardContent className="grid gap-2">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"><Lightbulb className="size-4 text-brand" aria-hidden /> {t("À retenir")}</h2>
            <ul className="grid gap-1.5 text-sm" data-testid="sales-takeaways">
              {notes.map((n) => <li key={n} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />{n}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      <BalancePanel data={data} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title={t("Chiffre d'affaires par mois")} description={t("Prix des cartes vendues, sur douze mois.")}>
          <MonthlyColumns
            label={t("Chiffre d'affaires par mois")}
            format={compactEuros}
            data={data.months.map((m) => ({ key: m.month, month: m.month, value: m.revenueCents, details: [[t("Chiffre d'affaires"), formatEuros(m.revenueCents)], [t("Cartes"), formatNumber(m.cards)]] }))}
          />
        </Panel>
        <Panel title={t("À quel prix ça part")} description={t("Cartes vendues par tranche de prix de vente.")}>
          <HorizontalBars format={(n) => formatNumber(n)}
            data={data.byPriceBand.map((b) => ({ key: b.key, label: t(b.label), value: b.cards, note: b.cards > 0 ? formatEuros(b.revenueCents) : undefined }))} />
        </Panel>
      </div>

      <Panel title={t("Séries qui se vendent")} description={t("Cartes vendues sur la période, ce qu'il en reste, et la part écoulée.")}>
        {/* Une grille plutôt qu'un tableau : sur téléphone, chaque série tient sur deux lignes, sans défilement de côté. */}
        <div className="grid text-sm" data-testid="sales-by-set">
          <div className="hidden grid-cols-[minmax(0,1fr)_5rem_6rem_5rem_minmax(8rem,30%)] gap-3 border-b pb-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>{t("Série")}</span><span className="text-right">{t("Vendues")}</span><span className="text-right">{t("CA")}</span><span className="text-right">{t("En stock")}</span><span>{t("Écoulement")}</span>
          </div>
          <ul className="divide-y">
            {data.bySet.map((x) => (
              <li key={x.key} className="tabular grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_5rem_6rem_5rem_minmax(8rem,30%)] sm:py-2">
                <span className="truncate font-medium">{x.label}</span>
                <span className="text-right text-xs text-muted-foreground sm:hidden">{tn(x.cards, "{n} vendue", "{n} vendues")} · {formatEuros(x.revenueCents)} · {t("{n} en stock", { n: formatNumber(x.inStock) })}</span>
                <span className="hidden text-right sm:block">{x.cards}</span>
                <span className="hidden text-right sm:block">{formatEuros(x.revenueCents)}</span>
                <span className="hidden text-right text-muted-foreground sm:block">{x.inStock}</span>
                <span className="col-span-2 flex items-center gap-2 sm:col-span-1">
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="block h-full rounded-full bg-chart-1" style={{ width: `${Math.min(x.sellThroughPercent, 100)}%` }} />
                  </span>
                  <span className="w-16 text-right text-xs font-medium sm:w-10">{pct(Math.round(x.sellThroughPercent))}<span className="sm:hidden"> {t("écoulé")}</span></span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Panel title={t("Par état")} description={t("Cartes vendues selon leur état.")}>
          <HorizontalBars format={(n) => formatNumber(n)} data={data.byCondition.map((c) => ({ key: c.key, label: `${c.key} · ${c.label}`, value: c.cards, note: formatEuros(c.revenueCents) }))} />
        </Panel>
        <Panel title={t("Par rareté")} description={t("Les raretés qui partent le plus.")}>
          <HorizontalBars format={(n) => formatNumber(n)} data={data.byRarity.map((r) => ({ key: r.key || "none", label: r.key ? r.label : t("Sans rareté"), value: r.cards, note: formatEuros(r.revenueCents) }))} />
        </Panel>
        <Panel title={t("Délai de vente")} description={t("Temps entre l'entrée en stock et la vente.")}>
          <HorizontalBars format={(n) => formatNumber(n)} data={data.daysToSell.map((d) => ({ key: d.key, label: t(d.label), value: d.cards, note: d.cards > 0 ? pct(share(d.cards, totals.cards)) : undefined }))} />
        </Panel>
        <Panel title={t("Jour de la semaine")} description={t("Nombre de ventes enregistrées.")}>
          <HorizontalBars format={(n) => formatNumber(n)} data={data.byWeekday.map((w) => {
            const name = weekdayName(w.weekday);
            return { key: String(w.weekday), label: name.charAt(0).toUpperCase() + name.slice(1), value: w.orders };
          })} />
        </Panel>
        <Panel title={t("Par canal")} description={t("Où se font les ventes.")}>
          <HorizontalBars format={formatEuros} data={data.byChannel.map((c) => ({ key: c.key, label: channelLabel(c.key), value: c.revenueCents, note: tn(c.orders, "{n} vente", "{n} ventes") }))} />
        </Panel>
        <Panel title={t("Cartes les plus vendues")} className="md:col-span-2 xl:col-span-1">
          <ol className="grid gap-2 text-sm" data-testid="sales-top-cards">
            {data.topCards.map((c, i) => (
              <li key={c.catalogCardId} className="flex items-baseline gap-3">
                <span className="tabular w-4 shrink-0 text-xs text-muted-foreground">{i + 1}</span>
                <span className="grid min-w-0 flex-1">
                  <Link href={`/card/${c.catalogCardId}`} className="truncate font-medium underline-offset-2 hover:underline">{c.name}</Link>
                  <span className="truncate text-xs text-muted-foreground">{c.setName} · {c.cards > 1 ? t("{cards}, {price} pièce en moyenne", { cards: cardsNote(c.cards), price: formatEuros(c.averageCents) }) : cardsNote(c.cards)}</span>
                </span>
                <span className="tabular font-medium">{formatEuros(c.revenueCents)}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  );
}

// ───────────────────────── Stock et cotes ─────────────────────────

function StockView() {
  const [dashboard, setDashboard] = useCachedState<Dashboard>("stats:dashboard");
  const [alertsOnly, setAlertsOnly] = useState(true);
  const [moves, setMoves] = useCachedState<PriceMoves>(`stats:moves:${alertsOnly}`, { keepPrevious: true });
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadMoves = useCallback(() => {
    api.priceMoves(alertsOnly).then(setMoves).catch((e: Error) => setError(e.message));
  }, [alertsOnly]);
  useEffect(() => {
    api.dashboard().then(setDashboard).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(loadMoves, [loadMoves]);

  async function refreshPrices() {
    setRefreshing(true);
    setError(null);
    try {
      const r = await api.refreshPrices();
      toast.success(
        r.pricesInserted > 0
          ? tn(r.pricesInserted, "{n} nouvelle cote sur {cards}", "{n} nouvelles cotes sur {cards}", { cards: cardsNote(r.cards) })
          : tn(r.cards, "Cotes déjà à jour ({n} carte vérifiée)", "Cotes déjà à jour ({n} cartes vérifiées)"),
      );
      if (r.errors > 0) setError(tn(r.errors, "{n} carte n'a pas pu être relevée : la source des cotes n'a pas répondu.", "{n} cartes n'ont pas pu être relevées : la source des cotes n'a pas répondu."));
      loadMoves();
      api.dashboard().then(setDashboard).catch(() => undefined);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "CATALOG_UNAVAILABLE" ? t("La source des cotes ne répond pas. Réessayez plus tard.") : (e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  if (!dashboard) return error ? <Alert variant="destructive">{error}</Alert> : <DashboardSkeleton />;
  const { stock } = dashboard;
  const latent = stock.marketValueCents - stock.costCents;

  return (
    <div className="grid gap-5">
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile label={t("Valeur du stock")} value={<span data-testid="stat-value">{compactEuros(stock.marketValueCents)}</span>}>
          {t("Au prix cible · coût {cost}", { cost: compactEuros(stock.costCents) })}
        </Tile>
        <Tile label={t("Marge latente")} value={compactEuros(latent)}>
          {t("Ce que rapporterait le stock vendu à son prix, coût d'achat déduit")}
        </Tile>
        <Tile label={t("Cartes en stock")} value={formatNumber(stock.cards)}>
          {t("{n} vendables", { n: formatNumber(stock.sellable) })} · {tn(stock.reserved, "{n} réservée", "{n} réservées")}{stock.unpricedCards > 0 ? ` · ${t("{n} sans prix", { n: formatNumber(stock.unpricedCards) })}` : ""}
        </Tile>
      </div>

      <Panel title={t("Valeur du stock par catégorie")} description={t("Au prix cible, à défaut au prix suggéré.")}>
        <div className="grid gap-6 lg:grid-cols-2">
          {dashboard.byCategory.length > 0 ? (
            <HorizontalBars
              format={compactEuros}
              data={dashboard.byCategory.map((c) => ({ key: c.category, label: CATEGORY_LABEL[c.category as Category] ? t(CATEGORY_LABEL[c.category as Category]) : c.category, value: c.valueCents, note: cardsNote(c.cards) }))}
            />
          ) : <p className="text-sm text-muted-foreground">{t("Aucune carte identifiée en stock.")}</p>}
          {dashboard.topOffers.length > 0 && (
            <div className="grid content-start gap-2">
              <Eyebrow>{t("Cartes les plus chères")}</Eyebrow>
              <ul className="grid gap-1.5 text-sm">
                {dashboard.topOffers.map((o) => (
                  <li key={o.offerSku} className="flex items-baseline justify-between gap-3">
                    <span className="truncate">{o.cardName}{o.quantity > 1 ? ` × ${o.quantity}` : ""}</span>
                    <span className="tabular font-medium">{formatEuros(o.unitCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Panel>

      <section className="grid gap-3" aria-label={t("Variations de prix")}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold tracking-tight">{t("Variations de prix")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("Cote tendance Cardmarket des cartes en stock")}{moves?.latestQuoteAt ? t(", dernier relevé le {date}", { date: formatDateTime(moves.latestQuoteAt) }) : ""}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedTabs
              label={t("Variations de prix")}
              value={alertsOnly ? "ALERTS" : "ALL"}
              onChange={(v) => setAlertsOnly(v === "ALERTS")}
              tabs={[{ value: "ALERTS", label: t("Alertes"), count: moves?.alerts }, { value: "ALL", label: t("Toutes") }]}
            />
            <Button variant="outline" onClick={refreshPrices} disabled={refreshing}>{refreshing ? <Spinner /> : <RefreshCw />} {t("Relever les cotes")}</Button>
          </div>
        </div>
        {moves && <AlertRules settings={moves.settings} onSaved={loadMoves} />}
        {!moves ? <ListSkeleton count={4} label={t("Chargement des variations")} />
          : moves.moves.length === 0 ? (
            <EmptyState icon={alertsOnly ? <BellRing /> : <TrendingUp />} title={alertsOnly && moves.trackedVariants > 0 ? t("Aucune alerte") : t("Pas encore de variation à montrer")}>
              {moves.trackedVariants === 0
                ? tn(moves.settings.windowDays,
                  "Une variation se mesure entre deux relevés espacés d'au moins {n} jour. Les cotes des cartes en stock sont relevées chaque jour : l'historique se construit tout seul.",
                  "Une variation se mesure entre deux relevés espacés d'au moins {n} jours. Les cotes des cartes en stock sont relevées chaque jour : l'historique se construit tout seul.")
                : alertsOnly ? t("Aucune carte en stock n'a bougé au-delà des seuils. L'onglet Toutes montre les variations plus faibles.")
                : t("Les cotes des cartes en stock n'ont pas bougé sur la période.")}
            </EmptyState>
          ) : (
            <Card className="divide-y overflow-hidden">
              {moves.moves.map((move) => <MoveRow key={move.variantId} move={move} />)}
            </Card>
          )}
      </section>
    </div>
  );
}

function MoveRow({ move }: { move: PriceMove }) {
  const up = move.deltaCents > 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5" data-testid={`move-${move.setId}-${move.localNumber}-${move.finish}`}>
      <CardThumb imageUrl={move.imageUrl} size="sm" />
      <div className="min-w-0 flex-1 basis-40">
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          {move.cardName}
          {move.alert && <Badge variant="warning"><BellRing /> {t("Alerte")}</Badge>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {move.setName ?? move.setId} · {t("n° {number}", { number: move.localNumber })} · {variantLabel(move)} · {t("{n} en stock", { n: formatNumber(move.quantity) })}
        </p>
      </div>
      <Sparkline
        values={move.series.map((p) => p.cents)}
        label={t("Cote de {name} sur 90 jours : de {from} à {to}", { name: move.cardName, from: formatEuros(move.series[0]?.cents ?? move.previousCents), to: formatEuros(move.latestCents) })}
        className="hidden sm:block"
      />
      <div className="tabular grid justify-items-end gap-0.5 text-sm sm:w-44">
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{formatEuros(move.previousCents)}</span>
          <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="font-semibold">{formatEuros(move.latestCents)}</span>
        </span>
        <span className="text-xs text-muted-foreground">{t("du {from} au {to}", { from: day().format(new Date(move.previousAt)), to: day().format(new Date(move.latestAt)) })}</span>
      </div>
      <div className="grid w-24 justify-items-end gap-0.5">
        <Badge variant={up ? "success" : "destructive"} className="tabular">
          <Arrow /> {pct(percent().format(move.deltaPercent))}
        </Badge>
        <span className="tabular text-xs text-muted-foreground">{signed(move.deltaCents)}{move.quantity > 1 ? ` × ${move.quantity}` : ""}</span>
      </div>
      {move.targetPriceCents !== null && (
        <p className={cn("basis-full text-xs sm:w-48 sm:basis-auto sm:text-right", move.targetPriceCents < move.latestCents * 0.9 || move.targetPriceCents > move.latestCents * 1.25 ? "text-warning" : "text-muted-foreground")}>
          {t("Votre prix : {price}", { price: formatEuros(move.targetPriceCents) })} — <Link href="/pricing" className="font-medium text-primary underline-offset-2 hover:underline">{t("revoir")}</Link>
        </p>
      )}
    </div>
  );
}
