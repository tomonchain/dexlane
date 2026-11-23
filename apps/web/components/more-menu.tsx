"use client";

import { Archive, BookOpen, Boxes, ChartColumn, CircleUserRound, Monitor, Moon, Settings, ShoppingBasket, Sun, Tags, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useCachedState } from "@/lib/cache";
import { formatEuros } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SalesInsights } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Les écrans rangés derrière « Plus » sur téléphone : ce qu'on ouvre moins souvent que le stock ou les ventes. */
const SECTIONS: { title: string; items: { href: string; label: string; icon: LucideIcon }[] }[] = [
  {
    title: "Acheter et analyser",
    items: [
      { href: "/achats", label: "Achats", icon: ShoppingBasket },
      { href: "/statistiques", label: "Statistiques", icon: ChartColumn },
    ],
  },
  {
    title: "Gérer",
    items: [
      { href: "/catalogue", label: "Catalogue", icon: BookOpen },
      { href: "/rangement", label: "Emplacements", icon: Archive },
      { href: "/inventaire", label: "Positions", icon: Boxes },
      { href: "/prix", label: "Règles de prix", icon: Tags },
    ],
  },
  {
    title: "Application",
    items: [
      { href: "/reglages", label: "Réglages", icon: Settings },
      { href: "/compte", label: "Compte", icon: CircleUserRound },
    ],
  },
];

/** Préfixes des écrans de « Plus » : l'onglet est surligné quand l'un d'eux est ouvert. */
export const MORE_PATHS = ["/achats", "/statistiques", "/catalogue", "/rangement", "/inventaire", "/prix", "/reglages", "/compte"];

const THEMES = [
  { value: "light", label: "Clair", icon: Sun },
  { value: "dark", label: "Sombre", icon: Moon },
  { value: "system", label: "Système", icon: Monitor },
] as const;

function Tile({ icon: Icon, label, href, onClick, testId }: { icon: LucideIcon; label: string; href?: string; onClick?: () => void; testId?: string }) {
  const className =
    "flex flex-col items-center gap-2 rounded-2xl px-1 py-3 text-center text-[13px] text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 active:bg-accent";
  const body = <><Icon className="size-6 stroke-[1.6] text-foreground/80" aria-hidden /><span className="leading-tight">{label}</span></>;
  return href
    ? <Link href={href} onClick={onClick} className={className} data-testid={testId}>{body}</Link>
    : <button type="button" onClick={onClick} className={className} data-testid={testId}>{body}</button>;
}

/** Feuille « Plus » : posée au-dessus de la barre d'onglets, une grille d'écrans par thème et le thème de l'appli. */
export function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Le chiffre d'affaires des 30 derniers jours, en tête : la même donnée que l'écran Statistiques, gardée en mémoire.
  const [sales, setSales] = useCachedState<SalesInsights>("stats:sales:30");
  useEffect(() => {
    if (open) api.salesInsights(30).then(setSales).catch(() => undefined);
  }, [open, setSales]);

  const current = THEMES.find((x) => x.value === (mounted ? theme : "system")) ?? THEMES[2];
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]!;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 lg:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-50 mx-auto max-h-[calc(100dvh-7rem-env(safe-area-inset-top))] max-w-md overflow-y-auto rounded-[1.75rem] border bg-popover/95 p-5 text-popover-foreground shadow-2xl backdrop-blur-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 lg:hidden"
          data-testid="more-sheet"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-xl font-semibold tracking-tight">{t("Plus")}</Dialog.Title>
            <Dialog.Close aria-label={t("Fermer")} className="-mr-1.5 flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30">
              <X className="size-5" />
            </Dialog.Close>
          </div>

          <Link href="/statistiques" onClick={onClose} className="mt-4 flex items-center rounded-2xl p-2 -mx-2 outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/30">
            <span className="grid min-w-0">
              <span className="text-[15px] font-medium">{t("Ventes et chiffre d'affaires")}</span>
              <span className="tabular truncate text-sm text-muted-foreground">
                {sales ? t("{amount} sur 30 jours", { amount: formatEuros(sales.totals.revenueCents) }) : t("Ce qui se vend, ce mois-ci")}
              </span>
            </span>
          </Link>

          {SECTIONS.map((section) => (
            <section key={section.title} className="mt-5 grid gap-1.5" aria-label={t(section.title)}>
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t(section.title)}</h2>
              <div className="grid grid-cols-4 gap-1">
                {section.items.map((item) => <Tile key={item.href} icon={item.icon} label={t(item.label)} href={item.href} onClick={onClose} />)}
                {section.title === "Application" && (
                  <Tile icon={current.icon} label={t(current.label)} onClick={() => setTheme(next.value)} testId="more-theme" />
                )}
              </div>
            </section>
          ))}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
