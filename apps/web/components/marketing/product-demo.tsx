import {
  BarChart3, Boxes, CalendarClock, History, Home, Layers, LayoutGrid, Plus, Receipt, Search, Settings, ShoppingBasket,
  Signal, SlidersHorizontal, Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RealCard } from "./ui";

/**
 * Démonstration de l'écran Stock pour le site marketing, en HTML et avec des données fictives, et de vraies vignettes
 * de cartes du set 151.
 */

type Status = "listed" | "planned" | "ready";
const ROWS: { name: string; number: string; finish: string; condition: string; price: string; status: Status; }[] = [
  { name: "Dracaufeu-ex", number: "006", finish: "Holo", condition: "NM", price: "64,90 €", status: "listed" },
  { name: "Mew-ex", number: "151", finish: "Holo", condition: "NM", price: "22,90 €", status: "listed" },
  { name: "Pikachu", number: "025", finish: "Reverse", condition: "NM", price: "5,90 €", status: "listed" },
  { name: "Mewtwo-ex", number: "150", finish: "Holo", condition: "EX", price: "14,50 €", status: "listed" },
  { name: "Ectoplasma", number: "094", finish: "Reverse", condition: "NM", price: "3,40 €", status: "listed" },
  { name: "Évoli", number: "133", finish: "Reverse", condition: "NM", price: "2,90 €", status: "planned" },
  { name: "Ronflex", number: "143", finish: "Normale", condition: "EX", price: "1,80 €", status: "planned" },
  { name: "Dracolosse", number: "149", finish: "Reverse", condition: "GD", price: "2,20 €", status: "ready" },
  { name: "Salamèche", number: "004", finish: "Normale", condition: "NM", price: "1,20 €", status: "ready" },
];
const STATUS: Record<Status, { label: string; dot: string }> = {
  listed: { label: "En ligne sur eBay", dot: "bg-success" },
  planned: { label: "Planifiée jeu. 26 nov", dot: "bg-brand" },
  ready: { label: "Prête", dot: "bg-foreground/30" },
};
const NAV = [
  { icon: Home, label: "Accueil" },
  { icon: Layers, label: "Stock", active: true },
  { icon: CalendarClock, label: "Mises en ligne" },
  { icon: ShoppingBasket, label: "Achats" },
  { icon: Receipt, label: "Ventes" },
  { icon: BarChart3, label: "Statistiques" },
  { icon: Settings, label: "Réglages" },
];
const COUNTS = [["Tout", "9"], ["À tarifer", "0"], ["Prêtes", "4"], ["En ligne", "5"], ["Brouillons", "0"]] as const;

