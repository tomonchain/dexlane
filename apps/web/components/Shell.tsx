"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const TABS = [
  { href: "/", label: "Scanner", icon: icon("M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z") },
  { href: "/inventaire", label: "Inventaire", icon: icon("M4 6h16M4 12h16M4 18h10") },
  { href: "/vrac", label: "Vrac", icon: icon("M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5") },
  { href: "/rangement", label: "Rangement", icon: icon("M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z") },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const bare = pathname === "/login";
  const wide = pathname.startsWith("/inventaire");
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">dex<span>lane</span></Link>
        {!bare && (
          <nav className="nav" aria-label="Navigation principale">
            {TABS.map((t) => {
              const current = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
              return (
                <Link key={t.href} href={t.href} aria-current={current ? "page" : undefined}>
                  {t.icon}
                  {t.label}
                </Link>
              );
            })}
          </nav>
        )}
      </header>
      <main className={wide ? "main wide" : "main"}>{children}</main>
    </>
  );
}
