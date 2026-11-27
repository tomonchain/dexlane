import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { EbayLogo, ORANGE } from "@/components/brand";
import { cn } from "@/lib/utils";

export { EbayLogo, Glow, Logo, ORANGE, RealCard } from "@/components/brand";

/*
 * Briques visuelles du site marketing, partagées par la landing et les autres pages : boutons encre et papier,
 * titres fins, traînées lumineuses aux couleurs de Dexlane.
 */

const WARM = `linear-gradient(100deg, transparent 0%, #ffd29a 22%, ${ORANGE} 48%, #c4521a 70%, #ffb86b 86%, transparent 100%)`;

const BUTTON = "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap outline-none transition-[transform,box-shadow,background-color] active:scale-[0.98] focus-visible:ring-[3px] focus-visible:ring-ring/40 [&_svg]:size-4 [&_svg]:shrink-0";
const SIZES = { sm: "h-9 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-[15px]" };
/** Encre pleine avec un léger relief. */
const INK = "bg-[linear-gradient(to_bottom,color-mix(in_oklch,var(--primary)_88%,white),var(--primary))] text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(0_0_0/0.25),0_4px_12px_-4px_rgb(0_0_0/0.3)] hover:brightness-110";
/** Papier : fond de carte, ombre douce, pas de bordure. */
const PAPER = "bg-card text-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.06),0_4px_12px_-6px_rgb(0_0_0/0.12)] hover:bg-accent";

export function Cta({ href, children, tone = "ink", size = "lg", external, className }: {
  href: string; children: ReactNode; tone?: "ink" | "paper"; size?: keyof typeof SIZES; external?: boolean; className?: string;
}) {
  const classes = cn(BUTTON, SIZES[size], tone === "ink" ? INK : PAPER, className);
  return external
    ? <a href={href} target="_blank" rel="noreferrer" className={classes}>{children}</a>
    : <Link href={href} className={classes}>{children}</Link>;
}

/** Lien souligné, comme « Voir le détail des tarifs → ». */
export function TextLink({ href, children, external, className }: { href: string; children: ReactNode; external?: boolean; className?: string }) {
  const classes = cn("inline-flex items-center gap-1.5 border-b border-foreground/40 pb-0.5 text-[15px] font-medium outline-none hover:border-foreground focus-visible:border-foreground", className);
  return external
    ? <a href={href} target="_blank" rel="noreferrer" className={classes}>{children}</a>
    : <Link href={href} className={classes}>{children}</Link>;
}

export function SectionTitle({ id, children, className, as: Tag = "h2" }: { id?: string; children: ReactNode; className?: string; as?: "h1" | "h2" }) {
  return (
    // L'interligne vient après : une taille passée dans `className` l'effacerait sinon (tailwind-merge).
    <Tag id={id} className={cn("max-w-3xl text-[2rem] font-[450] tracking-[-0.035em] text-balance sm:text-[3.25rem]", className, !/\bleading-/.test(className ?? "") && "leading-[1.06]")}>
      {children}
    </Tag>
  );
}
export const LEAD = "max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg";

/** Traînées lumineuses : un dégradé flouté, zébré de fines lignes couleur papier. */
export function Streaks({ className, style, angle = 108 }: { className?: string; style?: CSSProperties; angle?: number }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute", className)} style={style}>
      <div className="absolute inset-0 blur-[18px]" style={{ backgroundImage: WARM, opacity: 0.85 }} />
      <div
        className="absolute inset-0"
        style={{ backgroundImage: `repeating-linear-gradient(${angle}deg, transparent 0 44px, color-mix(in oklch, var(--background) 88%, transparent) 44px 46px)` }}
      />
    </div>
  );
}

export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** Le texte, avec le logo eBay à la place du mot « eBay ». */
export function WithEbayLogo({ text }: { text: string }) {
  const parts = text.split("eBay");
  return <>{parts.map((part, i) => <span key={i}>{i > 0 && <EbayLogo />}{part}</span>)}</>;
}