/** Version ordinateur : barre latérale, en-tête, filtres et tableau. */
export function StockDemoDesktop() {
  return (
    <div className="grid grid-cols-[11rem_minmax(0,1fr)] bg-background text-[11px] leading-tight text-foreground select-none">
      <aside className="grid content-start gap-3 border-r bg-sidebar p-3">
        <span className="flex items-center gap-1.5 px-1 pt-0.5 text-[13px] font-semibold tracking-tight">
          <span aria-hidden className="relative flex size-4 items-center justify-center">
            <span className="absolute h-3 w-[9px] -translate-x-[2px] -rotate-12 rounded-[2px] bg-foreground/15" />
            <span className="absolute h-3 w-[9px] translate-x-[1px] rotate-6 rounded-[2px] bg-brand" />
          </span>
          dexlane
        </span>
        <span className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground"><Search className="size-3.5" aria-hidden />Rechercher</span>
        <ul className="grid gap-0.5">
          {NAV.map(({ icon: Icon, label, active }) => (
            <li key={label} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5", active ? "bg-accent font-medium" : "text-muted-foreground")}>
              <Icon className="size-3.5" aria-hidden />{label}
            </li>
          ))}
        </ul>
      </aside>
      <div className="grid content-start gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-0.5">
            <span className="text-[17px] font-semibold tracking-tight">Stock</span>
            <span className="text-muted-foreground">9 cartes · 119,70 €</span>
          </div>
          <div className="flex gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-card px-2 py-1.5 shadow-[0_0_0_1px_var(--border)]"><CalendarClock className="size-3" aria-hidden />Mises en ligne <span className="rounded bg-muted px-1">2</span></span>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-primary-foreground"><Plus className="size-3" aria-hidden />Ajouter des cartes</span>
          </div>
        </div>
        <div className="flex gap-4 border-b">
          {[[Layers, "Cartes"], [Boxes, "Fournitures"], [History, "Mouvements"]].map(([Icon, label], i) => {
            const I = Icon as typeof Layers;
            return (
              <span key={label as string} className={cn("flex items-center gap-1.5 pb-2", i === 0 ? "border-b-2 border-foreground font-medium" : "text-muted-foreground")}>
                <I className="size-3" aria-hidden />{label as string}
              </span>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex rounded-md bg-muted/70 p-0.5">
            {COUNTS.map(([label, n], i) => (
              <span key={label} className={cn("flex items-center gap-1 rounded px-2 py-1", i === 0 ? "bg-card shadow-xs" : "text-muted-foreground")}>
                {label}<span className={cn("rounded px-1", i === 0 ? "bg-brand-soft text-primary" : "")}>{n}</span>
              </span>
            ))}
          </span>
          <span className="flex min-w-32 flex-1 items-center gap-1.5 rounded-md bg-card px-2 py-1.5 text-muted-foreground shadow-[0_0_0_1px_var(--border)]"><Search className="size-3" aria-hidden />Nom, série, numéro ou référence</span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-card px-2 py-1.5 shadow-[0_0_0_1px_var(--border)]"><SlidersHorizontal className="size-3" aria-hidden />Filtres</span>
        </div>
        <div className="overflow-hidden rounded-lg bg-card shadow-[0_0_0_1px_var(--border)]">
          <div className="grid grid-cols-[minmax(0,2.4fr)_minmax(0,0.9fr)_minmax(0,0.6fr)_minmax(0,0.9fr)_minmax(0,1.5fr)] gap-3 border-b bg-muted/50 px-3 py-2 text-muted-foreground">
            <span>Carte</span><span>Extension</span><span>État</span><span className="text-right">Prix</span><span>Statut</span>
          </div>
          {ROWS.map((row) => (
            <div key={row.name} className="grid grid-cols-[minmax(0,2.4fr)_minmax(0,0.9fr)_minmax(0,0.6fr)_minmax(0,0.9fr)_minmax(0,1.5fr)] items-center gap-3 border-b px-3 py-1.5 last:border-b-0">
              <span className="flex min-w-0 items-center gap-2">
                <RealCard n={row.number} sizes="48px" className="w-6 shrink-0 shadow-[0_0_0_1px_rgb(0_0_0/0.08)]" />
                <span className="grid min-w-0">
                  <span className="truncate text-[12px] font-medium">{row.name}</span>
                  <span className="truncate text-muted-foreground">151 · {row.number} · {row.finish}</span>
                </span>
              </span>
              <span className="font-mono">EV03.5</span>
              <span className="font-mono">{row.condition}</span>
              <span className="text-right font-medium tabular-nums">{row.price}</span>
              <span className="flex min-w-0 items-center gap-1.5"><span className={cn("size-1.5 shrink-0 rounded-full", STATUS[row.status].dot)} /><span className="truncate">{STATUS[row.status].label}</span></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ——— Téléphone ——— */

const PHONE_TABS = [
  { icon: Home, label: "Accueil" },
  { icon: Layers, label: "Stock", active: true },
  { icon: CalendarClock, label: "Mises en ligne" },
  { icon: Receipt, label: "Ventes" },
  { icon: LayoutGrid, label: "Plus" },
];
const PHONE_STATS = [
  { value: "5", label: "En ligne", dot: "bg-success" },
  { value: "2", label: "Planifiées", dot: "bg-brand" },
  { value: "2", label: "Prêtes", dot: "bg-foreground/30" },
];

/**
 * Téléphone de démonstration : cadre sombre, boutons latéraux, barre d'état et îlot, puis l'écran Stock avec sa barre
 * d'onglets flottante. Tout est dimensionné d'après la largeur du téléphone (unités cqw et em) : le rendu est le même
 * quelle que soit sa taille.
 */
export function PhoneDemo({ className }: { className?: string }) {
  return (
    <div className={cn("relative [container-type:inline-size]", className)}>
      {/* Boutons latéraux */}
      <span className="absolute top-[17%] -left-[0.9cqw] h-[4.5%] w-[1.4cqw] rounded-l-[1cqw] bg-[#2b2927]" />
      <span className="absolute top-[25%] -left-[0.9cqw] h-[8%] w-[1.4cqw] rounded-l-[1cqw] bg-[#2b2927]" />
      <span className="absolute top-[35%] -left-[0.9cqw] h-[8%] w-[1.4cqw] rounded-l-[1cqw] bg-[#2b2927]" />
      <span className="absolute top-[29%] -right-[0.9cqw] h-[12%] w-[1.4cqw] rounded-r-[1cqw] bg-[#2b2927]" />
      {/* Cadre */}
      <div className="relative rounded-[16cqw] bg-[linear-gradient(145deg,#5a5653_0%,#1c1b1a_28%,#141312_60%,#3d3a38_100%)] p-[1.1cqw] ring-1 ring-white/10 shadow-[0_0_0_1px_rgb(0_0_0/0.35),0_2cqw_3cqw_-1cqw_rgb(0_0_0/0.35),0_14cqw_22cqw_-8cqw_rgb(0_0_0/0.5)]">
        <div className="rounded-[15cqw] bg-black p-[2.3cqw]">
          {/* Écran */}
          <div className="relative flex aspect-[9/19.4] flex-col overflow-hidden rounded-[12.6cqw] bg-background text-[3.55cqw] leading-tight text-foreground select-none">
            {/* Barre d'état */}
            <div className="relative flex shrink-0 items-center justify-between px-[2.2em] pt-[1.25em] pb-[0.7em]">
              <span className="text-[1.08em] font-semibold tracking-tight">9:41</span>
              <span className="absolute top-[0.85em] left-1/2 h-[1.95em] w-[30%] -translate-x-1/2 rounded-full bg-black" />
              <span className="flex items-center gap-[0.35em]">
                <Signal className="size-[1.15em]" strokeWidth={2.6} />
                <Wifi className="size-[1.15em]" strokeWidth={2.6} />
                <span className="relative flex h-[0.85em] w-[1.75em] items-center rounded-[0.26em] border border-foreground/50 p-[1px]">
                  <span className="h-full w-[78%] rounded-[0.16em] bg-foreground" />
                  <span className="absolute top-1/2 -right-[0.22em] h-[0.34em] w-[0.12em] -translate-y-1/2 rounded-r-full bg-foreground/50" />
                </span>
              </span>
            </div>

            {/* En-tête de l'écran Stock */}
            <div className="flex shrink-0 items-start justify-between px-[1.4em] pt-[0.9em]">
              <span className="grid gap-[0.2em]">
                <span className="text-[2em] leading-none font-semibold tracking-[-0.03em]">Stock</span>
                <span className="text-muted-foreground">9 cartes · 119,70 €</span>
              </span>
              <span className="flex gap-[0.5em]">
                <span className="flex size-[2.6em] items-center justify-center rounded-full bg-card shadow-[0_0_0_1px_var(--border)]"><Search className="size-[1.15em]" /></span>
                <span className="flex size-[2.6em] items-center justify-center rounded-full bg-primary text-primary-foreground"><Plus className="size-[1.25em]" /></span>
              </span>
            </div>

            {/* Résumé */}
            <div className="mx-[1.4em] mt-[1.1em] grid shrink-0 grid-cols-3 divide-x overflow-hidden rounded-[1em] bg-card shadow-[0_0_0_1px_var(--border)]">
              {PHONE_STATS.map((stat) => (
                <span key={stat.label} className="grid gap-[0.3em] px-[0.9em] py-[0.8em]">
                  <span className="text-[1.5em] leading-none font-semibold tracking-[-0.02em] tabular-nums">{stat.value}</span>
                  <span className="flex items-center gap-[0.4em] text-[0.88em] text-muted-foreground"><span className={cn("size-[0.55em] rounded-full", stat.dot)} />{stat.label}</span>
                </span>
              ))}
            </div>

            {/* Liste des cartes : elle file sous la barre d'onglets. */}
            <div className="mx-[1.4em] mt-[1em] min-h-0 flex-1 overflow-hidden rounded-t-[1em] bg-card shadow-[0_0_0_1px_var(--border)]">
              {ROWS.map((row) => (
                <div key={row.name} className="flex items-center gap-[0.9em] border-b px-[0.9em] py-[0.7em]">
                  <RealCard n={row.number} sizes="64px" className="w-[2.9em] shrink-0 shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_0.3em_0.6em_-0.3em_rgb(0_0_0/0.4)]" />
                  <span className="grid min-w-0 flex-1 gap-[0.3em]">
                    <span className="truncate text-[1.12em] font-medium tracking-[-0.01em]">{row.name}</span>
                    <span className="flex min-w-0 items-center gap-[0.4em] text-[0.9em] text-muted-foreground">
                      <span className={cn("size-[0.55em] shrink-0 rounded-full", STATUS[row.status].dot)} />
                      <span className="truncate">{STATUS[row.status].label}</span>
                    </span>
                  </span>
                  <span className="grid justify-items-end gap-[0.3em]">
                    <span className="text-[1.08em] font-semibold tabular-nums">{row.price}</span>
                    <span className="rounded-[0.35em] bg-muted px-[0.45em] py-[0.1em] font-mono text-[0.8em] text-muted-foreground">{row.condition}</span>
                  </span>
                </div>
              ))}
            </div>

            {/* Barre d'onglets flottante et repère du bas */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[22%] bg-[linear-gradient(to_top,var(--background)_38%,transparent)]" />
            <div className="absolute inset-x-[1em] bottom-[2em] flex items-center justify-between rounded-full bg-card/95 px-[0.5em] py-[0.45em] shadow-[0_0_0_1px_var(--border),0_1em_2em_-0.8em_rgb(0_0_0/0.35)]">
              {PHONE_TABS.map(({ icon: Icon, label, active }) => (
                <span key={label} className={cn("flex flex-auto flex-col items-center gap-[0.25em] rounded-full px-[0.5em] py-[0.45em]", active ? "bg-accent px-[1em] font-medium" : "text-muted-foreground")}>
                  <Icon className="size-[1.45em]" />
                  <span className="text-[0.68em] tracking-tight whitespace-nowrap">{label}</span>
                </span>
              ))}
            </div>
            <span className="absolute bottom-[0.6em] left-1/2 h-[0.38em] w-[34%] -translate-x-1/2 rounded-full bg-foreground" />
          </div>
        </div>
      </div>
    </div>
  );
}
