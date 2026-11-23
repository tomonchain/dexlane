import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Squelettes de chargement : la forme du contenu à venir, aux mêmes dimensions, pour que rien ne saute à l'arrivée
 * des données. Le pulsé est coupé quand le système demande moins d'animations.
 */
export function Bone({ className }: { className?: string }) {
  return <span className={cn("block rounded-md bg-muted motion-safe:animate-pulse", className)} />;
}

/** Zone en chargement : annoncée une fois aux lecteurs d'écran, la forme seule est visible. */
function Loading({ label, className, children }: { label?: string; className?: string; children: ReactNode }) {
  const text = label ?? t("Chargement");
  return (
    <div role="status" aria-label={text} aria-busy="true" className={className} data-testid="skeleton">
      <span className="sr-only">{text}…</span>
      <div aria-hidden className="contents">{children}</div>
    </div>
  );
}

/** Lignes d'une liste : vignette facultative, deux lignes de texte, une valeur à droite. */
function Rows({ count, thumb = false, className }: { count: number; thumb?: boolean; className?: string }) {
  return (
    <div className={cn("divide-y overflow-hidden rounded-lg border bg-card", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          {thumb && <Bone className="aspect-[63/88] w-7 shrink-0" />}
          <span className="grid flex-1 gap-1.5">
            <Bone className={cn("h-3.5", ["w-2/5", "w-1/2", "w-1/3", "w-3/5"][i % 4])} />
            <Bone className={cn("h-3", ["w-3/5", "w-2/3", "w-1/2", "w-2/5"][i % 4])} />
          </span>
          <Bone className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}

/** Chiffres clés : une rangée de cases, libellé, valeur, précision. */
function Figures({ count, className }: { count: number; className?: string }) {
  return (
    <div className={cn("grid gap-px overflow-hidden rounded-lg border bg-border", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="grid gap-2 bg-card px-4 py-3.5 sm:px-5">
          <Bone className="h-3 w-24" />
          <Bone className="h-5 w-28" />
          <Bone className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/** Graphique en colonnes : axe, grille et barres de hauteurs variées. */
function Columns({ count = 30, className }: { count?: number; className?: string }) {
  const heights = [38, 55, 30, 62, 45, 20, 50, 70, 35, 58, 25, 48, 66, 40, 30, 52, 74, 44, 28, 60, 36, 50, 68, 42, 22, 56, 47, 33, 64, 80];
  return (
    <div className={cn("grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2.5", className)}>
      <span />
      <div className="flex h-28 items-end gap-px border-b">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className="flex h-full flex-1 items-end justify-center">
            <span className="block w-full max-w-6 rounded-t bg-muted motion-safe:animate-pulse" style={{ height: `${heights[i % heights.length]}%` }} />
          </span>
        ))}
      </div>
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <Loading label={t("Chargement de l'accueil")} className="grid gap-6">
      <div className="grid gap-2">
        <Bone className="h-6 w-36" />
        <Bone className="h-4 w-44" />
      </div>
      <div className="grid gap-2">
        <Bone className="ml-1 h-3 w-14" />
        <Rows count={2} />
      </div>
      <div className="grid gap-2">
        <Bone className="ml-1 h-3 w-32" />
        <div className="grid gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="grid gap-3 bg-card px-4 py-4 sm:px-5">
              <div className="grid gap-2"><Bone className="h-3 w-28" /><Bone className="h-5 w-24" /><Bone className="h-3 w-40" /></div>
              <Columns />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Rows count={4} />
        <Rows count={4} thumb />
      </div>
    </Loading>
  );
}

/** Lignes du tableau du stock, dans les colonnes du vrai tableau (mêmes cellules, mêmes points de rupture). */
export function StockRowsSkeleton({ count = 8, wideSales = true }: { count?: number; wideSales?: boolean }) {
  return (
    <tbody role="status" aria-busy="true" aria-label={t("Chargement du stock")} data-testid="skeleton">
      {Array.from({ length: count }, (_, i) => (
        <tr key={i} className="h-[49px] border-b last:border-b-0" aria-hidden>
          <td className="w-9 pl-3"><Bone className="size-4 rounded-[4px]" /></td>
          <td className="px-3 py-1.5">
            <span className="flex items-center gap-3">
              <Bone className="aspect-[63/88] w-8 shrink-0 rounded-[3px]" />
              <span className="grid flex-1 gap-1.5">
                <Bone className={cn("h-3.5", ["w-32", "w-40", "w-28", "w-36"][i % 4])} />
                <Bone className={cn("h-3", ["w-48", "w-40", "w-56", "w-44"][i % 4])} />
              </span>
            </span>
          </td>
          <td className="hidden px-3 sm:table-cell"><Bone className="h-3.5 w-6" /></td>
          <td className="px-3"><Bone className="ml-auto h-3.5 w-5" /></td>
          <td className="hidden px-3 md:table-cell"><Bone className="h-3.5 w-16" /></td>
          <td className={cn("hidden px-3", wideSales ? "lg:table-cell" : "2xl:table-cell")}><Bone className="ml-auto h-3.5 w-14" /></td>
          <td className="px-3"><Bone className="ml-auto h-6 w-16" /></td>
          <td className="hidden px-3 sm:table-cell"><Bone className="h-3.5 w-14" /></td>
        </tr>
      ))}
    </tbody>
  );
}

/** Fiche d'une carte du stock : en-tête, chiffres, prix, graphique. */
export function InspectorSkeleton() {
  return (
    <Loading label={t("Chargement de la carte")} className="grid overflow-hidden rounded-lg border bg-card lg:sticky lg:top-6">
      <div className="flex gap-4 p-4">
        <Bone className="aspect-[63/88] w-24 shrink-0" />
        <span className="grid flex-1 content-start gap-2 pt-1">
          <Bone className="h-4 w-32" />
          <Bone className="h-3 w-44" />
          <Bone className="h-3 w-20" />
        </span>
      </div>
      <div className="grid grid-cols-4 gap-3 border-t px-4 py-3.5">
        {[0, 1, 2, 3].map((i) => <span key={i} className="grid gap-1.5"><Bone className="h-3 w-12" /><Bone className="h-4 w-10" /></span>)}
      </div>
      <div className="grid gap-3 border-t px-4 py-4">
        <Bone className="h-3 w-10" />
        <div className="flex gap-2"><Bone className="h-10 flex-1" /><Bone className="h-10 w-28" /></div>
        <Bone className="h-3 w-3/4" />
      </div>
      <div className="grid gap-3 border-t px-4 py-4">
        <Bone className="h-3 w-28" />
        <Bone className="h-44 w-full" />
      </div>
    </Loading>
  );
}

/** Graphique d'évolution du prix, à sa hauteur. */
export function ChartSkeleton({ height }: { height: number }) {
  return (
    <Loading label={t("Chargement de l'historique")} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2" >
      <span className="grid content-between py-1" style={{ height }}>
        {[0, 1, 2, 3].map((i) => <Bone key={i} className="h-2.5 w-8" />)}
      </span>
      <span className="relative" style={{ height }}>
        {[0, 1, 2, 3].map((i) => <span key={i} className="absolute inset-x-0 border-t" style={{ top: `${6 + i * 29}%` }} />)}
        <Bone className="absolute inset-x-0 top-1/3 h-16 opacity-70" />
      </span>
    </Loading>
  );
}

/** Liste des ventes : chiffres sur 30 jours, onglets, lignes. */
export function SalesSkeleton() {
  return (
    <Loading label={t("Chargement des ventes")} className="grid gap-3">
      <Rows count={6} />
    </Loading>
  );
}

export function SalesTotalsSkeleton() {
  return (
    <Loading label={t("Chargement des chiffres")} className="contents">
      <Figures count={3} className="grid-cols-3" />
    </Loading>
  );
}

/** Détail d'une vente : retour, titre, étapes, lignes à prélever. */
export function OrderSkeleton() {
  return (
    <Loading label={t("Chargement de la vente")} className="grid gap-5">
      <Bone className="h-4 w-16" />
      <div className="grid gap-2"><Bone className="h-7 w-52" /><Bone className="h-4 w-72" /></div>
      <Bone className="h-10 w-full" />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Rows count={3} thumb />
        <Figures count={1} />
      </div>
    </Loading>
  );
}

/** Tableau de bord : quatre chiffres, puis deux cartes. */
export function DashboardSkeleton() {
  return (
    <Loading label={t("Chargement du tableau de bord")} className="grid gap-5">
      <div className="grid gap-2"><Bone className="h-7 w-40" /><Bone className="h-4 w-80 max-w-full" /></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid gap-2 rounded-lg border bg-card p-4"><Bone className="h-3 w-24" /><Bone className="h-6 w-20" /><Bone className="h-3 w-36" /></div>
        ))}
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid gap-4 rounded-lg border bg-card p-5"><Bone className="h-4 w-48" /><Columns count={12} className="[&_div]:h-44" /></div>
        <div className="grid gap-3 rounded-lg border bg-card p-5">
          <Bone className="h-4 w-40" />
          {[0, 1, 2, 3].map((i) => <Bone key={i} className="h-3 w-full" />)}
        </div>
      </div>
    </Loading>
  );
}

/** Liste générique : quelques lignes, sans en-tête. */
export function ListSkeleton({ count = 5, thumb = false, label }: { count?: number; thumb?: boolean; label?: string }) {
  return <Loading label={label}><Rows count={count} thumb={thumb} /></Loading>;
}

/** Page de détail générique : titre, sous-titre, un bloc de contenu. */
export function PageSkeleton({ label }: { label?: string }) {
  return (
    <Loading label={label} className="grid gap-5">
      <div className="grid gap-2"><Bone className="h-7 w-48" /><Bone className="h-4 w-72 max-w-full" /></div>
      <Rows count={4} thumb />
    </Loading>
  );
}

/** Lot scanné : en-tête, bandeau, puis les lignes du lot. */
export function BatchSkeleton() {
  return (
    <Loading label={t("Chargement du lot")} className="grid gap-4">
      <Bone className="h-3.5 w-24" />
      <div className="flex items-center gap-4"><Bone className="h-6 w-56" /><Bone className="h-4 w-40" /></div>
      <Bone className="h-12 w-full" />
      <Rows count={6} thumb />
    </Loading>
  );
}

/** Préparation des envois : réglages à gauche, aperçu du rouleau à droite. */
export function PreparationSkeleton() {
  return (
    <Loading label={t("Chargement des envois")} className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <div className="grid gap-4">
        <div className="grid gap-3 rounded-lg border bg-card p-4"><Bone className="h-4 w-44" /><Bone className="h-9 w-full" /></div>
        <div className="grid gap-3 rounded-lg border bg-card p-4">{[0, 1, 2, 3].map((i) => <Bone key={i} className="h-5 w-full" />)}</div>
      </div>
      <div className="rounded-lg border bg-muted/40 p-4">
        <div className="mx-auto grid w-[72mm] max-w-full gap-2 bg-card p-4">{[0, 1, 2, 3, 4, 5, 6].map((i) => <Bone key={i} className={cn("h-3", i % 3 === 0 ? "w-1/2" : "w-full")} />)}</div>
      </div>
    </Loading>
  );
}
