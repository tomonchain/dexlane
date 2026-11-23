"use client";

import { ChartColumn, CircleUserRound, House, Images, Layers, Package, Plus, Receipt, ScanLine, Search, Settings, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CommandMenu } from "./command-menu";
import { ThemeSwitch } from "./theme";

/** Les quatre destinations. Tout le reste se trouve dans le parcours (ajout, fiche d'une carte) ou dans Réglages. */
const NAV: { href: string; label: string; icon: LucideIcon; match: string[] }[] = [
  { href: "/", label: "Accueil", icon: House, match: [] },
  { href: "/stock", label: "Stock", icon: Package, match: ["/stock", "/inventaire"] },
  { href: "/ventes", label: "Ventes", icon: Receipt, match: ["/ventes"] },
  { href: "/statistiques", label: "Tableau de bord", icon: ChartColumn, match: ["/statistiques"] },
  { href: "/reglages", label: "Réglages", icon: Settings, match: ["/reglages", "/prix", "/rangement", "/catalogue", "/compte"] },
];
/** Sur téléphone, quatre onglets autour du bouton d'ajout ; Réglages est dans l'en-tête. */
const MOBILE_NAV = [NAV[0]!, NAV[1]!, null, NAV[2]!, NAV[3]!];
const NO_SHELL = ["/login", "/bienvenue"];
type IntakeMode = "SCANNER" | "CAMERA" | "FILES" | null;
/** Le lot se présente selon le matériel choisi dans l'assistant de démarrage. */
const LOT: Record<"SCANNER" | "CAMERA" | "FILES", { label: string; hint: string }> = {
  SCANNER: { label: "Un lot scanné", hint: "Images du scanner à défilement" },
  CAMERA: { label: "Un lot photographié", hint: "Au téléphone, recto puis verso" },
  FILES: { label: "Un lot d'images", hint: "Photos déjà prises, déposées ensemble" },
};
const ADD: { href: string; label: string; hint: string; icon: LucideIcon }[] = [
  { href: "/scanner/lot", label: "Un lot d'images", hint: "Fichiers du scanner à défilement", icon: Images },
  { href: "/ajouter", label: "Une carte", hint: "Photo ou recherche dans le catalogue", icon: ScanLine },
  { href: "/vrac", label: "Du vrac", hint: "Un lot compté, sans détail", icon: Layers },
];

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

/** Bouton d'ajout : une seule entrée pour faire entrer des cartes, trois façons de le faire. */
function AddMenu({ compact, intake }: { compact?: boolean; intake: IntakeMode }) {
  const items = ADD.map((item) => (item.href === "/scanner/lot" && intake ? { ...item, ...LOT[intake] } : item));
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          "flex items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-xs transition-colors outline-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/30",
          compact ? "size-11 rounded-full" : "h-10 w-full px-3",
        )}
        aria-label={compact ? "Ajouter des cartes" : undefined}
      >
        <Plus className="size-4" aria-hidden /> {!compact && "Ajouter des cartes"}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={compact ? "center" : "start"}
          sideOffset={6}
          className="z-50 w-64 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {items.map((item) => (
            <DropdownMenu.Item key={item.href} asChild>
              <Link href={item.href} className="flex items-center gap-3 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-accent">
                <item.icon className="size-4 text-muted-foreground" aria-hidden />
                <span className="grid">
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.hint}</span>
                </span>
              </Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function AppShell({ children, signedIn }: { children: ReactNode; signedIn: boolean }) {
  const pathname = usePathname();
  const [searching, setSearching] = useState(false);

  const router = useRouter();
  // Sans session, la racine est la page de présentation publique : pas de navigation d'application autour.
  const bare = NO_SHELL.includes(pathname) || (pathname === "/" && !signedIn);
  const [intake, setIntake] = useState<IntakeMode>(null);

  // Première utilisation : tant que l'assistant de démarrage n'a pas été terminé ou passé, il s'ouvre de lui-même.
  useEffect(() => {
    if (bare) return;
    let cancelled = false;
    api.appSettings()
      .then((s) => {
        if (cancelled) return;
        setIntake(s.intakeMode);
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
          <AddMenu intake={intake} />
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30"
          >
            <Search className="size-[18px]" aria-hidden />
            <span className="flex-1 text-left">Rechercher</span>
            <kbd className="font-mono text-[11px] text-muted-foreground/80">⌘K</kbd>
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3" aria-label="Navigation principale">
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
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t p-3">
          <ThemeSwitch />
          <Link
            href="/compte"
            aria-label="Compte"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30"
          >
            <CircleUserRound className="size-[18px]" aria-hidden />
          </Link>
        </div>
      </aside>

      {/* En-tête (téléphone) */}
      <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b bg-background px-4 pt-[env(safe-area-inset-top)] lg:hidden print:hidden">
        <Link href="/" className="outline-none"><Logo /></Link>
        <span className="flex items-center">
          <button type="button" onClick={() => setSearching(true)} aria-label="Rechercher" className="flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent">
            <Search className="size-[18px]" aria-hidden />
          </button>
          <Link href="/reglages" aria-label="Réglages" className="flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent">
            <Settings className="size-[18px]" aria-hidden />
          </Link>
        </span>
      </header>

      <div className="lg:pl-56 print:!pl-0">
        <main className="mx-auto w-full max-w-[92rem] px-4 pt-4 pb-nav lg:px-8 lg:pt-6 lg:pb-10 print:!m-0 print:!max-w-none print:!p-0">{children}</main>
      </div>

      {/* Onglets (téléphone) : deux destinations, l'ajout au centre, deux destinations. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 items-center border-t bg-background pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden" aria-label="Navigation principale">
        {MOBILE_NAV.map((item) =>
          item === null ? (
            <span key="add" className="flex justify-center"><AddMenu compact intake={intake} /></span>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(pathname, item) ? "page" : undefined}
              className={cn(
                "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground outline-none",
                isCurrent(pathname, item) && "text-foreground",
              )}
            >
              <item.icon className="size-[18px]" aria-hidden />
              {item.label}
            </Link>
          ),
        )}
      </nav>

      <CommandMenu open={searching} onOpenChange={setSearching} />
    </>
  );
}
