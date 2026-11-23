"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, BellRing, Check, RefreshCw, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CardThumb } from "@/components/card-chooser";
import { HorizontalBars, MonthlyColumns, Sparkline } from "@/components/charts";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Eyebrow } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/misc";
import { SegmentedTabs } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { formatDateTime, formatEuros, parseEuros, variantLabel } from "@/lib/format";
import { CATEGORY_LABEL, eurosInput, type Category } from "@/lib/pricing";
import type { AlertSettings, Dashboard, PriceMove, PriceMoves } from "@/lib/types";
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

export default function StatisticsPage() {
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
  const current = dashboard.months.at(-1)!;
  const latent = stock.marketValueCents - stock.costCents;
  const sold = dashboard.months.some((m) => m.orders > 0);

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Tableau de bord"
        description="La valeur du stock, les ventes, et les cartes dont la cote bouge."
        actions={<Button variant="outline" onClick={refreshPrices} disabled={refreshing}>{refreshing ? <Spinner /> : <RefreshCw />} Relever les cotes</Button>}
      />
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Valeur du stock" value={<span data-testid="stat-value">{compactEuros(stock.marketValueCents)}</span>}>
          Au prix cible · coût {compactEuros(stock.costCents)} · marge latente {compactEuros(latent)}
        </Tile>
        <Tile label="Cartes en stock" value={stock.cards.toLocaleString("fr-FR")}>
          {stock.sellable.toLocaleString("fr-FR")} vendables · {stock.reserved} réservée{stock.reserved > 1 ? "s" : ""}{stock.unpricedCards > 0 ? ` · ${stock.unpricedCards} sans prix` : ""}
        </Tile>
        <Tile label="Ventes du mois" value={<span data-testid="stat-month">{formatEuros(current.revenueCents)}</span>}>
          {current.orders} vente{current.orders > 1 ? "s" : ""} remise{current.orders > 1 ? "s" : ""} · marge {formatEuros(current.marginCents)}
        </Tile>
        <Tile label="À préparer" value={dashboard.openOrders} href="/ventes">
          Commande{dashboard.openOrders > 1 ? "s" : ""} en attente de préparation ou de remise
        </Tile>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardContent className="grid gap-4">
            <div className="grid gap-1">
              <h2 className="text-[15px] font-semibold tracking-tight">Chiffre d'affaires par mois</h2>
              <p className="text-sm text-muted-foreground">Ventes remises, port facturé compris, sur six mois.</p>
            </div>
            {sold ? (
              <>
                <MonthlyColumns
                  label="Chiffre d'affaires par mois"
                  format={compactEuros}
                  data={dashboard.months.map((m) => ({
                    key: m.month, month: m.month, value: m.revenueCents,
                    details: [["Chiffre d'affaires", formatEuros(m.revenueCents)], ["Marge", formatEuros(m.marginCents)], ["Ventes", String(m.orders)], ["Cartes", String(m.cards)]],
                  }))}
                />
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium text-muted-foreground outline-none select-none focus-visible:underline">Voir le tableau</summary>
                  <table className="tabular mt-2 w-full text-left">
                    <thead className="text-xs text-muted-foreground"><tr><th className="py-1 font-medium">Mois</th><th className="font-medium">Ventes</th><th className="font-medium">Cartes</th><th className="text-right font-medium">CA</th><th className="text-right font-medium">Marge</th></tr></thead>
                    <tbody className="divide-y">
                      {dashboard.months.map((m) => (
                        <tr key={m.month}><td className="py-1.5">{m.month}</td><td>{m.orders}</td><td>{m.cards}</td><td className="text-right">{formatEuros(m.revenueCents)}</td><td className="text-right">{formatEuros(m.marginCents)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </>
            ) : (
              <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">Aucune vente remise sur les six derniers mois.</p>
            )}
            {dashboard.byChannel.length > 0 && (
              <div className="grid gap-2 border-t pt-4">
                <Eyebrow>Par canal, 90 derniers jours</Eyebrow>
                <HorizontalBars
                  format={formatEuros}
                  data={dashboard.byChannel.map((c) => ({ key: c.channel, label: CHANNEL_LABEL[c.channel] ?? c.channel, value: c.revenueCents, note: `${c.orders} vente${c.orders > 1 ? "s" : ""}` }))}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4">
            <div className="grid gap-1">
              <h2 className="text-[15px] font-semibold tracking-tight">Valeur du stock par catégorie</h2>
              <p className="text-sm text-muted-foreground">Au prix cible, à défaut au prix suggéré.</p>
            </div>
            {dashboard.byCategory.length > 0 ? (
              <HorizontalBars
                format={compactEuros}
                data={dashboard.byCategory.map((c) => ({ key: c.category, label: CATEGORY_LABEL[c.category as Category] ?? c.category, value: c.valueCents, note: `${c.cards} carte${c.cards > 1 ? "s" : ""}` }))}
              />
            ) : <p className="text-sm text-muted-foreground">Aucune carte identifiée en stock.</p>}
            {dashboard.topOffers.length > 0 && (
              <div className="grid gap-2 border-t pt-4">
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
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-3" aria-label="Variations de prix">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Variations de prix</h2>
            <p className="text-sm text-muted-foreground">
              Cote tendance Cardmarket des cartes en stock{moves?.latestQuoteAt ? `, dernier relevé le ${formatDateTime(moves.latestQuoteAt)}` : ""}.
            </p>
          </div>
          <SegmentedTabs
            label="Variations de prix"
            value={alertsOnly ? "ALERTS" : "ALL"}
            onChange={(v) => setAlertsOnly(v === "ALERTS")}
            tabs={[{ value: "ALERTS", label: "Alertes", count: moves?.alerts }, { value: "ALL", label: "Toutes" }]}
          />
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

function AlertRules({ settings, onSaved }: { settings: AlertSettings; onSaved: () => void }) {
  const [windowDays, setWindowDays] = useState(String(settings.windowDays));
  const [threshold, setThreshold] = useState(String(settings.percent));
  const [minimum, setMinimum] = useState(eurosInput(settings.minChangeCents));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next: AlertSettings | null = (() => {
    const days = Number(windowDays), pct = Number(threshold.replace(",", ".")), min = parseEuros(minimum);
    return Number.isInteger(days) && days >= 1 && days <= 90 && pct >= 1 && pct <= 500 && min !== null ? { windowDays: days, percent: pct, minChangeCents: min } : null;
  })();
  const dirty = !next || next.windowDays !== settings.windowDays || next.percent !== settings.percent || next.minChangeCents !== settings.minChangeCents;

  async function save() {
    if (!next) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveAlertSettings(next);
      toast.success("Seuils d'alerte enregistrés");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[repeat(3,minmax(0,10rem))_auto]">
          <Field label="Comparer sur (jours)"><Input inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} className="tabular" /></Field>
          <Field label="Alerter à partir de (%)"><Input inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="tabular" /></Field>
          <Field label="Variation minimale (€)"><Input inputMode="decimal" value={minimum} onChange={(e) => setMinimum(e.target.value)} className="tabular" /></Field>
          <Button variant="outline" onClick={save} disabled={saving || !dirty || !next} className="col-span-2 justify-self-start sm:col-span-1">
            {saving ? <Spinner /> : <Check />} Enregistrer les seuils
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Une carte est signalée quand sa cote a bougé d'au moins ce pourcentage <em>et</em> de ce montant sur la période. De 1 à 90 jours, de 1 à 500 %.
        </p>
        {error && <Alert variant="destructive">{error}</Alert>}
      </CardContent>
    </Card>
  );
}
