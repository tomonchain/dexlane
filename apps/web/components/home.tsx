"use client";

import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { dateFormat, formatDateTime, formatEuros, formatNumber, variantLabel } from "@/lib/format";
import { intlLocale, t, tn } from "@/lib/i18n";
import type { Activity, WatchedCard, OrderList, PriceMoves, ScanBatch, Schedule, StockPage } from "@/lib/types";
import { AddMenu } from "./add-menu";
import { CardThumb } from "./card-chooser";
import { DailyColumns } from "./charts";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Code, Page, PageHeader } from "./ui/misc";
import { HomeSkeleton } from "./skeletons";
import { useCachedState } from "@/lib/cache";

interface Data {
  stock: StockPage;
  batches: ScanBatch[];
  schedule: Schedule;
  orders: OrderList;
  moves: PriceMoves | null;
  activity: Activity | null;
  watched: { items: WatchedCard[]; alerts: number } | null;
  supplies: { toReorder: number; names: string[] } | null;
}

const CHANNEL_LABEL: Record<string, string> = { direct: "Vente directe", ebay: "eBay", cardtrader: "CardTrader" };
const SALE_STATUS: Record<string, string> = { PENDING: "À préparer", PACKED: "Emballée", SHIPPED: "Remise" };
const shortDay = () => dateFormat({ day: "numeric", month: "short", timeZone: "Europe/Paris" });
const wholeEuros = () => new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
/** Graduation en euros : sans centimes quand le montant est rond. */
const axisEuros = (cents: number) => (cents % 100 === 0 ? wholeEuros().format(cents / 100) : formatEuros(cents));

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
const today = () => dateFormat({ weekday: "long", day: "numeric", month: "long" });

