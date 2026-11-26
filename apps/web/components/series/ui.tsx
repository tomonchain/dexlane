import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CTA } from "@/components/landing/content";
import { Cta } from "@/components/marketing/ui";
import { SIGNUP_URL } from "@/config/site";
import { cn } from "@/lib/utils";

/** Fil d'Ariane visible (le même que celui des données structurées). */
export function Crumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Fil d'Ariane" className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, i) => (
          <li key={item.name} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden>/</span>}
            {item.href ? (
              <Link href={item.href} className="outline-none hover:text-foreground hover:underline focus-visible:underline">{item.name}</Link>
            ) : (
              <span aria-current="page" className="text-foreground">{item.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Image d'une carte au format des cartes Pokémon (63 × 88), avec un emplacement vide si le visuel manque. */
export function CardPicture({ src, alt, className, eager = false }: { src: string | null; alt: string; className?: string; eager?: boolean }) {
  return (
    <span className={cn("block aspect-[63/88] overflow-hidden rounded-[4.5%] bg-muted ring-1 ring-border/60", className)}>
      {src && (
        // Visuels servis par assets.tcgdex.net, déjà dimensionnés ; pas d'optimisation d'image Next pour eux.
        <img src={src} alt={alt} width={245} height={342} loading={eager ? "eager" : "lazy"} decoding="async" className="size-full object-cover" />
      )}
    </span>
  );
}

/** Appel à l'action en bas des pages : vendre ses cartes avec Dexlane. */
export function SellCta({ title, text }: { title: ReactNode; text: ReactNode }) {
  return (
    <aside className="grid gap-5 rounded-2xl bg-muted p-6 ring-1 ring-border/60 sm:flex sm:items-center sm:justify-between sm:gap-8 sm:p-8">
      <div className="grid max-w-2xl gap-2">
        <h2 className="text-lg font-medium tracking-[-0.015em]">{title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
      </div>
      <Cta href={SIGNUP_URL} size="md" className="shrink-0">{CTA.primary} <ArrowRight className="size-4" aria-hidden /></Cta>
    </aside>
  );
}

/** Courbe de cote : une ligne sur l'historique disponible, sans axe (les valeurs exactes sont dans le tableau). */
export function Sparkline({ points, label }: { points: { day: string; cents: number }[]; label: string }) {
  if (points.length < 2) return null;
  const W = 120;
  const H = 32;
  const values = points.map((p) => p.cents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const path = points
    .map((p, i) => `${((i / (points.length - 1)) * W).toFixed(1)},${(H - 2 - ((p.cents - min) / span) * (H - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} className="text-[#f18a1f]">
      <polyline points={path} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
