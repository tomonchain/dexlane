"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, BellRing, Check, Lightbulb, RefreshCw, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertRules } from "@/components/alert-rules";
import { CardThumb } from "@/components/card-chooser";
import { HorizontalBars, MonthlyColumns, Sparkline } from "@/components/charts";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Eyebrow } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, Page, PageHeader, Spinner } from "@/components/ui/misc";
import { SegmentedTabs } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { formatDateTime, formatEuros, parseEuros, variantLabel } from "@/lib/format";
import { CATEGORY_LABEL, eurosInput, type Category } from "@/lib/pricing";
import type { AlertSettings, Dashboard, PriceMove, PriceMoves, SalesInsights } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DashboardSkeleton, ListSkeleton } from "@/components/skeletons";

const CHANNEL_LABEL: Record<string, string> = { direct: "Vente directe", ebay: "eBay", cardtrader: "CardTrader" };
const wholeEuros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const compactEuros = (cents: number) => wholeEuros.format(cents / 100);
const signed = (cents: number) => `${cents > 0 ? "+" : "−"}${formatEuros(Math.abs(cents))}`;
const percent = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1, signDisplay: "always" });
const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

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

type View = "VENTES" | "COTES";
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

/** Statistiques : ce qui se vend (par défaut), puis la valeur du stock et les variations de cote. */
function Statistics() {
  const params = useSearchParams();
  const [view, setView] = useState<View>(params.get("vue") === "cotes" ? "COTES" : "VENTES");
  return (
    <Page>
      <PageHeader title="Statistiques" description="Ce qui se vend, à quel prix et à quelle vitesse ; puis la valeur de votre stock et les cotes qui bougent." />
      <div className="max-w-full overflow-x-auto">
        <SegmentedTabs label="Vue" value={view} onChange={setView} tabs={[{ value: "VENTES", label: "Ventes" }, { value: "COTES", label: "Stock et cotes" }]} />
      </div>
      {view === "VENTES" ? <SalesView /> : <StockView />}
    </Page>
  );
}

// ───────────────────────── Ventes ─────────────────────────

const share = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));
const evolution = (now: number, before: number) => (before === 0 ? null : Math.round(((now - before) / before) * 100));

/** Les enseignements les plus utiles de la période, en phrases : ce qu'on retient sans lire chaque graphique. */
function takeaways(d: SalesInsights): string[] {
  const out: string[] = [];
  const t = d.totals;
  const band = [...d.byPriceBand].sort((a, b) => b.cards - a.cards)[0];
  if (band && band.cards > 0) out.push(`La tranche qui se vend le plus : ${band.label.toLowerCase()}, ${share(band.cards, t.cards)} % des cartes vendues.`);
  const flowing = d.bySet.filter((x) => x.cards >= 3).sort((a, b) => b.sellThroughPercent - a.sellThroughPercent)[0];
  if (flowing) out.push(`${flowing.label} s'écoule le mieux : ${Math.round(flowing.sellThroughPercent)} % de ce que vous en aviez est vendu.`);
  if (t.medianDaysToSell !== null) {
    out.push(t.medianDaysToSell === 0
      ? "La moitié des cartes vendues partent le jour même de leur entrée en stock."
      : `La moitié des cartes vendues partent en moins de ${t.medianDaysToSell} jour${t.medianDaysToSell > 1 ? "s" : ""} après leur entrée en stock.`);
  }
  const peak = [...d.byWeekday].sort((a, b) => b.orders - a.orders)[0];
  if (peak && t.orders >= 5 && peak.orders > t.orders / 7) out.push(`Le ${peak.label} est le jour où vous vendez le plus (${peak.orders} vente${peak.orders > 1 ? "s" : ""}).`);
  const trend = evolution(t.revenueCents, d.previous.revenueCents);
  if (trend !== null && Math.abs(trend) >= 5) out.push(`Chiffre d'affaires ${trend > 0 ? "en hausse" : "en baisse"} de ${Math.abs(trend)} % par rapport à la période précédente.`);
  return out.slice(0, 4);
}

function Delta({ now, before }: { now: number; before: number }) {
  const change = evolution(now, before);
  if (change === null) return null;
  const Arrow = change >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("tabular inline-flex items-center gap-0.5 text-xs font-medium", change > 0 ? "text-success" : change < 0 ? "text-destructive" : "text-muted-foreground")}>
      <Arrow className="size-3.5" aria-hidden /> {change > 0 ? "+" : ""}{change} %
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

const cardsNote = (n: number) => `${n.toLocaleString("fr-FR")} carte${n > 1 ? "s" : ""}`;