/** Une chose à faire : ce qui attend, et le lien qui y mène. */
function Task({ count, label, hint, href, action }: { count: number; label: string; hint: string; href: string; action: string }) {
  return (
    <Link
      href={href}
      data-testid="home-task"
      className="group flex items-center gap-4 border-b px-4 py-3 outline-none transition-colors last:border-b-0 hover:bg-accent/60 focus-visible:bg-accent sm:px-5"
    >
      <span className="tabular w-10 text-right text-2xl leading-none font-semibold tracking-tight">{formatNumber(count)}</span>
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
  const [data, setData] = useCachedState<Data>("home");
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
      api.supplies().catch(() => null), // et pour les fournitures
    ])
      .then(([stock, batches, schedule, orders, moves, activity, watched, supplies]) => setData({
        stock, batches: batches.batches, schedule, orders, moves, activity, watched,
        supplies: supplies && { toReorder: supplies.toReorder, names: supplies.supplies.filter((x) => x.status !== "OK" && !x.orderedAt).map((x) => x.name) },
      }))
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
        label={b.counts.toReview > 0
          ? tn(b.counts.toReview, "carte à corriger dans « {name} »", "cartes à corriger dans « {name} »", { name: b.name })
          : tn(b.counts.items, "carte prête à entrer en stock, « {name} »", "cartes prêtes à entrer en stock, « {name} »", { name: b.name })}
        hint={t("Boîte {code} · {count}", { code: b.locationCode, count: tn(b.counts.items, "{n} carte scannée", "{n} cartes scannées") })}
        href={`/scanner/lot/${b.id}`}
        action={b.counts.toReview > 0 ? t("Revoir le lot") : t("Entrer en stock")}
      />
    )),
    stock.counts.DRAFT > 0 && <Task key="draft" count={stock.counts.DRAFT} label={tn(stock.counts.DRAFT, "brouillon à valider", "brouillons à valider")} hint={t("En stock, mais pas encore vendables")} href="/stock?statut=DRAFT" action={t("Valider")} />,
    stock.counts.TO_PRICE > 0 && <Task key="price" count={stock.counts.TO_PRICE} label={tn(stock.counts.TO_PRICE, "carte à tarifer", "cartes à tarifer")} hint={t("Sans prix : la cote manque ou demande une vérification")} href="/stock?statut=TO_PRICE" action={t("Fixer les prix")} />,
    unplanned > 0 && <Task key="plan" count={unplanned} label={tn(unplanned, "carte prête, pas encore en ligne", "cartes prêtes, pas encore en ligne")} hint={t("Prix fixé, à publier ou à planifier")} href="/mises-en-ligne" action={t("Planifier la mise en ligne")} />,
    dueToday > 0 && <Task key="due" count={dueToday} label={tn(dueToday, "mise en ligne prévue aujourd'hui", "mises en ligne prévues aujourd'hui")} hint={t("Publiées par la tâche du matin, ou tout de suite depuis le planning")} href="/mises-en-ligne" action={t("Voir le planning")} />,
    schedule.failed.length > 0 && <Task key="failed" count={schedule.failed.length} label={tn(schedule.failed.length, "mise en ligne en échec", "mises en ligne en échec")} hint={t("Prix, photo ou stock manquant au moment de publier")} href="/mises-en-ligne" action={t("Corriger")} />,
    orders.counts.TO_PREPARE > 0 && <Task key="prepare" count={orders.counts.TO_PREPARE} label={tn(orders.counts.TO_PREPARE, "vente à préparer", "ventes à préparer")} hint={t("Cartes réservées, à sortir de leur boîte")} href="/ventes" action={t("Préparer")} />,
    orders.counts.PACKED > 0 && <Task key="packed" count={orders.counts.PACKED} label={t("colis à remettre")} hint={t("Emballés, en attente de dépôt ou de remise")} href="/ventes" action={t("Remettre")} />,
    data.watched && data.watched.alerts > 0 && <Task key="watched" count={data.watched.alerts} label={tn(data.watched.alerts, "carte suivie à regarder", "cartes suivies à regarder")} hint={t("Prix cible atteint ou variation au-delà de vos seuils")} href="/achats" action={t("Voir les achats")} />,
    data.supplies && data.supplies.toReorder > 0 && <Task key="supplies" count={data.supplies.toReorder} label={tn(data.supplies.toReorder, "fourniture à commander", "fournitures à commander")} hint={data.supplies.names.join(", ")} href="/stock?categorie=fournitures" action={t("Voir les fournitures")} />,
    moves && moves.alerts > 0 && <Task key="alerts" count={moves.alerts} label={tn(moves.alerts, "carte dont la cote a bougé", "cartes dont la cote a bougé")} hint={t("Au-delà de {percent} % sur {days} jours", { percent: moves.settings.percent, days: moves.settings.windowDays })} href="/statistiques?vue=cotes" action={t("Voir les variations")} />,
  ].filter(Boolean);

  return (
    <Page className="gap-6">
      <PageHeader title={t("Aujourd'hui")} description={capitalize(today().format(new Date()))} actions={<AddMenu />} />

      <section className="grid gap-2" aria-label={t("À faire")}>
        <h2 className="px-1 text-xs font-medium text-muted-foreground">{t("À faire")}</h2>
        {tasks.length > 0 ? (
          <div className="overflow-hidden rounded-lg border bg-card">{tasks}</div>
        ) : (
          <div className="rounded-lg border border-dashed px-5 py-8 text-center" data-testid="home-empty">
            <p className="text-sm font-medium">{empty ? t("Votre stock est vide") : t("Rien n'attend")}</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
              {empty ? t("Scannez ou photographiez un premier lot : les cartes sont reconnues, tarifées, puis prêtes à mettre en ligne.") : t("Tout est tarifé, planifié et préparé. Ajoutez un lot pour continuer.")}
            </p>
            <Button asChild className="mt-4"><Link href="/scanner/lot"><Plus /> {t("Ajouter des cartes")}</Link></Button>
          </div>
        )}
      </section>

      {active && activity.sales.length > 0 && (
        <section className="grid gap-2" aria-label={t("Activité sur 30 jours")} data-testid="home-activity">
          <h2 className="px-1 text-xs font-medium text-muted-foreground">{t("Activité sur 30 jours")}</h2>
          <div className="grid gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-2">
            <ChartCard label={t("Chiffre d'affaires")} value={<span data-testid="home-revenue">{formatEuros(activity.totals.grossCents)}</span>} hint={t("Ventes enregistrées, port facturé compris")}>
              <DailyColumns
                label={t("Chiffre d'affaires par jour sur 30 jours, {total} au total", { total: formatEuros(activity.totals.grossCents) })}
                format={axisEuros}
                data={activity.days.map((d) => ({ day: d.day, value: d.grossCents, details: [[t("chiffre d'affaires"), formatEuros(d.grossCents)], [tn(d.orders, "vente", "ventes"), String(d.orders)]] }))}
              />
            </ChartCard>
            <ChartCard label={t("Ventes")} value={<span data-testid="home-orders">{formatNumber(activity.totals.orders)}</span>} hint={t("Hors ventes annulées")}>
              <DailyColumns
                wholeNumbers
                label={t("Nombre de ventes par jour sur 30 jours, {total} au total", { total: activity.totals.orders })}
                format={(n) => formatNumber(n)}
                data={activity.days.map((d) => ({ day: d.day, value: d.orders, details: [[tn(d.orders, "vente", "ventes"), String(d.orders)], [t("chiffre d'affaires"), formatEuros(d.grossCents)]] }))}
              />
            </ChartCard>
          </div>
        </section>
      )}

      {active && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Recent title={t("Dernières ventes")} href="/ventes" all={t("Toutes les ventes")} empty={t("Aucune vente pour l'instant.")}>
            {activity.sales.map((sale) => (
              <Link key={sale.id} href={`/ventes/${sale.id}`} data-testid="home-sale" className="flex items-center gap-3 px-4 py-2.5 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent">
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <Code className="text-[13px] font-semibold">{sale.externalId}</Code>
                    <span className="truncate text-sm">{sale.cardNames.join(", ")}{sale.cards > sale.cardNames.length ? "…" : ""}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[sale.channel === "direct" ? null : CHANNEL_LABEL[sale.channel] ? t(CHANNEL_LABEL[sale.channel]!) : sale.channel, sale.buyerName, formatDateTime(sale.orderedAt), SALE_STATUS[sale.fulfillmentStatus] ? t(SALE_STATUS[sale.fulfillmentStatus]!) : sale.fulfillmentStatus].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="tabular text-sm font-semibold">{formatEuros(sale.grossCents)}</span>
              </Link>
            ))}
          </Recent>
          <Recent title={t("Dernières mises en ligne")} href="/stock?statut=LISTED" all={t("Tout ce qui est en ligne")} empty={t("Aucune annonce en ligne pour l'instant.")}>
            {activity.listings.map((listing) => (
              <Link key={listing.id} href={`/carte/${listing.catalogCardId}`} data-testid="home-listing" className="flex items-center gap-3 px-4 py-2.5 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent">
                <CardThumb imageUrl={listing.imageUrl} size="sm" className="w-7 rounded-[3px]" />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm font-medium">{listing.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {shortDay().format(new Date(listing.listedAt))} · {listing.setName ?? listing.setId} · {listing.localNumber} · {variantLabel({ finish: listing.finish, edition: listing.edition, stamp: "", subtype: "" })} · {listing.condition}
                  </span>
                </span>
                <Badge variant="outline">{CHANNEL_LABEL[listing.channel] ? t(CHANNEL_LABEL[listing.channel]!) : listing.channel}{listing.simulated ? ` · ${t("simulé")}` : ""}</Badge>
                <span className="tabular text-sm font-semibold">{formatEuros(listing.priceCents)}</span>
              </Link>
            ))}
          </Recent>
        </div>
      )}

      <section className="grid gap-2" aria-label={t("En bref")}>
        <h2 className="px-1 text-xs font-medium text-muted-foreground">{t("En bref")}</h2>
        <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
          <Figure label={t("Valeur du stock")} value={<span data-testid="home-value">{formatEuros(stock.totals.valueCents)}</span>} hint={tn(stock.totals.cards, "{n} carte", "{n} cartes")} />
          <Figure label={t("En ligne")} value={stock.counts.LISTED} hint={tn(schedule.pending, "{n} planifiée", "{n} planifiées")} />
          <Figure label={t("Marge sur 30 jours")} value={formatEuros(orders.last30Days.marginCents)} hint={t("{sales}, après cartes, port et fournitures", { sales: tn(orders.last30Days.orders, "{n} vente remise", "{n} ventes remises") })} />
        </dl>
        <Link href="/statistiques" className="flex items-center gap-1 justify-self-start px-1 text-[13px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:underline">
          {t("Toutes les statistiques")} <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </section>
    </Page>
  );
}
