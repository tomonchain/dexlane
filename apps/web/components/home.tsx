"use client";

import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { formatDateTime, formatEuros, variantLabel } from "@/lib/format";
import type { Activity, WatchedCard, OrderList, PriceMoves, ScanBatch, Schedule, StockPage } from "@/lib/types";
import { AddMenu } from "./add-menu";
import { CardThumb } from "./card-chooser";
import { DailyColumns } from "./charts";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Code, Page, PageHeader } from "./ui/misc";
import { HomeSkeleton } from "./skeletons";

interface Data {
  stock: StockPage;
  batches: ScanBatch[];
  schedule: Schedule;
  orders: OrderList;
  moves: PriceMoves | null;
  activity: Activity | null;
  watched: { items: WatchedCard[]; alerts: number } | null;
}

const CHANNEL_LABEL: Record<string, string> = { direct: "Vente directe", ebay: "eBay", cardtrader: "CardTrader" };
const SALE_STATUS: Record<string, string> = { PENDING: "À préparer", PACKED: "Emballée", SHIPPED: "Remise" };
const shortDay = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });
const wholeEuros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
/** Graduation en euros : sans centimes quand le montant est rond. */
const axisEuros = (cents: number) => (cents % 100 === 0 ? wholeEuros.format(cents / 100) : formatEuros(cents));

