"use client";

import { History, Layers, PackageOpen, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type StockCategory = "cartes" | "fournitures" | "mouvements";

const TABS: { value: StockCategory; label: string; icon: LucideIcon; href: string }[] = [
  { value: "cartes", label: "Cartes", icon: Layers, href: "/stock" },
  { value: "fournitures", label: "Fournitures", icon: PackageOpen, href: "/stock?categorie=fournitures" },
  { value: "mouvements", label: "Mouvements", icon: History, href: "/stock?categorie=mouvements" },
];

export const stockCategory = (value: string | null): StockCategory =>
  value === "fournitures" || value === "mouvements" ? value : "cartes";

/**
 * Les rubriques du stock : les cartes, les fournitures d'expédition, et le journal de tout ce qui entre et sort.
 * Des onglets soulignés, pour ne pas les confondre avec les filtres en segments de chaque rubrique.
 */
export function StockTabs({ current, badges }: { current: StockCategory; badges?: Partial<Record<StockCategory, number>> }) {
  return (
    <nav aria-label={t("Rubriques du stock")} className="-mt-1 flex border-b" data-testid="stock-tabs">
      {TABS.map((tab) => {
        const active = tab.value === current;
        const badge = badges?.[tab.value];
        return (
          <Link
            key={tab.value}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex h-10 flex-1 items-center justify-center gap-1.5 border-b-2 border-transparent px-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 sm:flex-none sm:px-4",
              active && "border-foreground text-foreground",
            )}
          >
            <tab.icon className="size-4 max-[380px]:hidden" aria-hidden />
            {t(tab.label)}
            {badge !== undefined && badge > 0 && (
              <span className="tabular rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold text-warning" aria-label={t("{n} à commander", { n: badge })}>{badge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
