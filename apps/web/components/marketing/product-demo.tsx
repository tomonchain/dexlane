import {
  BarChart3, CalendarClock, History, Home, Layers, Plus, Receipt, Search, Settings, ShoppingBasket,
  SlidersHorizontal, Boxes,
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
  planned: { label: "Planifiée jeu. 26 nov", dot: "bg-foreground/30" },
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

/** Version téléphone : la liste des cartes. */
export function StockDemoMobile() {
  return (
    <div className="grid bg-background text-[11px] leading-tight text-foreground select-none">
      <div className="grid gap-0.5 px-3 pt-1 pb-2">
        <span className="text-[16px] font-semibold tracking-tight">Stock</span>
        <span className="text-muted-foreground">9 cartes · 119,70 €</span>
      </div>
      <div className="mx-2 mb-2 overflow-hidden rounded-lg bg-card shadow-[0_0_0_1px_var(--border)]">
        {ROWS.map((row) => (
          <div key={row.name} className="flex items-center gap-2 border-b px-2.5 py-1.5 last:border-b-0">
            <RealCard n={row.number} sizes="48px" className="w-6 shrink-0 shadow-[0_0_0_1px_rgb(0_0_0/0.08)]" />
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-[12px] font-medium">{row.name}</span>
              <span className="flex min-w-0 items-center gap-1 truncate text-muted-foreground">
                <span className={cn("size-1.5 shrink-0 rounded-full", STATUS[row.status].dot)} />
                <span className="truncate">{row.condition} · {STATUS[row.status].label}</span>
              </span>
            </span>
            <span className="font-medium tabular-nums">{row.price}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

