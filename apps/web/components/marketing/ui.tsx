import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Briques visuelles du site marketing, partagées par la landing et les autres pages : boutons encre et papier,
 * titres fins, traînées lumineuses aux couleurs de Dexlane.
 */

/** Logo de Dexlane (le même que dans l'application), sans dépendre de l'en-tête de l'application. */
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

/** Orange du logo : la seule couleur de marque, déclinée en dégradé. */
export const ORANGE = "#f18a1f";
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
    <Tag id={id} className={cn("max-w-3xl text-[2rem] leading-[1.06] font-[450] tracking-[-0.035em] text-balance sm:text-[3.25rem]", className)}>
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

/** Lueur orange diffuse. */
export function Glow({ className }: { className?: string }) {
  return <div aria-hidden className={cn("pointer-events-none absolute rounded-full opacity-60 blur-3xl", className)} style={{ background: `radial-gradient(closest-side, ${ORANGE}, transparent)` }} />;
}

export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** Une vraie carte du set 151 (images du catalogue TCGdex, dans public/landing/cards). */
export function RealCard({ n, className, style, sizes = "120px" }: { n: string; className?: string; style?: CSSProperties; sizes?: string }) {
  return (
    <span aria-hidden className={cn("block overflow-hidden rounded-[4.5%/3.3%] shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_6px_14px_-6px_rgb(0_0_0/0.35)]", className)} style={style}>
      <Image src={`/landing/cards/${n}.webp`} alt="" width={360} height={495} sizes={sizes} className="block h-auto w-full" />
    </span>
  );
}

/** Le logo eBay officiel, posé sur la ligne de base du texte qui l'entoure. */
export function EbayLogo({ className }: { className?: string }) {
  return (
    <svg role="img" aria-label="eBay" viewBox="0 0 1000 400.75" className={cn("inline-block h-[0.9em] w-auto align-[-0.17em]", className)}>
      <path fill="#f12c2d" d="m199.64 185.87c-1.95-46.88-35.78-64.42-71.95-64.42-38.99 0-70.12 19.73-75.58 64.42zM51.03 219.19c2.71 45.48 34.07 72.38 77.2 72.38 29.88 0 56.46-12.17 65.36-38.66h51.68c-10.05 53.74-67.15 71.98-116.3 71.98C39.61 324.9 0 275.68 0 209.31 0 136.24 40.97 88.12 129.79 88.12c70.7 0 122.5 37 122.5 117.76v13.31z" />
      <path fill="#0968f6" d="m380.83 290.62c46.57 0 78.44-33.52 78.44-84.1 0-50.59-31.87-84.11-78.44-84.11-46.31 0-78.44 33.52-78.44 84.11 0 50.58 32.13 84.1 78.44 84.1zM252.29 0h50.1l-0.01 125.88c24.56-29.26 58.39-37.76 91.69-37.76 55.84 0 117.85 37.68 117.85 119.03 0 68.12-49.32 117.74-118.78 117.74-36.36 0-70.58-13.04-91.69-38.88 0 10.32-0.57 20.72-1.7 30.56h-49.17c0.85-15.91 1.71-35.72 1.71-51.75z" />
      <path fill="#ffbc13" d="m633.08 212.53c-45.44 1.49-73.67 9.69-73.67 39.62 0 19.38 15.45 40.38 54.66 40.38 52.58 0 80.64-28.66 80.64-75.66v-5.17c-18.43 0-41.16 0.16-61.63 0.83zm111.75 62.1c0 14.59 0.42 28.98 1.69 41.94h-46.61c-1.24-10.67-1.7-21.28-1.7-31.56-25.2 30.98-55.18 39.88-96.76 39.88-61.68 0-94.7-32.6-94.7-70.3 0-54.62 44.91-73.87 122.89-75.66 21.32-0.49 45.27-0.56 65.07-0.56v-5.33c0-36.56-23.44-51.6-64.07-51.6-30.15 0-52.38 12.49-54.67 34.05h-52.65c5.57-53.77 62.06-67.37 111.74-67.37 59.51 0 109.77 21.17 109.77 84.11z" />
      <path fill="#93c822" d="M1000 96.46 845.06 400.75h-57.11l44.55-84.49-116.61-219.8h58.63l85.8 171.73 85.56-171.73z" />
    </svg>
  );
}

/** Le texte, avec le logo eBay à la place du mot « eBay ». */
export function WithEbayLogo({ text }: { text: string }) {
  const parts = text.split("eBay");
  return <>{parts.map((part, i) => <span key={i}>{i > 0 && <EbayLogo />}{part}</span>)}</>;
}

/** Mise en page de texte long : largeur de lecture limitée. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[68ch] px-4 sm:px-0", className)}>{children}</div>;
}
