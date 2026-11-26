"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { DOCS_INDEX, DOC_GROUPS, DOC_PAGES } from "./content";

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const link = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={cn(
          "block rounded-md px-2.5 py-1.5 text-[14px] outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30",
          active ? "bg-accent font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </Link>
    );
  };
  return (
    <div className="grid gap-6">
      <div>{link("/docs", DOCS_INDEX.title)}</div>
      {DOC_GROUPS.map((group) => (
        <div key={group.id} className="grid gap-1">
          <p className="px-2.5 pb-1 text-xs font-medium text-foreground">{group.title}</p>
          <ul className="grid gap-0.5">
            {DOC_PAGES.filter((p) => p.group === group.id).map((page) => <li key={page.slug}>{link(`/docs/${page.slug}`, page.title)}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Sommaire des docs : colonne collante sur ordinateur, menu repliable sous 1024 px (refermé à chaque navigation). */
export function DocsNav() {
  const pathname = usePathname();
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (details.current) details.current.open = false;
  }, [pathname]);
  const current = DOC_PAGES.find((p) => pathname === `/docs/${p.slug}`)?.title ?? DOCS_INDEX.title;

  return (
    <>
      <nav aria-label={DOCS_INDEX.navLabel} className="sticky top-24 hidden max-h-[calc(100dvh-7rem)] self-start overflow-y-auto pb-8 lg:block">
        <NavList pathname={pathname} />
      </nav>
      <details ref={details} className="group rounded-xl bg-card shadow-[0_0_0_1px_rgb(0_0_0/0.07),0_1px_2px_rgb(0_0_0/0.05)] lg:hidden dark:shadow-[0_0_0_1px_rgb(255_255_255/0.1)] [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30">
          <span className="grid">
            <span className="text-xs text-muted-foreground">{DOCS_INDEX.menu}</span>
            <span className="font-medium">{current}</span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <nav aria-label={DOCS_INDEX.menu} className="border-t px-1.5 py-4">
          <NavList pathname={pathname} onNavigate={() => details.current && (details.current.open = false)} />
        </nav>
      </details>
    </>
  );
}
