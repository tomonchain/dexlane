import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { PublicCardLink } from "@dexlane/catalog";
import { CTA } from "@/components/landing/content";
import { Cta } from "@/components/marketing/ui";
import { SIGNUP_URL } from "@/config/site";
import { cn } from "@/lib/utils";
import { cardImage, cardPath, formatPrice, printedNumber } from "./format";

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

/** Vignette d'une carte vers sa page : image, nom, série et numéro, cote « à partir de ». */
export function CardTile({ card, showSet = true, className }: { card: PublicCardLink; showSet?: boolean; className?: string }) {
  const number = printedNumber(card.localNumber, card.setCardCountOfficial);
  return (
    <Link
      href={cardPath({ id: card.setId, name: card.setName }, card)}
      className={cn("group grid content-start gap-2 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30", className)}
    >
      <CardPicture src={cardImage(card.imageUrl)} alt={`${card.name} ${number}, ${card.setName}`} className="transition-transform group-hover:-translate-y-0.5" />
      <span className="grid gap-0.5 text-sm">
        <span className="font-medium leading-snug group-hover:underline">{card.name}</span>
        {showSet && <span className="truncate text-[13px] text-muted-foreground">{card.setName}</span>}
        <span className="flex justify-between gap-2 text-[13px] text-muted-foreground">
          <span className="font-mono">{number}</span>
          {card.fromCents !== null && <span className="tabular text-foreground">{formatPrice(card.fromCents)}</span>}
        </span>
      </span>
    </Link>
  );
}

/** Variation d'une cote sur environ 30 jours, d'après son historique (le relevé le plus ancien de la fenêtre). */
export function change30(history: { day: string; cents: number }[]): number | null {
  if (history.length < 2) return null;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const base = [...history].reverse().find((p) => p.day <= since) ?? history[0]!;
  const last = history[history.length - 1]!;
  if (base === last || base.cents === 0) return null;
  return (last.cents - base.cents) / base.cents;
}

/** « +12 % » en vert, « −8 % » en rouge, « stable » sous 1 %. */
export function ChangeBadge({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="text-muted-foreground">—</span>;
  const pct = Math.round(ratio * 100);
  if (Math.abs(pct) < 1) return <span className="text-muted-foreground">stable</span>;
  return (
    <span className={cn("tabular font-medium", pct > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
      {pct > 0 ? "+" : "−"}{Math.abs(pct)} %
    </span>
  );
}