function SalesView() {
  const [days, setDays] = useState("90");
  const [data, setData] = useState<SalesInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    api.salesInsights(Number(days)).then(setData).catch((e: Error) => setError(e.message));
  }, [days]);

  const period = PERIODS.find((p) => p.value === days)!.label;
  return (
    <div className="grid gap-5" data-testid="sales-insights">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs label="Période" value={days} onChange={setDays} tabs={PERIODS} />
        <p className="text-xs text-muted-foreground">Ventes enregistrées sur les {period} écoulés, hors ventes annulées.</p>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {!data && !error && <DashboardSkeleton />}
      {data && data.totals.cards === 0 && (
        <EmptyState icon={<TrendingUp />} title={`Aucune vente sur les ${period} écoulés`}>
          Les statistiques se remplissent avec vos ventes : séries qui partent, prix qui se vendent, délai de vente.
          {days !== "365" && " Élargissez la période pour voir plus loin."}
        </EmptyState>
      )}
      {data && data.totals.cards > 0 && <SalesReport data={data} />}
    </div>
  );
}

function SalesReport({ data }: { data: SalesInsights }) {
  const t = data.totals;
  const notes = takeaways(data);
  const channelLabel = (c: string) => CHANNEL_LABEL[c] ?? c;
  return (
    <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border shadow-xs lg:grid-cols-4">
        <Kpi label="Chiffre d'affaires" testId="sales-revenue" value={compactEuros(t.revenueCents)} delta={<Delta now={t.revenueCents} before={data.previous.revenueCents} />}
          hint={`Cartes seules · marge ${compactEuros(t.marginCents)} après coût d'achat`} />
        <Kpi label="Cartes vendues" testId="sales-cards" value={t.cards.toLocaleString("fr-FR")} delta={<Delta now={t.cards} before={data.previous.cards} />}
          hint={`${t.orders} vente${t.orders > 1 ? "s" : ""} · panier moyen ${formatEuros(t.averageOrderCents)}`} />
        <Kpi label="Prix moyen d'une carte" value={formatEuros(t.averageCardCents)} hint="Prix de vente, hors port" />
        <Kpi label="Délai de vente" value={t.medianDaysToSell === null ? "—" : `${t.medianDaysToSell} j`}
          hint={t.sellThroughPercent === null ? "Délai médian depuis l'entrée en stock" : `Délai médian · ${Math.round(t.sellThroughPercent)} % du stock écoulé`} />
      </div>

      {notes.length > 0 && (
        <Card className="border-brand/30 bg-brand-soft/40">
          <CardContent className="grid gap-2">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"><Lightbulb className="size-4 text-brand" aria-hidden /> À retenir</h2>
            <ul className="grid gap-1.5 text-sm" data-testid="sales-takeaways">
              {notes.map((n) => <li key={n} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />{n}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Chiffre d'affaires par mois" description="Prix des cartes vendues, sur douze mois.">
          <MonthlyColumns
            label="Chiffre d'affaires par mois"
            format={compactEuros}
            data={data.months.map((m) => ({ key: m.month, month: m.month, value: m.revenueCents, details: [["Chiffre d'affaires", formatEuros(m.revenueCents)], ["Cartes", String(m.cards)]] }))}
          />
        </Panel>
        <Panel title="À quel prix ça part" description="Cartes vendues par tranche de prix de vente.">
          <HorizontalBars format={(n) => n.toLocaleString("fr-FR")}
            data={data.byPriceBand.map((b) => ({ key: b.key, label: b.label, value: b.cards, note: b.cards > 0 ? formatEuros(b.revenueCents) : undefined }))} />
        </Panel>
      </div>

      <Panel title="Séries qui se vendent" description="Cartes vendues sur la période, ce qu'il en reste, et la part écoulée.">
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="tabular w-full min-w-[30rem] text-left text-sm" data-testid="sales-by-set">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pl-4 font-medium sm:pl-0">Série</th>
                <th className="py-2 text-right font-medium">Vendues</th>
                <th className="py-2 text-right font-medium">CA</th>
                <th className="py-2 text-right font-medium">En stock</th>
                <th className="w-[30%] py-2 pr-4 pl-4 font-medium sm:pr-0">Écoulement</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.bySet.map((x) => (
                <tr key={x.key}>
                  <td className="max-w-[14rem] truncate py-2 pl-4 font-medium sm:pl-0">{x.label}</td>
                  <td className="py-2 text-right">{x.cards}</td>
                  <td className="py-2 text-right">{formatEuros(x.revenueCents)}</td>
                  <td className="py-2 text-right text-muted-foreground">{x.inStock}</td>
                  <td className="py-2 pr-4 pl-4 sm:pr-0">
                    <span className="flex items-center gap-2">
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <span className="block h-full rounded-full bg-chart-1" style={{ width: `${Math.min(x.sellThroughPercent, 100)}%` }} />
                      </span>
                      <span className="w-10 text-right text-xs font-medium">{Math.round(x.sellThroughPercent)} %</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Par état" description="Cartes vendues selon leur état.">
          <HorizontalBars format={(n) => n.toLocaleString("fr-FR")} data={data.byCondition.map((c) => ({ key: c.key, label: `${c.key} · ${c.label}`, value: c.cards, note: formatEuros(c.revenueCents) }))} />
        </Panel>
        <Panel title="Par rareté" description="Les raretés qui partent le plus.">
          <HorizontalBars format={(n) => n.toLocaleString("fr-FR")} data={data.byRarity.map((r) => ({ key: r.key || "none", label: r.label, value: r.cards, note: formatEuros(r.revenueCents) }))} />
        </Panel>
        <Panel title="Délai de vente" description="Temps entre l'entrée en stock et la vente.">
          <HorizontalBars format={(n) => n.toLocaleString("fr-FR")} data={data.daysToSell.map((d) => ({ key: d.key, label: d.label, value: d.cards, note: d.cards > 0 ? `${share(d.cards, t.cards)} %` : undefined }))} />
        </Panel>
        <Panel title="Jour de la semaine" description="Nombre de ventes enregistrées.">
          <HorizontalBars format={(n) => n.toLocaleString("fr-FR")} data={data.byWeekday.map((w) => ({ key: String(w.weekday), label: w.label.charAt(0).toUpperCase() + w.label.slice(1), value: w.orders }))} />
        </Panel>
        <Panel title="Par canal" description="Où se font les ventes.">
          <HorizontalBars format={formatEuros} data={data.byChannel.map((c) => ({ key: c.key, label: channelLabel(c.key), value: c.revenueCents, note: `${c.orders} vente${c.orders > 1 ? "s" : ""}` }))} />
        </Panel>
        <Panel title="Cartes les plus vendues" className="md:col-span-2 xl:col-span-1">
          <ol className="grid gap-2 text-sm" data-testid="sales-top-cards">
            {data.topCards.map((c, i) => (
              <li key={c.catalogCardId} className="flex items-baseline gap-3">
                <span className="tabular w-4 shrink-0 text-xs text-muted-foreground">{i + 1}</span>
                <span className="grid min-w-0 flex-1">
                  <Link href={`/carte/${c.catalogCardId}`} className="truncate font-medium underline-offset-2 hover:underline">{c.name}</Link>
                  <span className="truncate text-xs text-muted-foreground">{c.setName} · {c.cards > 1 ? `${cardsNote(c.cards)}, ${formatEuros(c.averageCents)} pièce en moyenne` : cardsNote(c.cards)}</span>
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
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [moves, setMoves] = useState<PriceMoves | null>(null);
  const [alertsOnly, setAlertsOnly] = useState(true);
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
          ? `${r.pricesInserted} nouvelle${r.pricesInserted > 1 ? "s" : ""} cote${r.pricesInserted > 1 ? "s" : ""} sur ${r.cards} carte${r.cards > 1 ? "s" : ""}`
          : `Cotes déjà à jour (${r.cards} carte${r.cards > 1 ? "s" : ""} vérifiée${r.cards > 1 ? "s" : ""})`,
      );
      if (r.errors > 0) setError(`${r.errors} carte${r.errors > 1 ? "s n'ont" : " n'a"} pas pu être relevée${r.errors > 1 ? "s" : ""} : la source des cotes n'a pas répondu.`);
      loadMoves();
      api.dashboard().then(setDashboard).catch(() => undefined);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "CATALOG_UNAVAILABLE" ? "La source des cotes ne répond pas. Réessayez plus tard." : (e as Error).message);
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
        <Tile label="Valeur du stock" value={<span data-testid="stat-value">{compactEuros(stock.marketValueCents)}</span>}>
          Au prix cible · coût {compactEuros(stock.costCents)}
        </Tile>
        <Tile label="Marge latente" value={compactEuros(latent)}>
          Ce que rapporterait le stock vendu à son prix, coût d'achat déduit
        </Tile>
        <Tile label="Cartes en stock" value={stock.cards.toLocaleString("fr-FR")}>
          {stock.sellable.toLocaleString("fr-FR")} vendables · {stock.reserved} réservée{stock.reserved > 1 ? "s" : ""}{stock.unpricedCards > 0 ? ` · ${stock.unpricedCards} sans prix` : ""}
        </Tile>
      </div>

      <Panel title="Valeur du stock par catégorie" description="Au prix cible, à défaut au prix suggéré.">
        <div className="grid gap-6 lg:grid-cols-2">
          {dashboard.byCategory.length > 0 ? (
            <HorizontalBars
              format={compactEuros}
              data={dashboard.byCategory.map((c) => ({ key: c.category, label: CATEGORY_LABEL[c.category as Category] ?? c.category, value: c.valueCents, note: `${c.cards} carte${c.cards > 1 ? "s" : ""}` }))}
            />
          ) : <p className="text-sm text-muted-foreground">Aucune carte identifiée en stock.</p>}
          {dashboard.topOffers.length > 0 && (
            <div className="grid content-start gap-2">
              <Eyebrow>Cartes les plus chères</Eyebrow>
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

      <section className="grid gap-3" aria-label="Variations de prix">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Variations de prix</h2>
            <p className="text-sm text-muted-foreground">
              Cote tendance Cardmarket des cartes en stock{moves?.latestQuoteAt ? `, dernier relevé le ${formatDateTime(moves.latestQuoteAt)}` : ""}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedTabs
              label="Variations de prix"
              value={alertsOnly ? "ALERTS" : "ALL"}
              onChange={(v) => setAlertsOnly(v === "ALERTS")}
              tabs={[{ value: "ALERTS", label: "Alertes", count: moves?.alerts }, { value: "ALL", label: "Toutes" }]}
            />
            <Button variant="outline" onClick={refreshPrices} disabled={refreshing}>{refreshing ? <Spinner /> : <RefreshCw />} Relever les cotes</Button>
          </div>
        </div>
        {moves && <AlertRules settings={moves.settings} onSaved={loadMoves} />}
        {!moves ? <ListSkeleton count={4} label="Chargement des variations" />
          : moves.moves.length === 0 ? (
            <EmptyState icon={alertsOnly ? <BellRing /> : <TrendingUp />} title={alertsOnly && moves.trackedVariants > 0 ? "Aucune alerte" : "Pas encore de variation à montrer"}>
              {moves.trackedVariants === 0
                ? `Une variation se mesure entre deux relevés espacés d'au moins ${moves.settings.windowDays} jour${moves.settings.windowDays > 1 ? "s" : ""}. Les cotes des cartes en stock sont relevées chaque jour : l'historique se construit tout seul.`
                : alertsOnly ? "Aucune carte en stock n'a bougé au-delà des seuils. L'onglet Toutes montre les variations plus faibles."
                : "Les cotes des cartes en stock n'ont pas bougé sur la période."}
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
          {move.alert && <Badge variant="warning"><BellRing /> Alerte</Badge>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {move.setName ?? move.setId} · n° {move.localNumber} · {variantLabel(move)} · {move.quantity} en stock
        </p>
      </div>
      <Sparkline
        values={move.series.map((p) => p.cents)}
        label={`Cote de ${move.cardName} sur 90 jours : de ${formatEuros(move.series[0]?.cents ?? move.previousCents)} à ${formatEuros(move.latestCents)}`}
        className="hidden sm:block"
      />
      <div className="tabular grid justify-items-end gap-0.5 text-sm sm:w-44">
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{formatEuros(move.previousCents)}</span>
          <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="font-semibold">{formatEuros(move.latestCents)}</span>
        </span>
        <span className="text-xs text-muted-foreground">du {day.format(new Date(move.previousAt))} au {day.format(new Date(move.latestAt))}</span>
      </div>
      <div className="grid w-24 justify-items-end gap-0.5">
        <Badge variant={up ? "success" : "destructive"} className="tabular">
          <Arrow /> {percent.format(move.deltaPercent)} %
        </Badge>
        <span className="tabular text-xs text-muted-foreground">{signed(move.deltaCents)}{move.quantity > 1 ? ` × ${move.quantity}` : ""}</span>
      </div>
      {move.targetPriceCents !== null && (
        <p className={cn("basis-full text-xs sm:w-48 sm:basis-auto sm:text-right", move.targetPriceCents < move.latestCents * 0.9 || move.targetPriceCents > move.latestCents * 1.25 ? "text-warning" : "text-muted-foreground")}>
          Votre prix : {formatEuros(move.targetPriceCents)} — <Link href="/prix" className="font-medium text-primary underline-offset-2 hover:underline">revoir</Link>
        </p>
      )}
    </div>
  );
}
