"use client";

import { CalendarClock, ChartColumn, CircleUserRound, House, Package, Receipt, Search, Settings, ShoppingBasket, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CommandMenu } from "./command-menu";
import { ThemeSwitch } from "./theme";

/** Les quatre destinations. Tout le reste se trouve dans le parcours (ajout, fiche d'une carte) ou dans Réglages. */
const NAV: { href: string; label: string; short?: string; icon: LucideIcon; match: string[] }[] = [
  { href: "/", label: "Accueil", icon: House, match: [] },
  { href: "/stock", label: "Stock", icon: Package, match: ["/stock", "/inventaire"] },
  { href: "/mises-en-ligne", label: "Mises en ligne", icon: CalendarClock, match: ["/mises-en-ligne"] },
  { href: "/achats", label: "Achats", icon: ShoppingBasket, match: ["/achats"] },
  { href: "/ventes", label: "Ventes", icon: Receipt, match: ["/ventes"] },
  { href: "/statistiques", label: "Statistiques", short: "Stats", icon: ChartColumn, match: ["/statistiques"] },
  { href: "/reglages", label: "Réglages", icon: Settings, match: ["/reglages", "/prix", "/rangement", "/catalogue", "/compte"] },
];
/**
 * Sur téléphone, cinq onglets ; Réglages et la recherche sont dans l'en-tête, les mises en ligne depuis le stock.
 * L'ajout de cartes se fait depuis l'accueil et le stock.
 */
const MOBILE_NAV = ["/", "/stock", "/achats", "/ventes", "/statistiques"].map((href) => NAV.find((n) => n.href === href)!);
const NO_SHELL = ["/login", "/bienvenue"];
const isCurrent = (pathname: string, item: (typeof NAV)[number]) =>
  item.href === "/" ? pathname === "/" : item.match.some((m) => pathname.startsWith(m));

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="relative flex size-6 items-center justify-center" aria-hidden>
        <span className="absolute h-[18px] w-[13px] -translate-x-[3px] -rotate-12 rounded-[3px] bg-foreground/15" />
        <span className="absolute h-[18px] w-[13px] translate-x-[2px] rotate-6 rounded-[3px] bg-brand" />
      </span>
      <span className="text-base font-semibold tracking-tight">dexlane</span>
    </span>
  );
}

/**
 * Barre d'onglets qui se fait discrète, comme dans les applis de réseaux sociaux : réduite (icônes seules, plus petite)
 * quand on descend, en grand quand on remonte, en haut de page ou à chaque changement d'écran. L'état est aussi posé sur
 * <html> (data-nav-compact) pour que les barres d'action fixées au-dessus d'elle la suivent.
 */
function useCompactOnScroll(pathname: string): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    setCompact(false);
    let last = window.scrollY;
    let frame = 0;
    const desktop = window.matchMedia("(min-width: 64rem)"); // la barre latérale ne change pas
    const onScroll = () => {
      if (desktop.matches) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y < 64) setCompact(false);
        else if (y > last + 6) setCompact(true);
        else if (y < last - 6) setCompact(false);
        last = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-nav-compact", compact);
  }, [compact]);
  return compact;
}

