"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { NAV, CTA } from "@/components/landing/content";
import { GITHUB_URL, LOGIN_URL, SIGNUP_URL } from "@/config/site";
import { cn } from "@/lib/utils";
import { Cta, Logo } from "./ui";

type HeaderLinkItem = { label: string; href: string; external?: boolean };

/** Liens de l'en-tête ; « Guides » n'y figure qu'une fois le premier guide publié. */
function links(showGuides: boolean): HeaderLinkItem[] {
  return [
    { label: NAV.features, href: "/#fonctionnalites" },
    { label: NAV.pricing, href: "/tarifs" },
    { label: NAV.quotes, href: "/series" },
    ...(showGuides ? [{ label: NAV.guides, href: "/guides" }] : []),
    { label: NAV.docs, href: "/docs" },
    { label: NAV.github, href: GITHUB_URL, external: true },
  ];
}

/**
 * En-tête du site marketing : collé en haut, fond opaque, fine bordure basse dès qu'on a défilé. Sous 1024 px, le logo,
 * « Essayer gratuitement » et un bouton qui ouvre les autres liens ; le menu se ferme à la navigation et avec Échap.
 */
export function MarketingHeader({ showGuides = false }: { showGuides?: boolean }) {
  const LINKS = links(showGuides);
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Le menu se referme quand on change de page ou d'ancre.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onHash = () => setOpen(false);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Une section reste active dans ses pages : /series/… pour « Cotes », /guides/… pour « Guides », /docs/… pour « Docs ».
  const isActive = (href: string) =>
    !href.includes("#") && !href.startsWith("http") && (pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)));

  return (
    <header className={cn("sticky top-0 z-40 border-b bg-background transition-colors", scrolled || open ? "border-border" : "border-transparent")}>
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:h-16 sm:px-8">
        {/* Un lien bloc : en ligne, sa ligne de base remontait le logo de quelques pixels au-dessus des liens. */}
        <Link href="/" aria-label="Dexlane, accueil" className="flex h-8 items-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"><Logo /></Link>
        <nav aria-label="Navigation du site" className="hidden lg:block">
          <ul className="flex items-center gap-1 text-sm">
            {LINKS.map((link) => (
              <li key={link.href}>
                <HeaderLink {...link} active={isActive(link.href)} />
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link
            href={LOGIN_URL}
            className="hidden rounded-md px-2 py-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 lg:inline-flex"
          >
            {NAV.login}
          </Link>
          <Cta href={SIGNUP_URL} size="sm">{CTA.header}</Cta>
          <button
            ref={buttonRef}
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-9 items-center justify-center rounded-lg text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30 lg:hidden"
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>

      <nav id={menuId} aria-label="Menu" hidden={!open} className="border-t bg-background lg:hidden">
        <ul className="mx-auto grid max-w-6xl px-2 py-2">
          {[...LINKS, { label: NAV.login, href: LOGIN_URL }].map((link) => (
            <li key={link.href}>
              <HeaderLink {...link} active={isActive(link.href)} onNavigate={() => setOpen(false)} block />
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

function HeaderLink({ label, href, external, active, block, onNavigate }: {
  label: string; href: string; external?: boolean; active: boolean; block?: boolean; onNavigate?: () => void;
}) {
  const classes = cn(
    "rounded-md outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30",
    block ? "flex h-11 items-center px-3 text-[15px]" : "inline-flex px-2.5 py-1.5",
    active ? "font-medium text-foreground" : "text-muted-foreground",
    active && !block && "bg-accent",
    active && block && "bg-accent",
  );
  if (external) return <a href={href} target="_blank" rel="noreferrer" className={classes} onClick={onNavigate}>{label}</a>;
  return <Link href={href} aria-current={active ? "page" : undefined} className={classes} onClick={onNavigate}>{label}</Link>;
}