/** Un graphique de l'activité : ce qu'il mesure, son total sur la période, puis les colonnes jour par jour. */
function ChartCard({ label, value, hint, children }: { label: string; value: ReactNode; hint: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 bg-card px-4 py-4 sm:px-5">
      <div className="grid gap-1">
        <h3 className="text-xs text-muted-foreground">{label}</h3>
        <p className="text-xl leading-none font-semibold tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function Recent({ title, href, all, empty, children }: { title: string; href: string; all: string; empty: string; children: ReactNode[] }) {
  return (
    <section className="grid content-start gap-2" aria-label={title}>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
        <Link href={href} className="text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline">{all}</Link>
      </div>
      {children.length > 0
        ? <div className="divide-y overflow-hidden rounded-lg border bg-card">{children}</div>
        : <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{empty}</p>}
    </section>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const today = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("fr-FR")} ${n > 1 ? many : one}`;

/** Une chose à faire : ce qui attend, et le lien qui y mène. */
function Task({ count, label, hint, href, action }: { count: number; label: string; hint: string; href: string; action: string }) {
  return (
    <Link
      href={href}
      data-testid="home-task"
      className="group flex items-center gap-4 border-b px-4 py-3 outline-none transition-colors last:border-b-0 hover:bg-accent/60 focus-visible:bg-accent sm:px-5"
    >
      <span className="tabular w-10 text-right text-2xl leading-none font-semibold tracking-tight">{count.toLocaleString("fr-FR")}</span>
      <span className="grid min-w-0 flex-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="truncate text-[13px] text-muted-foreground">{hint}</span>
      </span>
      <span className="hidden items-center gap-1.5 text-[13px] font-medium text-muted-foreground group-hover:text-foreground sm:flex">
        {action} <ArrowRight className="size-3.5" aria-hidden />
      </span>
    </Link>
  );
}

function Figure({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1 bg-card px-4 py-3.5 sm:px-5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular text-xl leading-none font-semibold tracking-tight">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** Accueil de l'application : ce qui attend une action aujourd'hui, dans l'ordre du parcours, puis les chiffres du moment. */
export function Home() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.stock({ limit: 1 }),
      api.scanBatches(),
      api.schedule(),
      api.orders(),
      api.priceMoves(true).catch(() => null), // les alertes sont un plus : leur absence ne bloque pas l'accueil
      api.activity().catch(() => null), // de même pour l'activité récente
      api.watchlist().catch(() => null), // et pour les cartes suivies
    ])
      .then(([stock, batches, schedule, orders, moves, activity, watched]) => setData({ stock, batches: batches.batches, schedule, orders, moves, activity, watched }))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!data) {
    return error
      ? <p role="alert" className="text-sm text-destructive">{error}</p>
      : <HomeSkeleton />;
  }

  const { stock, schedule, orders, moves, activity } = data;
  // L'activité n'apparaît qu'une fois qu'il s'est passé quelque chose : une première vente ou une première annonce.
  const active = activity !== null && (activity.sales.length > 0 || activity.listings.length > 0);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const openBatches = data.batches.filter((b) => !b.receivedAt && b.counts.items > 0);
  const dueToday = schedule.days.filter((d) => d.plannedOn <= day).reduce((sum, d) => sum + d.count, 0);
  const unplanned = Math.max(stock.counts.READY - schedule.pending, 0);
  const empty = stock.counts.ALL === 0 && data.batches.length === 0;

  const tasks = [
    ...openBatches.map((b) => (
      <Task
        key={b.id}
        count={b.counts.toReview || b.counts.items}
        label={b.counts.toReview > 0 ? `${b.counts.toReview > 1 ? "cartes" : "carte"} à corriger dans « ${b.name} »` : `${b.counts.items > 1 ? "cartes prêtes" : "carte prête"} à entrer en stock, « ${b.name} »`}
        hint={`Boîte ${b.locationCode} · ${plural(b.counts.items, "carte scannée", "cartes scannées")}`}
        href={`/scanner/lot/${b.id}`}
        action={b.counts.toReview > 0 ? "Revoir le lot" : "Entrer en stock"}
      />
    )),
    stock.counts.DRAFT > 0 && <Task key="draft" count={stock.counts.DRAFT} label={stock.counts.DRAFT > 1 ? "brouillons à valider" : "brouillon à valider"} hint="En stock, mais pas encore vendables" href="/stock?statut=DRAFT" action="Valider" />,
    stock.counts.TO_PRICE > 0 && <Task key="price" count={stock.counts.TO_PRICE} label={stock.counts.TO_PRICE > 1 ? "cartes à tarifer" : "carte à tarifer"} hint="Sans prix : la cote manque ou demande une vérification" href="/stock?statut=TO_PRICE" action="Fixer les prix" />,
    unplanned > 0 && <Task key="plan" count={unplanned} label={unplanned > 1 ? "cartes prêtes, pas encore en ligne" : "carte prête, pas encore en ligne"} hint="Prix fixé, à publier ou à planifier" href="/mises-en-ligne" action="Planifier la mise en ligne" />,
    dueToday > 0 && <Task key="due" count={dueToday} label={dueToday > 1 ? "mises en ligne prévues aujourd'hui" : "mise en ligne prévue aujourd'hui"} hint="Publiées par la tâche du matin, ou tout de suite depuis le planning" href="/mises-en-ligne" action="Voir le planning" />,
    schedule.failed.length > 0 && <Task key="failed" count={schedule.failed.length} label={schedule.failed.length > 1 ? "mises en ligne en échec" : "mise en ligne en échec"} hint="Prix, photo ou stock manquant au moment de publier" href="/mises-en-ligne" action="Corriger" />,
    orders.counts.TO_PREPARE > 0 && <Task key="prepare" count={orders.counts.TO_PREPARE} label={orders.counts.TO_PREPARE > 1 ? "ventes à préparer" : "vente à préparer"} hint="Cartes réservées, à sortir de leur boîte" href="/ventes" action="Préparer" />,
    orders.counts.PACKED > 0 && <Task key="packed" count={orders.counts.PACKED} label={orders.counts.PACKED > 1 ? "colis à remettre" : "colis à remettre"} hint="Emballés, en attente de dépôt ou de remise" href="/ventes" action="Remettre" />,
    data.watched && data.watched.alerts > 0 && <Task key="watched" count={data.watched.alerts} label={data.watched.alerts > 1 ? "cartes suivies à regarder" : "carte suivie à regarder"} hint="Prix cible atteint ou variation au-delà de vos seuils" href="/achats" action="Voir les achats" />,
    moves && moves.alerts > 0 && <Task key="alerts" count={moves.alerts} label={moves.alerts > 1 ? "cartes dont la cote a bougé" : "carte dont la cote a bougé"} hint={`Au-delà de ${moves.settings.percent} % sur ${moves.settings.windowDays} jours`} href="/statistiques?vue=cotes" action="Voir les variations" />,
  ].filter(Boolean);

  return (
    <Page className="gap-6">
      <PageHeader title="Aujourd'hui" description={capitalize(today.format(new Date()))} actions={<AddMenu />} />

      <section className="grid gap-2" aria-label="À faire">
        <h2 className="px-1 text-xs font-medium text-muted-foreground">À faire</h2>
        {tasks.length > 0 ? (
          <div className="overflow-hidden rounded-lg border bg-card">{tasks}</div>
        ) : (
          <div className="rounded-lg border border-dashed px-5 py-8 text-center" data-testid="home-empty">
            <p className="text-sm font-medium">{empty ? "Votre stock est vide" : "Rien n'attend"}</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
              {empty ? "Scannez ou photographiez un premier lot : les cartes sont reconnues, tarifées, puis prêtes à mettre en ligne." : "Tout est tarifé, planifié et préparé. Ajoutez un lot pour continuer."}
            </p>
            <Button asChild className="mt-4"><Link href="/scanner/lot"><Plus /> Ajouter des cartes</Link></Button>
          </div>
        )}
      </section>

      {active && activity.sales.length > 0 && (
        <section className="grid gap-2" aria-label="Activité sur 30 jours" data-testid="home-activity">
          <h2 className="px-1 text-xs font-medium text-muted-foreground">Activité sur 30 jours</h2>
          <div className="grid gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-2">
            <ChartCard label="Chiffre d'affaires" value={<span data-testid="home-revenue">{formatEuros(activity.totals.grossCents)}</span>} hint="Ventes enregistrées, port facturé compris">
              <DailyColumns
                label={`Chiffre d'affaires par jour sur 30 jours, ${formatEuros(activity.totals.grossCents)} au total`}
                format={axisEuros}
                data={activity.days.map((d) => ({ day: d.day, value: d.grossCents, details: [["chiffre d'affaires", formatEuros(d.grossCents)], [d.orders > 1 ? "ventes" : "vente", String(d.orders)]] }))}
              />
            </ChartCard>
            <ChartCard label="Ventes" value={<span data-testid="home-orders">{activity.totals.orders.toLocaleString("fr-FR")}</span>} hint="Hors ventes annulées">
              <DailyColumns
                wholeNumbers
                label={`Nombre de ventes par jour sur 30 jours, ${activity.totals.orders} au total`}
                format={(n) => n.toLocaleString("fr-FR")}
                data={activity.days.map((d) => ({ day: d.day, value: d.orders, details: [[d.orders > 1 ? "ventes" : "vente", String(d.orders)], ["chiffre d'affaires", formatEuros(d.grossCents)]] }))}
              />
            </ChartCard>
          </div>
        </section>
      )}

      {active && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Recent title="Dernières ventes" href="/ventes" all="Toutes les ventes" empty="Aucune vente pour l'instant.">
            {activity.sales.map((sale) => (
              <Link key={sale.id} href={`/ventes/${sale.id}`} data-testid="home-sale" className="flex items-center gap-3 px-4 py-2.5 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent">
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <Code className="text-[13px] font-semibold">{sale.externalId}</Code>
                    <span className="truncate text-sm">{sale.cardNames.join(", ")}{sale.cards > sale.cardNames.length ? "…" : ""}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[sale.channel === "direct" ? null : CHANNEL_LABEL[sale.channel] ?? sale.channel, sale.buyerName, formatDateTime(sale.orderedAt), SALE_STATUS[sale.fulfillmentStatus] ?? sale.fulfillmentStatus].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="tabular text-sm font-semibold">{formatEuros(sale.grossCents)}</span>
              </Link>
            ))}
          </Recent>
          <Recent title="Dernières mises en ligne" href="/stock?statut=LISTED" all="Tout ce qui est en ligne" empty="Aucune annonce en ligne pour l'instant.">
            {activity.listings.map((listing) => (
              <Link key={listing.id} href={`/carte/${listing.catalogCardId}`} data-testid="home-listing" className="flex items-center gap-3 px-4 py-2.5 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent">
                <CardThumb imageUrl={listing.imageUrl} size="sm" className="w-7 rounded-[3px]" />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm font-medium">{listing.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {shortDay.format(new Date(listing.listedAt))} · {listing.setName ?? listing.setId} · {listing.localNumber} · {variantLabel({ finish: listing.finish, edition: listing.edition, stamp: "", subtype: "" })} · {listing.condition}
                  </span>
                </span>
                <Badge variant="outline">{CHANNEL_LABEL[listing.channel] ?? listing.channel}{listing.simulated ? " · simulé" : ""}</Badge>
                <span className="tabular text-sm font-semibold">{formatEuros(listing.priceCents)}</span>
              </Link>
            ))}
          </Recent>
        </div>
      )}

      <section className="grid gap-2" aria-label="En bref">
        <h2 className="px-1 text-xs font-medium text-muted-foreground">En bref</h2>
        <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
          <Figure label="Valeur du stock" value={<span data-testid="home-value">{formatEuros(stock.totals.valueCents)}</span>} hint={plural(stock.totals.cards, "carte", "cartes")} />
          <Figure label="En ligne" value={stock.counts.LISTED} hint={`${plural(schedule.pending, "planifiée", "planifiées")}`} />
          <Figure label="Marge sur 30 jours" value={formatEuros(orders.last30Days.marginCents)} hint={`${plural(orders.last30Days.orders, "vente remise", "ventes remises")}, après cartes, port et fournitures`} />
        </dl>
        <Link href="/statistiques" className="flex items-center gap-1 justify-self-start px-1 text-[13px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:underline">
          Tableau de bord complet <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </section>
    </Page>
  );
}
