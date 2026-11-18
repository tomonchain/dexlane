"use client";

import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { formatEuros } from "@/lib/format";
import type { OrderList, PriceMoves, ScanBatch, Schedule, StockPage } from "@/lib/types";
import { Button } from "./ui/button";
import { Spinner } from "./ui/misc";

interface Data {
  stock: StockPage;
  batches: ScanBatch[];
  schedule: Schedule;
  orders: OrderList;
  moves: PriceMoves | null;
}

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
    ])
      .then(([stock, batches, schedule, orders, moves]) => setData({ stock, batches: batches.batches, schedule, orders, moves }))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!data) {
    return error
      ? <p role="alert" className="text-sm text-destructive">{error}</p>
      : <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner /> Chargement…</p>;
  }

  const { stock, schedule, orders, moves } = data;
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
    unplanned > 0 && <Task key="plan" count={unplanned} label={unplanned > 1 ? "cartes prêtes, pas encore en ligne" : "carte prête, pas encore en ligne"} hint="Prix fixé, à publier ou à planifier" href="/stock?statut=READY" action="Planifier la mise en ligne" />,
    dueToday > 0 && <Task key="due" count={dueToday} label={dueToday > 1 ? "mises en ligne prévues aujourd'hui" : "mise en ligne prévue aujourd'hui"} hint="Publiées par la tâche du matin, ou tout de suite depuis le planning" href="/stock" action="Voir le planning" />,
    schedule.failed.length > 0 && <Task key="failed" count={schedule.failed.length} label={schedule.failed.length > 1 ? "mises en ligne en échec" : "mise en ligne en échec"} hint="Prix, photo ou stock manquant au moment de publier" href="/stock" action="Corriger" />,
    orders.counts.TO_PREPARE > 0 && <Task key="prepare" count={orders.counts.TO_PREPARE} label={orders.counts.TO_PREPARE > 1 ? "ventes à préparer" : "vente à préparer"} hint="Cartes réservées, à sortir de leur boîte" href="/ventes" action="Préparer" />,
    orders.counts.PACKED > 0 && <Task key="packed" count={orders.counts.PACKED} label={orders.counts.PACKED > 1 ? "colis à remettre" : "colis à remettre"} hint="Emballés, en attente de dépôt ou de remise" href="/ventes" action="Remettre" />,
    moves && moves.alerts > 0 && <Task key="alerts" count={moves.alerts} label={moves.alerts > 1 ? "cartes dont la cote a bougé" : "carte dont la cote a bougé"} hint={`Au-delà de ${moves.settings.percent} % sur ${moves.settings.windowDays} jours`} href="/statistiques" action="Voir les variations" />,
  ].filter(Boolean);

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Aujourd'hui</h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{today.format(new Date())}</p>
      </div>

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

      <section className="grid gap-2" aria-label="En bref">
        <h2 className="px-1 text-xs font-medium text-muted-foreground">En bref</h2>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4">
          <Figure label="Valeur du stock" value={<span data-testid="home-value">{formatEuros(stock.totals.valueCents)}</span>} hint={plural(stock.totals.cards, "carte", "cartes")} />
          <Figure label="En ligne" value={stock.counts.LISTED} hint={`${plural(schedule.pending, "planifiée", "planifiées")}`} />
          <Figure label="Ventes sur 30 jours" value={formatEuros(orders.last30Days.grossCents)} hint={plural(orders.last30Days.orders, "vente remise", "ventes remises")} />
          <Figure label="Marge sur 30 jours" value={formatEuros(orders.last30Days.marginCents)} hint="Après coût des cartes et port" />
        </dl>
        <Link href="/statistiques" className="justify-self-start px-1 text-[13px] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline">
          Tableau de bord complet
        </Link>
      </section>
    </div>
  );
}
