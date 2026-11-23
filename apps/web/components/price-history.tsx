"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { api } from "@/lib/api";
import { dateFormat, formatEuros, formatNumber } from "@/lib/format";
import { intlLocale, t } from "@/lib/i18n";
import type { PriceHistory as History } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChartSkeleton } from "./skeletons";

type QuoteType = History["series"][number]["quoteType"];

/** Chaque série garde sa couleur, quelle que soit la période ou les séries présentes. */
const SERIES: Record<QuoteType, { label: string; color: string }> = {
  SOLD_AVG_7D: { label: "Ventes 7 j", color: "var(--chart-1)" },
  SOLD_AVG_30D: { label: "Ventes 30 j", color: "var(--chart-2)" },
  LISTED_LOW: { label: "Annonce la moins chère", color: "var(--chart-3)" },
  LISTED_TREND: { label: "Tendance des annonces", color: "var(--chart-4)" },
};
const RANGES: { days: number; label: string }[] = [{ days: 30, label: "30 j" }, { days: 90, label: "90 j" }, { days: 365, label: "1 an" }];

const HEIGHT = 176;
const MARGIN = { top: 10, right: 12, bottom: 22, left: 46 };
/** Largeur de l'infobulle : fixe, pour la garder entière dans un panneau étroit. */
const TOOLTIP_WIDTH = 216;
const wholeEuros = () => new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const shortDay = () => dateFormat({ day: "numeric", month: "short", timeZone: "Europe/Paris" });
const longDay = () => dateFormat({ day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

/** Graduations rondes (1, 2 ou 5 × 10ⁿ centimes) couvrant l'étendue des prix, sans forcer l'origine à zéro. */
function scaleOf(min: number, max: number): { low: number; high: number; ticks: number[] } {
  const spread = max - min || Math.max(max * 0.2, 2);
  const raw = spread / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw)!);
  const low = Math.max(0, Math.floor((min - spread * 0.08) / step) * step);
  const high = Math.ceil((max + spread * 0.08) / step) * step;
  const ticks: number[] = [];
  for (let t = low; t <= high + step / 2; t += step) ticks.push(t);
  return { low, high: ticks.at(-1)!, ticks };
}

/**
 * Évolution des prix d'une carte : les ventes réussies (moyennes sur 7 et 30 jours) et l'annonce la moins chère, relevé après
 * relevé. Sans vente sur la période, la tendance des annonces prend leur place. Un seul axe, en euros.
 */
