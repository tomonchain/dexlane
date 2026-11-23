"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/** Onglets en segments, avec compteur facultatif. */
export function SegmentedTabs<T extends string>({ value, onChange, tabs, label }: {
  value: T;
  onChange: (value: T) => void;
  tabs: { value: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    /* Sur téléphone, les onglets occupent la largeur et passent à la ligne plutôt que de défiler de côté. */
    <div role="tablist" aria-label={label} className="flex max-w-full flex-wrap rounded-lg border bg-muted/60 p-0.5 sm:inline-flex sm:flex-nowrap">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              "flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 max-sm:flex-auto max-sm:justify-center max-sm:px-2.5",
              active && "bg-card text-foreground shadow-xs",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn("tabular rounded px-1.5 text-xs", active ? "bg-brand-soft text-primary" : "bg-muted text-muted-foreground")}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Pagination simple : précédent / suivant et position. Rien n'est affiché s'il n'y a qu'une page. */
export function Pagination({ page, pageCount, onChange, className }: { page: number; pageCount: number; onChange: (page: number) => void; className?: string }) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label={t("Pagination")} className={cn("flex items-center justify-between gap-3", className)}>
      <Button variant="outline" size="sm" onClick={() => onChange(page - 1)} disabled={page <= 1}>
        <ChevronLeft /> {t("Précédent")}
      </Button>
      <span className="tabular text-sm text-muted-foreground" aria-live="polite">{t("Page {page} sur {count}", { page, count: pageCount })}</span>
      <Button variant="outline" size="sm" onClick={() => onChange(page + 1)} disabled={page >= pageCount}>
        {t("Suivant")} <ChevronRight />
      </Button>
    </nav>
  );
}

/** Découpe une liste en pages ; la page demandée est ramenée dans les bornes si la liste a rétréci. */
export function paginate<T>(items: T[], page: number, size: number): { items: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(page, 1), pageCount);
  return { items: items.slice((current - 1) * size, current * size), page: current, pageCount };
}
