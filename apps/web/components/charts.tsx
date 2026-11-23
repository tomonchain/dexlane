"use client";

import { useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

const monthName = new Intl.DateTimeFormat("fr-FR", { month: "short" });
const monthFull = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const monthDate = (month: string) => new Date(`${month}-01T12:00:00`);

/** Arrondit le haut de l'échelle à une valeur lisible (1, 2 ou 5 × 10ⁿ). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 5, 10].map((m) => m * power).find((step) => step >= value)!;
}

export interface ColumnDatum {
  key: string;
  /** « 2026-11 » */
  month: string;
  value: number;
  /** Lignes de l'infobulle, sous le titre. */
  details: [string, string][];
}

/**
 * Colonnes mensuelles d'une seule série : barres fines arrondies en tête, grille discrète,
 * valeur affichée sur le dernier mois et le plus haut, détail au survol ou au focus.
 */
export function MonthlyColumns({ data, format, label }: { data: ColumnDatum[]; format: (value: number) => string; label: string }) {
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const top = Math.max(...data.map((d) => d.value));
  const ticks = [1, 0.5, 0];
  return (
    <figure className="grid gap-2" aria-label={label}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
        <div className="relative h-44 w-12 text-right text-[11px] text-muted-foreground tabular" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t) * 100}%` }}>{format(max * t)}</span>
          ))}
        </div>
        <div className="relative h-44">
          {ticks.map((t) => <span key={t} className="absolute inset-x-0 border-t border-border/70" style={{ top: `${(1 - t) * 100}%` }} aria-hidden />)}
          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
            {data.map((d, i) => {
              const labelled = d.value > 0 && (i === data.length - 1 || d.value === top);
              return (
                <div
                  key={d.key}
                  tabIndex={0}
                  className="group relative flex h-full flex-col items-center justify-end rounded-md outline-none hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/30"
                  aria-label={`${monthFull.format(monthDate(d.month))} : ${format(d.value)}`}
                >
                  {labelled && <span className="tabular mb-1 text-[11px] font-medium text-foreground">{format(d.value)}</span>}
                  <span
                    className="w-full max-w-6 rounded-t bg-chart-1 transition-opacity group-hover:opacity-85"
                    style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }}
                  />
                  <div
                    role="tooltip"
                    className={cn(
                      "pointer-events-none absolute bottom-full z-10 mb-1 hidden w-max min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg group-hover:block group-focus-visible:block",
                      i === 0 ? "left-0" : i === data.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2",
                    )}
                  >
                    <p className="mb-1 font-semibold first-letter:uppercase">{monthFull.format(monthDate(d.month))}</p>
                    <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
                      {d.details.map(([name, value]) => (
                        <div key={name} className="contents"><dt className="text-muted-foreground">{name}</dt><dd className="tabular text-right font-medium">{value}</dd></div>
                      ))}
                    </dl>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <span />
        <div className="grid pt-1.5 text-center text-[11px] text-muted-foreground" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }} aria-hidden>
          {data.map((d) => <span key={d.key}>{monthName.format(monthDate(d.month)).replace(".", "")}</span>)}
        </div>
      </div>
    </figure>
  );
}

const dayShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const dayFull = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dayDate = (day: string) => new Date(`${day}T12:00:00Z`);

export interface DayDatum {
  /** « 2026-11-23 » */
  day: string;
  value: number;
  /** Lignes de l'infobulle, sous la date : la valeur d'abord, puis son nom. */
  details: [string, string][];
}

/**
 * Colonnes quotidiennes d'une seule série (30 jours) : barres fines arrondies en tête, grille discrète, dates aux extrémités.
 * Le détail d'un jour s'affiche au survol ; au clavier, le graphique est un seul arrêt et les flèches parcourent les jours.
 */
export function DailyColumns({ data, format, label, wholeNumbers = false }: { data: DayDatum[]; format: (value: number) => string; label: string; wholeNumbers?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const top = Math.max(...data.map((d) => d.value), 0);
  // Un compte (des ventes) garde des graduations entières : le haut de l'échelle est pair.
  const nice = niceMax(top);
  const max = wholeNumbers ? Math.max(nice % 2 === 0 ? nice : nice + 1, 2) : nice;
  const ticks = [1, 0.5, 0];
  const last = data.length - 1;
  // Le jour le plus haut (le plus récent à égalité), s'il y en a un.
  const peak = top > 0 ? data.reduce((best, d, i) => (d.value >= data[best]!.value ? i : best), 0) : -1;
  const dates = [0, Math.floor(last / 2), last];
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setActive((i) => Math.min(last, Math.max(0, (i ?? last + 1) + (e.key === "ArrowLeft" ? -1 : 1))));
    } else if (e.key === "Escape") setActive(null);
  }
  return (
    <figure
      className="grid rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
      tabIndex={0}
      role="img"
      aria-label={`${label}. Flèches gauche et droite pour parcourir les jours.`}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5">
        <div className="tabular relative h-28 w-11 text-right text-[11px] text-muted-foreground" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t) * 100}%` }}>{format(max * t)}</span>
          ))}
        </div>
        <div className="relative h-28" onPointerLeave={() => setActive(null)}>
          {ticks.map((t) => <span key={t} className="absolute inset-x-0 border-t border-border/70" style={{ top: `${(1 - t) * 100}%` }} aria-hidden />)}
          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
            {data.map((d, i) => (
              // La colonne entière est la zone de survol : inutile de viser une barre de quelques pixels.
              <div key={d.day} data-testid="day-column" className={cn("relative flex h-full flex-col items-center justify-end px-px", active === i && "bg-accent/60")} onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)}>
                {/* Seul le meilleur jour porte sa valeur : le reste se lit sur l'axe et au survol. */}
                {i === peak && <span className="tabular mb-0.5 text-[10px] leading-none font-medium whitespace-nowrap text-foreground" data-testid="day-peak">{format(d.value)}</span>}
                <span className={cn("w-full max-w-6 rounded-t bg-chart-1", active !== null && active !== i && "opacity-55")} style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }} />
              </div>
            ))}
          </div>
          {active !== null && (
            <div
              role="tooltip"
              data-testid="day-tooltip"
              className="pointer-events-none absolute bottom-full z-10 mb-1 w-max min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
              style={active / last > 0.5 ? { right: `${(1 - (active + 1) / data.length) * 100}%` } : { left: `${(active / data.length) * 100}%` }}
            >
              <p className="mb-1 font-semibold first-letter:uppercase">{dayFull.format(dayDate(data[active]!.day))}</p>
              <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
                {data[active]!.details.map(([name, value]) => (
                  <div key={name} className="contents"><dd className="tabular font-semibold">{value}</dd><dt className="text-muted-foreground">{name}</dt></div>
                ))}
              </dl>
            </div>
          )}
        </div>
        <span />
        <div className="relative h-5 pt-1.5 text-[11px] text-muted-foreground" aria-hidden>
          {dates.map((i, n) => (
            <span key={i} className={cn("absolute whitespace-nowrap", n === 0 ? "left-0" : n === 2 ? "right-0" : "left-1/2 -translate-x-1/2")}>{dayShort.format(dayDate(data[i]!.day)).replace(".", "")}</span>
          ))}
        </div>
      </div>
    </figure>
  );
}