/** `title` : l'intitulé au-dessus de la courbe ; null quand la section qui l'entoure le porte déjà. */
export function PriceHistory({ variantId, className, title = t("Évolution du prix") }: { variantId: string; className?: string; title?: ReactNode }) {
  const [days, setDays] = useState(90);
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setFailed(false);
    api.priceHistory(variantId, days)
      .then((h) => current && setHistory(h))
      .catch(() => current && setFailed(true))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [variantId, days]);
  // Une autre carte : le graphique de la précédente ne reste pas affiché.
  useEffect(() => setHistory(null), [variantId]);

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const model = useMemo(() => {
    if (!history) return null;
    const has = (type: QuoteType) => history.series.some((s) => s.quoteType === type);
    // Les ventes d'abord ; la tendance des annonces seulement quand rien ne s'est vendu sur la période.
    const kept: QuoteType[] = has("SOLD_AVG_7D") || has("SOLD_AVG_30D") ? ["SOLD_AVG_7D", "SOLD_AVG_30D", "LISTED_LOW"] : ["LISTED_TREND", "LISTED_LOW"];
    const series = kept.flatMap((type) => {
      const found = history.series.find((s) => s.quoteType === type);
      return found ? [{ type, points: found.points.map((p) => ({ t: new Date(p.at).getTime(), cents: p.cents })) }] : [];
    });
    const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
    const values = series.flatMap((s) => s.points.map((p) => p.cents));
    return times.length === 0 ? null : { series, times, scale: scaleOf(Math.min(...values), Math.max(...values)) };
  }, [history]);
  useEffect(() => setActive(null), [model]);

  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 1);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (time: number) => {
    if (!model || model.times.length < 2) return MARGIN.left + plotWidth / 2;
    return MARGIN.left + ((time - model.times[0]!) / (model.times.at(-1)! - model.times[0]!)) * plotWidth;
  };
  const y = (cents: number) => MARGIN.top + (1 - (cents - model!.scale.low) / (model!.scale.high - model!.scale.low)) * plotHeight;

  function onPointer(e: PointerEvent<SVGRectElement>) {
    if (!model) return;
    const bounds = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = e.clientX - bounds.left;
    let nearest = 0;
    for (const [i, time] of model.times.entries()) if (Math.abs(x(time) - px) < Math.abs(x(model.times[nearest]!) - px)) nearest = i;
    setActive(nearest);
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!model) return;
    const last = model.times.length - 1;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setActive((i) => Math.min(last, Math.max(0, (i ?? last) + (e.key === "ArrowLeft" ? -1 : 1))));
    } else if (e.key === "Escape") setActive(null);
  }

  const activeTime = model && active !== null ? model.times[active]! : null;
  // Axe : des euros ronds sans centimes quand toutes les graduations tombent juste.
  const axisLabel = model && model.scale.ticks.every((tick) => tick % 100 === 0) ? (cents: number) => wholeEuros().format(cents / 100) : formatEuros;
  const since = history?.since ? new Date(history.since) : null;
  const shortHistory = since !== null && Date.now() - since.getTime() < (days - 1) * 86_400_000;
  // Graduations de dates : les extrémités, plus le milieu quand la place le permet.
  const dateTicks = model && model.times.length > 1
    ? [model.times[0]!, ...(plotWidth > 260 && model.times.length > 2 ? [model.times[Math.floor(model.times.length / 2)]!] : []), model.times.at(-1)!]
    : model ? [model.times[0]!] : [];

  return (
    <section className={cn("grid gap-3", className)} data-testid="price-history" aria-label={t("Évolution du prix")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {title ? <h3 className="text-xs font-medium text-muted-foreground">{title}</h3> : <span aria-hidden />}
        <div role="radiogroup" aria-label={t("Période")} className="flex gap-0.5 rounded-md bg-muted p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              role="radio"
              aria-checked={days === r.days}
              onClick={() => setDays(r.days)}
              className={cn("h-6 rounded px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40", days === r.days ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {t(r.label)}
            </button>
          ))}
        </div>
      </div>

      {model && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="price-history-legend">
          {model.series.map((s) => (
            <li key={s.type} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: SERIES[s.type].color }} aria-hidden />
              <span className="text-muted-foreground">{t(SERIES[s.type].label)}</span>
              <span className="tabular font-medium text-foreground">{formatEuros(s.points.at(-1)!.cents)}</span>
            </li>
          ))}
        </ul>
      )}

      <div ref={frame} className="relative">
        {!model && loading && !failed ? <ChartSkeleton height={HEIGHT} /> : !model ? (
          <p className="flex items-center text-[13px] text-muted-foreground" style={{ height: HEIGHT }} role="status">
            {failed ? t("Historique indisponible pour le moment.") : t("Aucun relevé de prix sur cette période.")}
          </p>
        ) : (
          <div
            tabIndex={0}
            role="img"
            aria-label={[
              t("Évolution du prix sur {range}, du {from} au {to}.", { range: t(RANGES.find((r) => r.days === days)!.label), from: shortDay().format(model.times[0]), to: shortDay().format(model.times.at(-1)) }),
              `${model.series.map((s) => t("{label} : {value}", { label: t(SERIES[s.type].label), value: formatEuros(s.points.at(-1)!.cents) })).join(", ")}.`,
              t("Flèches gauche et droite pour parcourir les relevés."),
            ].join(" ")}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            className={cn("rounded-md outline-none transition-opacity focus-visible:ring-[3px] focus-visible:ring-ring/30", loading && "opacity-50")}
          >
            {width > 0 && (
              <svg width={width} height={HEIGHT} className="block overflow-visible" aria-hidden>
                {model.scale.ticks.map((tick) => (
                  <g key={tick}>
                    <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth="1" />
                    <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="tabular fill-muted-foreground text-[11px]">{axisLabel(tick)}</text>
                  </g>
                ))}
                {dateTicks.map((time, i) => (
                  <text key={time} x={x(time)} y={HEIGHT - 6} textAnchor={dateTicks.length === 1 ? "middle" : i === 0 ? "start" : i === dateTicks.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[11px]">
                    {shortDay().format(time)}
                  </text>
                ))}
                {activeTime !== null && <line x1={x(activeTime)} x2={x(activeTime)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--muted-foreground)" strokeWidth="1" />}
                {model.series.map((s) => (
                  <g key={s.type}>
                    {s.points.length > 1 && (
                      <polyline points={s.points.map((p) => `${x(p.t).toFixed(1)},${y(p.cents).toFixed(1)}`).join(" ")} fill="none" stroke={SERIES[s.type].color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                    )}
                    {/* Point final, ou point du relevé survolé, cerclé de la couleur de surface. */}
                    {(activeTime === null ? [s.points.at(-1)!] : s.points.filter((p) => p.t === activeTime)).map((p) => (
                      <circle key={p.t} cx={x(p.t)} cy={y(p.cents)} r="4" fill={SERIES[s.type].color} stroke="var(--card)" strokeWidth="2" />
                    ))}
                  </g>
                ))}
                <rect
                  x={MARGIN.left} y={MARGIN.top} width={plotWidth} height={plotHeight} fill="transparent"
                  onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={() => setActive(null)}
                  data-testid="price-history-plot"
                />
              </svg>
            )}
            {activeTime !== null && (
              <div
                role="tooltip"
                data-testid="price-history-tooltip"
                className="pointer-events-none absolute z-10 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
                // Au-dessus du tracé, pour ne masquer aucune courbe, et toujours entière dans la largeur disponible.
                style={{ width: TOOLTIP_WIDTH, bottom: HEIGHT - MARGIN.top + 6, left: Math.min(Math.max(x(activeTime) - TOOLTIP_WIDTH / 2, 0), Math.max(width - TOOLTIP_WIDTH, 0)) }}
              >
                <p className="mb-1 font-semibold">{longDay().format(activeTime)}</p>
                <dl className="grid grid-cols-[auto_auto_1fr] items-center gap-x-2 gap-y-0.5">
                  {model.series.map((s) => {
                    const point = s.points.find((p) => p.t === activeTime);
                    return (
                      <div key={s.type} className="contents">
                        <span className="h-0.5 w-3 rounded-full" style={{ background: SERIES[s.type].color }} aria-hidden />
                        <dd className="tabular font-semibold">{point ? formatEuros(point.cents) : "—"}</dd>
                        <dt className="text-muted-foreground">{t(SERIES[s.type].label)}</dt>
                      </div>
                    );
                  })}
                </dl>
              </div>
            )}
          </div>
        )}
      </div>

      {model && (
        <>
          <p className="text-xs text-muted-foreground">
            {model.times.length === 1
              ? t("Un seul relevé pour l'instant, le {date} : la courbe se dessine au fil des relevés quotidiens.", { date: longDay().format(model.times[0]) })
              : t("{n} relevés Cardmarket, toutes langues et tous états confondus.", { n: formatNumber(model.times.length) }) + (shortHistory && since ? ` ${t("Suivi depuis le {date}.", { date: longDay().format(since) })}` : "")}
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:underline">{t("Tableau des valeurs")}</summary>
            <div className="mt-2 max-h-48 overflow-auto rounded-md border">
              <table className="tabular w-full text-left">
                <thead className="sticky top-0 bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 font-medium">{t("Relevé")}</th>
                    {model.series.map((s) => <th key={s.type} className="px-2 py-1 text-right font-medium">{t(SERIES[s.type].label)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...model.times].reverse().map((time) => (
                    <tr key={time} className="border-t">
                      <td className="px-2 py-1 whitespace-nowrap">{shortDay().format(time)}</td>
                      {model.series.map((s) => {
                        const point = s.points.find((p) => p.t === time);
                        return <td key={s.type} className="px-2 py-1 text-right">{point ? formatEuros(point.cents) : "—"}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
