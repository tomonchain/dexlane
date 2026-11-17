"use client";

import { LogOut, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CommandMenu, PAGES } from "./command-menu";
import { ThemeSwitch } from "./theme";

const GROUPS = [
  { title: "Opérations", hrefs: ["/", "/vrac"] },
  { title: "Stock", hrefs: ["/inventaire", "/rangement"] },
  { title: "Référentiel", hrefs: ["/catalogue"] },
];

const isCurrent = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="relative flex size-7 items-center justify-center rounded-lg bg-primary shadow-sm shadow-primary/30" aria-hidden>
        <span className="absolute h-4 w-3 -translate-x-[3px] -rotate-12 rounded-[3px] border-[1.5px] border-primary-foreground/60" />
        <span className="absolute h-4 w-3 translate-x-[3px] rotate-6 rounded-[3px] bg-primary-foreground" />
      </span>
      <span className="text-[17px] font-semibold tracking-tight">dexlane</span>
    </span>
  );
}

const logout = () => void api.logout().then(() => window.location.assign("/login"));

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [searching, setSearching] = useState(false);

  if (pathname === "/login") return <main className="min-h-dvh">{children}</main>;

  return (
    <>
      {/* Barre latérale (ordinateur) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar lg:flex">
        <Link href="/" className="flex h-16 items-center px-5 outline-none">
          <Logo />
        </Link>
        <div className="px-3">
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-2.5 text-sm text-muted-foreground shadow-xs transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1 text-left">Rechercher…</span>
            <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px] leading-5">⌘K</kbd>
          </button>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5" aria-label="Navigation principale">
          {GROUPS.map((group) => (
            <div key={group.title} className="space-y-1">
              <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground/80 uppercase">{group.title}</p>
              {PAGES.filter((p) => group.hrefs.includes(p.href)).map((p) => {
                const current = isCurrent(pathname, p.href);
                return (
                  <Link
                    key={p.href}
                    href={p.href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30",
                      current && "bg-card text-foreground shadow-xs ring-1 ring-border hover:bg-card",
                    )}
                  >
                    <p.icon className={cn("size-4", current && "text-primary")} aria-hidden />
                    {p.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t p-3">
          <ThemeSwitch />
          <button
            type="button"
            onClick={logout}
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <LogOut className="size-3.5" aria-hidden /> Déconnexion
          </button>
        </div>
      </aside>

      {/* En-tête (téléphone) */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md lg:hidden">
        <Link href="/" className="outline-none">
          <Logo />
        </Link>
        <div className="flex items-center gap-1.5">
          <ThemeSwitch className="hidden sm:inline-flex" />
          <button
            type="button"
            onClick={() => setSearching(true)}
            aria-label="Rechercher"
            className="flex size-10 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Search className="size-5" aria-hidden />
          </button>
        </div>
      </header>

      {/* Le décalage de la barre latérale porte sur le conteneur : le contenu se centre dans l'espace restant. */}
      <div className="lg:pl-60">
        <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-nav lg:px-10 lg:pt-9 lg:pb-12">{children}</main>
      </div>

      {/* Onglets (téléphone) : hors de l'en-tête, dont le flou d'arrière-plan ancrerait un élément fixe. */}
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        {PAGES.map((p) => {
          const current = isCurrent(pathname, p.href);
          return (
            <Link
              key={p.href}
              href={p.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground outline-none",
                current && "text-primary",
              )}
            >
              {current && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-primary" aria-hidden />}
              <p.icon className="size-[22px]" strokeWidth={current ? 2.2 : 1.8} aria-hidden />
              {p.label}
            </Link>
          );
        })}
      </nav>

      <CommandMenu open={searching} onOpenChange={setSearching} />
    </>
  );
}