/** Barres horizontales d'une seule série : libellé à gauche, valeur au bout de la barre. */
export function HorizontalBars({ data, format }: { data: { key: string; label: string; value: number; note?: string }[]; format: (value: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <dl className="grid gap-2.5">
      {data.map((d) => (
        <div key={d.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 text-sm">
          <dt className="truncate text-muted-foreground">{d.label}</dt>
          <dd className="flex items-center gap-2">
            <span className="h-3 rounded-r bg-chart-1" style={{ width: `${(d.value / max) * 55}%`, minWidth: d.value > 0 ? 2 : 0 }} aria-hidden />
            <span className="tabular font-medium whitespace-nowrap">{format(d.value)}</span>
            {d.note && <span className="text-xs whitespace-nowrap text-muted-foreground">{d.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Courbe miniature d'une cote : trait fin, point final cerclé de la couleur de surface. */
export function Sparkline({ values, className, label }: { values: number[]; className?: string; label: string }) {
  const width = 104, height = 32, pad = 5;
  if (values.length < 2) return <span className={cn("block h-8 w-[104px]", className)} aria-hidden />;
  const min = Math.min(...values), max = Math.max(...values);
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - 2 * pad);
  const y = (v: number) => (max === min ? height / 2 : height - pad - ((v - min) / (max - min)) * (height - 2 * pad));
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className={cn("shrink-0 text-chart-1", className)}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r="4" fill="currentColor" stroke="var(--card)" strokeWidth="2" />
    </svg>
  );
}