export function AppShell({ children, signedIn }: { children: ReactNode; signedIn: boolean }) {
  const pathname = usePathname();
  const [searching, setSearching] = useState(false);

  const router = useRouter();
  // Sans session, la racine est la page de présentation publique : pas de navigation d'application autour.
  const bare = NO_SHELL.includes(pathname) || (pathname === "/" && !signedIn);
  const navCompact = useCompactOnScroll(pathname);

  // Première utilisation : tant que l'assistant de démarrage n'a pas été terminé ou passé, il s'ouvre de lui-même.
  useEffect(() => {
    if (bare) return;
    let cancelled = false;
    api.appSettings()
      .then((s) => {
        if (cancelled) return;
        if (!s.onboardingDone) router.replace("/bienvenue");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bare, router]);

  if (bare) return <main className="min-h-dvh">{children}</main>;

  return (
    <>
      {/* Barre latérale (ordinateur) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r bg-sidebar lg:flex print:!hidden">
        <Link href="/" className="flex h-14 items-center px-4 outline-none"><Logo /></Link>
        <div className="grid gap-2 px-3">
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30"
          >
            <Search className="size-[18px]" aria-hidden />
            <span className="flex-1 text-left">{t("Rechercher")}</span>
            <kbd className="font-mono text-[11px] text-muted-foreground/80">⌘K</kbd>
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3" aria-label={t("Navigation principale")}>
          {NAV.map((item) => {
            const current = isCurrent(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30",
                  current && "bg-accent text-foreground",
                )}
              >
                <item.icon className="size-[18px]" aria-hidden />
                {t(item.label)}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t p-3">
          <ThemeSwitch />
          <Link
            href="/compte"
            aria-label={t("Compte")}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30"
          >
            <CircleUserRound className="size-[18px]" aria-hidden />
          </Link>
        </div>
      </aside>

      <div className="relative lg:pl-56 print:!pl-0">
        {/*
          Sur téléphone, pas de barre d'en-tête : la page commence directement par son titre, et la recherche et les
          réglages tiennent en deux icônes en haut à droite (le titre des pages leur laisse la place).
        */}
        <div className="absolute top-[calc(env(safe-area-inset-top)+0.625rem)] right-2 z-20 flex items-center lg:hidden print:hidden" data-testid="mobile-corner">
          <button type="button" onClick={() => setSearching(true)} aria-label={t("Rechercher")} className="flex size-10 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30">
            <Search className="size-5" aria-hidden />
          </button>
          <Link href="/reglages" aria-label={t("Réglages")} className="flex size-10 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30">
            <Settings className="size-5" aria-hidden />
          </Link>
        </div>
        <main className="mx-auto w-full max-w-[92rem] px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-nav lg:px-8 lg:pt-6 lg:pb-10 print:!m-0 print:!max-w-none print:!p-0">{children}</main>
      </div>

      {/*
        Onglets (téléphone) : une barre flottante, détachée des bords et translucide. Quand on fait défiler vers le bas,
        elle se réduit (icônes seules, plus petite) pour laisser la place au contenu, et reprend sa taille dès qu'on remonte.
      */}
      <nav
        className={cn(
          "fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 mx-auto grid grid-cols-5 items-center rounded-full border border-border/70 bg-background/80 shadow-[0_8px_30px_-6px_rgb(0_0_0/0.18)] backdrop-blur-xl backdrop-saturate-150 motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out lg:hidden print:hidden",
          navCompact ? "h-12 max-w-64 px-1" : "h-16 max-w-md px-1.5",
        )}
        aria-label={t("Navigation principale")}
        data-testid="mobile-nav"
        data-compact={navCompact || undefined}
      >
        {MOBILE_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(pathname, item) ? "page" : undefined}
              className={cn(
                "group flex h-full flex-col items-center justify-center text-[10px] font-medium text-muted-foreground outline-none aria-[current=page]:text-foreground",
                !navCompact && "gap-0.5",
              )}
            >
              <span className={cn(
                "flex items-center justify-center rounded-full transition-all duration-300 motion-reduce:transition-none group-hover:bg-accent/70 group-focus-visible:ring-[3px] group-focus-visible:ring-ring/30 group-aria-[current=page]:bg-accent",
                navCompact ? "h-8 w-10" : "h-7 w-12",
              )}>
                <item.icon className={cn("transition-all duration-300 motion-reduce:transition-none group-aria-[current=page]:stroke-[2.25]", navCompact ? "size-[18px]" : "size-5")} aria-hidden />
              </span>
              <span className={cn("overflow-hidden leading-none transition-all duration-300 motion-reduce:transition-none", navCompact ? "max-h-0 opacity-0" : "max-h-4 opacity-100")}>{t(item.short ?? item.label)}</span>
            </Link>
        ))}
      </nav>

      <CommandMenu open={searching} onOpenChange={setSearching} />
    </>
  );
}
