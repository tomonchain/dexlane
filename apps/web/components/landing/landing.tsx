import {
  ArrowRight, BadgeCheck, Check, Cloud, Download, Layers, Minus, Package, Plus, RefreshCw, Server, Sparkles,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { Logo } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import {
  AUDIENCE, CTA, FAQ, FEATURES, FINAL_CTA, FOOTER, FOUNDER, HERO, HERO_VARIANT, HERO_VARIANTS, LINKS, OPEN_SOURCE,
  PRICING, PROBLEM, STEPS, TESTIMONIALS, type FeatureIcon,
} from "./content";

/*
 * Mise en scène inspirée d'hoplite.sh, aux couleurs de Dexlane : titres fins et serrés, maquette du produit posée sur
 * des traînées lumineuses, panneau gris où des cartes blanches se répondent, bloc sombre texturé, icônes en tuiles,
 * grand logo en relief et bande lumineuse en pied de page. Les couleurs sont celles de l'application (papier chaud,
 * encre, orange du logo).
 */

const FEATURE_ICONS: Record<FeatureIcon, LucideIcon> = {
  bulk: Layers, compliant: BadgeCheck, sync: RefreshCw, lots: Package, suggest: Sparkles, data: Download,
};

/** Orange du logo et ses voisins : la seule couleur de marque, déclinée en dégradé. */
const ORANGE = "#f18a1f";
const WARM = `linear-gradient(100deg, transparent 0%, #ffd29a 22%, ${ORANGE} 48%, #c4521a 70%, #ffb86b 86%, transparent 100%)`;

/**
 * Élément « [À CONFIRMER] » du brief : en relecture (développement, preview), affiché avec un repère ; en production,
 * retiré tant qu'il n'est pas confirmé dans `content.ts`.
 */
function Pending({ confirmed, review, inline, compact, as, className, children }: {
  confirmed: boolean; review: boolean; inline?: boolean; as?: "li"; className?: string; children: ReactNode;
  /** Petit élément (lien, mention) : contour seul, sans étiquette. */
  compact?: boolean;
}) {
  const Tag = as ?? (inline ? "span" : "div");
  if (confirmed) return as ? <Tag className={className}>{children}</Tag> : <>{children}</>;
  if (!review) return null;
  return (
    <Tag
      data-pending
      title="À confirmer"
      className={cn("relative rounded-lg outline-2 outline-offset-4 outline-warning/70 outline-dashed", compact && "rounded outline-1 outline-offset-2", inline && "inline-block", className)}
    >
      {!compact && (
        <span className="absolute right-0 bottom-full z-10 mb-2 rounded bg-warning-soft px-1.5 py-px text-[10px] leading-4 font-semibold tracking-wide whitespace-nowrap text-warning uppercase">
          À confirmer
        </span>
      )}
      {children}
    </Tag>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/* ——— Boutons ——— */

const BUTTON = "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap outline-none transition-[transform,box-shadow,background-color] active:scale-[0.98] focus-visible:ring-[3px] focus-visible:ring-ring/40 [&_svg]:size-4 [&_svg]:shrink-0";
const SIZES = { md: "h-9 px-3.5 text-sm", lg: "h-12 px-5 text-[15px]" };
/** Encre pleine avec un léger relief, comme les boutons d'Hoplite. */
const INK = "bg-[linear-gradient(to_bottom,color-mix(in_oklch,var(--primary)_88%,white),var(--primary))] text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(0_0_0/0.25),0_4px_12px_-4px_rgb(0_0_0/0.3)] hover:brightness-110";
/** Papier : fond de carte, ombre douce, pas de bordure. */
const PAPER = "bg-card text-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.06),0_4px_12px_-6px_rgb(0_0_0/0.12)] hover:bg-accent";

function Cta({ href, children, tone = "ink", size = "lg", external, className }: {
  href: string; children: ReactNode; tone?: "ink" | "paper"; size?: keyof typeof SIZES; external?: boolean; className?: string;
}) {
  const classes = cn(BUTTON, SIZES[size], tone === "ink" ? INK : PAPER, className);
  return external
    ? <a href={href} target="_blank" rel="noreferrer" className={classes}>{children}</a>
    : <Link href={href} className={classes}>{children}</Link>;
}

/* ——— Typographie ——— */

function SectionTitle({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <h2 id={id} className={cn("max-w-3xl text-[2rem] leading-[1.06] font-[450] tracking-[-0.035em] text-balance sm:text-[3.25rem]", className)}>
      {children}
    </h2>
  );
}
const LEAD = "max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg";

/* ——— Décors ——— */

/** Traînées lumineuses : un dégradé flouté, zébré de fines lignes couleur papier. */
function Streaks({ className, style, angle = 108 }: { className?: string; style?: CSSProperties; angle?: number }) {
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
function Glow({ className }: { className?: string }) {
  return <div aria-hidden className={cn("pointer-events-none absolute rounded-full opacity-60 blur-3xl", className)} style={{ background: `radial-gradient(closest-side, ${ORANGE}, transparent)` }} />;
}

/** Tuile d'icône : carré bordé, comme les icônes des blocs d'Hoplite. */
function IconTile({ icon: Icon, dark }: { icon: ComponentType<{ className?: string }>; dark?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-xl",
        dark ? "bg-white/[0.06] text-white ring-1 ring-white/15" : "bg-card text-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.07),0_1px_2px_rgb(0_0_0/0.06)]",
      )}
    >
      <span aria-hidden className="contents"><Icon className="size-5" /></span>
    </span>
  );
}

/* ——— Maquette du produit ——— */

function WindowDots() {
  return (
    <span aria-hidden className="flex gap-1.5">
      <span className="size-3 rounded-full bg-[#ff5f57]" /><span className="size-3 rounded-full bg-[#febc2e]" /><span className="size-3 rounded-full bg-[#28c840]" />
    </span>
  );
}

/** Téléphone : bord blanc, îlot noir, l'écran Stock en vraie capture. */
function Phone({ className, priority }: { className?: string; priority?: boolean }) {
  return (
    <div className={cn("rounded-[2.4rem] bg-card p-2 shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_30px_60px_-20px_rgb(0_0_0/0.35)]", className)}>
      <div className="relative overflow-hidden rounded-[1.9rem] bg-background ring-1 ring-border">
        <div aria-hidden className="flex h-8 items-center justify-center"><span className="h-[18px] w-[34%] rounded-full bg-foreground" /></div>
        <Image src="/landing/stock-mobile.png" alt="L'écran Stock de Dexlane sur téléphone : des cartes en ligne, planifiées ou prêtes" width={824} height={1100} sizes="(min-width: 1024px) 280px, 80vw" priority={priority} className="h-auto w-full" />
      </div>
    </div>
  );
}

/** Capture réelle de l'écran Stock dans une fenêtre, avec le téléphone qui la chevauche (ordinateur) ; le téléphone seul sur mobile. */
function ProductShot() {
  return (
    <div className="relative">
      <Streaks className="-inset-x-[30vw] top-[12%] bottom-[-10%] [mask-image:linear-gradient(to_bottom,transparent,black_30%,black_65%,transparent)]" />
      <div className="relative mx-auto w-[82%] max-w-sm sm:hidden">
        <Phone priority />
      </div>
      <div className="relative hidden sm:block sm:pr-[12%] lg:pr-[14%]">
        <div className="overflow-hidden rounded-2xl bg-card p-1.5 shadow-[0_0_0_1px_rgb(0_0_0/0.07),0_40px_80px_-30px_rgb(0_0_0/0.35)]">
          <div className="flex items-center gap-3 px-3 pt-1.5 pb-2.5"><WindowDots /></div>
          <div className="overflow-hidden rounded-xl ring-1 ring-border">
            <Image src="/landing/stock-desktop.png" alt="L'écran Stock de Dexlane : des cartes en ligne, planifiées ou prêtes, avec leur prix et leur extension" width={2560} height={1440} sizes="(min-width: 1280px) 1060px, 90vw" priority className="h-auto w-full" />
          </div>
        </div>
        <Phone className="absolute right-0 -bottom-10 w-[24%] lg:w-[22%]" />
      </div>
    </div>
  );
}

/* ——— Vignettes abstraites de « Pour qui » : formes seulement, aucun visuel de marque. ——— */

function CardBack({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className={cn("block aspect-[63/88] rounded-[5px] border-[3px] border-card shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_4px_10px_-4px_rgb(0_0_0/0.25)]", className)}
      style={{ background: `linear-gradient(160deg, #f6a046, ${ORANGE} 45%, #b4501a)`, ...style }}
    />
  );
}

function BinderVignette() {
  const filled = [0, 1, 2, 4, 5, 7];
  return (
    <div className="grid w-[62%] grid-cols-3 gap-2 rounded-xl bg-card p-3 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_12px_30px_-12px_rgb(0_0_0/0.25)]">
      {Array.from({ length: 9 }, (_, i) => (
        filled.includes(i)
          ? <CardBack key={i} />
          : <span key={i} className="aspect-[63/88] rounded-[5px] border border-dashed border-foreground/15 bg-muted" />
      ))}
    </div>
  );
}

function RhythmVignette() {
  const bars = [38, 54, 46, 70, 62, 84, 78];
  return (
    <div className="grid w-[70%] gap-3 rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_12px_30px_-12px_rgb(0_0_0/0.25)]">
      <div className="flex h-24 items-end gap-2">
        {bars.map((h, i) => (
          <span key={i} className="flex-1 rounded-t-[3px]" style={{ height: `${h}%`, background: i === bars.length - 1 ? ORANGE : "color-mix(in oklch, var(--foreground) 14%, transparent)" }} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="h-2 w-1/3 rounded-full bg-foreground/15" />
        <span className="ml-auto flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-success"><Check className="size-3" aria-hidden /><span className="h-1.5 w-6 rounded-full bg-success/50" /></span>
      </div>
    </div>
  );
}

function ShopVignette() {
  return (
    <div className="relative h-36 w-[70%]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute bottom-0 w-[34%] rounded-md border-2 border-foreground/10 bg-card/70 p-1.5 shadow-[0_10px_24px_-12px_rgb(0_0_0/0.35)] backdrop-blur-[1px]"
          style={{ left: `${i * 30}%`, transform: `translateY(${-i * 10}px) rotate(${(i - 1) * 4}deg)` }}
        >
          <span className="mb-1 block h-1.5 rounded-full bg-foreground/10" />
          <CardBack className="border-[2px]" />
        </span>
      ))}
      <span className="absolute -top-1 right-0 flex -space-x-2">
        {["#f6a046", "#3f3a36", "#c4521a"].map((c) => <span key={c} className="size-7 rounded-full border-2 border-card" style={{ background: c }} />)}
      </span>
    </div>
  );
}
const AUDIENCE_VIGNETTES = [BinderVignette, RhythmVignette, ShopVignette];

/* ——— Page ——— */

/** Landing page publique, d'après le brief. `review` : affiche les éléments à confirmer avec leur repère. */
export function Landing({ review }: { review: boolean }) {
  const hero = HERO_VARIANTS[HERO_VARIANT];
  const showPricing = PRICING.confirmed || review;
  const footerLinks: { label: string; href: string | null; external?: boolean; show?: boolean }[] = [
    { label: "Tarifs", href: "#tarifs", show: showPricing },
    { label: "GitHub", href: LINKS.github, external: true },
    { label: "Contact", href: LINKS.email && `mailto:${LINKS.email}` },
    { label: "Mentions légales", href: LINKS.legal },
    { label: "CGU", href: LINKS.terms },
    { label: "Confidentialité", href: LINKS.privacy },
  ];

  return (
    <div lang="fr" className="overflow-x-clip">
      {/* En-tête collant, flouté. */}
      <header className="sticky top-0 z-40 border-b border-transparent bg-background/75 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:h-16 sm:px-8">
          <Link href="/" aria-label="Dexlane" className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"><Logo /></Link>
          <nav aria-label="Liens de la page" className="hidden items-center gap-5 text-sm text-muted-foreground sm:flex">
            {showPricing && <a href="#tarifs" className="outline-none hover:text-foreground focus-visible:text-foreground">Tarifs</a>}
            <a href={LINKS.github} target="_blank" rel="noreferrer" className="outline-none hover:text-foreground focus-visible:text-foreground">GitHub</a>
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <Link href="/login" className="rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30">Se connecter</Link>
            <Cta href={LINKS.signup} size="md" className="hidden sm:inline-flex">{CTA.primary}</Cta>
          </div>
        </div>
      </header>

      <main>
        {/* 1. Hero */}
        <section className="relative isolate mx-auto max-w-6xl px-4 pt-8 pb-20 sm:px-8 sm:pt-20 sm:pb-28" aria-labelledby="hero-title">
          <Streaks
            className="top-[14%] right-[-40vw] -z-10 hidden h-[72%] w-[90vw] sm:block [mask-image:radial-gradient(ellipse_48%_46%_at_58%_55%,black_30%,transparent_100%)]"
            angle={68}
          />
          <div className="grid justify-items-start gap-5 sm:gap-6">
            <p className="inline-flex items-center gap-2 rounded-md bg-card px-2.5 py-1 text-[13px] text-muted-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.07),0_1px_2px_rgb(0_0_0/0.05)]">
              <span aria-hidden className="size-3 rounded-[3px]" style={{ background: ORANGE }} />
              {HERO.eyebrow}
            </p>
            <Pending confirmed={hero.confirmed} review={review}>
              <h1 id="hero-title" className="max-w-4xl text-[2.45rem] leading-[1.02] font-[450] tracking-[-0.045em] text-balance sm:text-7xl">{hero.h1}</h1>
            </Pending>
            <p className={LEAD}>{HERO.subtitle}</p>
            <div className="grid w-full gap-2.5 sm:w-auto">
              <div className="grid gap-3 sm:flex sm:flex-wrap">
                <Cta href={LINKS.signup} className="w-full sm:w-auto">{CTA.primary} <ArrowRight /></Cta>
                <p className="-mt-0.5 text-[13px] text-muted-foreground max-sm:text-center sm:hidden">{HERO.underCta}</p>
                <Cta href={LINKS.github} tone="paper" external className="w-full sm:w-auto"><GitHubMark className="size-[18px]" /> {CTA.secondary}</Cta>
              </div>
              <p className="text-[13px] text-muted-foreground max-sm:hidden">{HERO.underCta}</p>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-muted-foreground max-sm:justify-center max-sm:self-stretch">
              {HERO.reassurance.map((item) => (
                <li key={item} className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-success" aria-hidden />{item}</li>
              ))}
            </ul>
          </div>
          <div className="mt-14 sm:mt-20">
            <ProductShot />
          </div>
        </section>

        {/* 2. Le problème */}
        <section className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-8 sm:py-28 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-20" aria-labelledby="probleme">
          <div className="grid content-start gap-6">
            <SectionTitle id="probleme">{PROBLEM.title}</SectionTitle>
            <p className={LEAD}>{PROBLEM.text}</p>
          </div>
          <ol className="grid content-start border-t">
            {PROBLEM.points.map((point, i) => (
              <li key={point.title} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-b py-6">
                <span className="tabular pt-0.5 font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-lg font-medium tracking-[-0.015em]">{point.title}</h3>
                <p className="col-start-2 text-[15px] leading-relaxed text-muted-foreground">{point.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* 3. Comment ça marche : un panneau gris où les trois étapes se répondent. */}
        <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-20 sm:px-8 sm:pb-28" aria-labelledby="etapes">
          <div className="grid justify-items-start gap-4">
            <SectionTitle id="etapes">{STEPS.title}</SectionTitle>
            <Link href={LINKS.signup} className="inline-flex items-center gap-1.5 border-b border-foreground/40 pb-0.5 text-[15px] font-medium outline-none hover:border-foreground focus-visible:border-foreground">
              {CTA.primary} <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="relative overflow-hidden rounded-2xl bg-muted px-4 py-10 ring-1 ring-border/60 sm:px-10 sm:py-14">
            <Streaks className="right-[-10%] bottom-[-35%] h-[70%] w-[75%] [mask-image:radial-gradient(closest-side,black,transparent)]" angle={100} />
            <ol className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)_3rem_minmax(0,1fr)] lg:gap-0">
              {STEPS.items.map((step, i) => (
                <StepItem key={step.title} index={i} title={step.title} text={step.text} last={i === STEPS.items.length - 1} />
              ))}
            </ol>
          </div>
        </section>

        {/* 4. Fonctionnalités : des tuiles d'icônes, sans cadre. */}
        <section className="border-y bg-card" aria-labelledby="fonctionnalites">
          <div className="mx-auto grid max-w-6xl gap-14 px-4 py-20 sm:px-8 sm:py-28">
            <SectionTitle id="fonctionnalites">{FEATURES.title}</SectionTitle>
            <ul className="grid gap-x-12 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.items.map((feature) => (
                <Pending key={feature.title} as="li" confirmed={feature.confirmed} review={review} className="grid">
                  <div className="grid content-start gap-3">
                    <IconTile icon={FEATURE_ICONS[feature.icon]} />
                    <h3 className="mt-2 text-lg font-medium tracking-[-0.015em]">{feature.title}</h3>
                    <p className="text-[15px] leading-relaxed text-muted-foreground">{feature.text}</p>
                  </div>
                </Pending>
              ))}
            </ul>
          </div>
        </section>

        {/* 5. Pour qui : trois panneaux illustrés, légende dessous. */}
        <section className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-8 sm:py-28" aria-labelledby="pour-qui">
          <SectionTitle id="pour-qui">{AUDIENCE.title}</SectionTitle>
          <ul className="grid gap-10 md:grid-cols-3 md:gap-4">
            {AUDIENCE.items.map((item, i) => {
              const Vignette = AUDIENCE_VIGNETTES[i]!;
              return (
                <li key={item.title} className="grid content-start gap-5">
                  <div aria-hidden className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-muted ring-1 ring-border/60">
                    {i === 2 && <Glow className="-right-10 -bottom-16 size-48" />}
                    <Vignette />
                  </div>
                  <div className="grid gap-2">
                    <h3 className="text-xl font-[450] tracking-[-0.02em]">{item.title}</h3>
                    <p className="text-[15px] leading-relaxed text-muted-foreground">{item.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* 6. Tarifs */}
        {showPricing && (
          <section id="tarifs" className="scroll-mt-16 border-y bg-card" aria-labelledby="tarifs-titre">
            <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-8 sm:py-28">
              <div className="grid gap-5">
                <SectionTitle id="tarifs-titre">{PRICING.title}</SectionTitle>
                <p className={LEAD}>{PRICING.subtitle}</p>
              </div>
              <Pending confirmed={PRICING.confirmed} review={review} className="rounded-2xl">
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {PRICING.plans.map((plan) => (
                    <li
                      key={plan.name}
                      data-testid={`plan-${plan.name}`}
                      className={cn(
                        "relative flex flex-col gap-5 rounded-2xl bg-background p-6 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.04)]",
                        plan.featured && "bg-card shadow-[0_0_0_1.5px_var(--foreground),0_24px_48px_-24px_rgb(0_0_0/0.35)]",
                      )}
                    >
                      {plan.featured && (
                        <span className="absolute -top-3 left-6 rounded-md bg-foreground px-2 py-0.5 text-xs font-medium text-background">{PRICING.featuredBadge}</span>
                      )}
                      <div className="grid gap-1">
                        <h3 className="text-lg font-medium tracking-[-0.015em]">{plan.name}</h3>
                        <p className="text-sm text-muted-foreground">{plan.pitch}</p>
                      </div>
                      <p className="text-[2rem] leading-none font-[450] tracking-[-0.03em]">{plan.price}</p>
                      <p className="grid gap-0.5 border-y py-3">
                        <span className="tabular text-xl font-[450] tracking-[-0.02em]">{plan.quota}</span>
                        <span className="text-[13px] text-muted-foreground">{PRICING.quotaLabel}</span>
                      </p>
                      <ul className="mb-1 grid gap-2 text-sm">
                        {PRICING.features.map((feature, i) => {
                          const included = i < plan.included;
                          return (
                            <li key={feature} className={cn("flex items-start gap-2", !included && "text-muted-foreground/70")}>
                              {included
                                ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Inclus" />
                                : <Minus className="mt-0.5 size-4 shrink-0" aria-label="Non inclus" />}
                              {feature}
                            </li>
                          );
                        })}
                      </ul>
                      <Cta href={LINKS.signup} size="md" tone={plan.featured ? "ink" : "paper"} className="mt-auto h-10 w-full">{plan.button}</Cta>
                    </li>
                  ))}
                </ul>
                <ul className="mt-8 grid gap-2 text-sm text-muted-foreground">
                  {PRICING.notes.map((note) => <li key={note} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0" aria-hidden />{note}</li>)}
                </ul>
              </Pending>
              <aside className="grid gap-4 rounded-2xl bg-muted p-6 ring-1 ring-border/60 sm:flex sm:items-center sm:justify-between sm:gap-8">
                <div className="flex gap-4">
                  <IconTile icon={Server} />
                  <div className="grid gap-1">
                    <h3 className="text-[15px] font-medium">{PRICING.selfHost.title}</h3>
                    <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{PRICING.selfHost.text}</p>
                  </div>
                </div>
                <a href={LINKS.github} target="_blank" rel="noreferrer" className="shrink-0 border-b border-foreground/40 pb-0.5 text-sm font-medium outline-none hover:border-foreground focus-visible:border-foreground max-sm:justify-self-start">
                  {PRICING.selfHost.link}
                </a>
              </aside>
            </div>
          </section>
        )}

        {/* 7. Open-source : le bloc sombre et texturé. */}
        <section className="px-4 py-20 sm:px-8 sm:py-28" aria-labelledby="open-source">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-[oklch(0.2_0.008_60)] px-6 py-14 text-[oklch(0.97_0.003_85)] ring-1 ring-white/10 sm:px-12 sm:py-20">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:linear-gradient(to_left,black,transparent_70%)]"
              style={{ backgroundImage: "radial-gradient(rgb(255 255 255 / 0.22) 1px, transparent 1.2px)", backgroundSize: "14px 14px" }}
            />
            <div aria-hidden className="pointer-events-none absolute -top-40 -right-40 size-[34rem] rounded-full border border-white/10">
              <div className="absolute inset-10 rounded-full border border-dashed border-white/10" />
              <div className="absolute inset-24 rounded-full border border-white/[0.07]" />
              <div className="absolute inset-0 rounded-full [mask-image:linear-gradient(to_top,black,transparent_35%)]" style={{ boxShadow: `inset 0 -2px 0 ${ORANGE}` }} />
            </div>
            <div className="relative grid gap-12">
              <div className="grid justify-items-start gap-6">
                <IconTile icon={GitHubTileIcon} dark />
                <SectionTitle id="open-source" className="text-[oklch(0.97_0.003_85)]">{OPEN_SOURCE.title}</SectionTitle>
                <p className="max-w-2xl text-base leading-relaxed text-white/65 sm:text-lg">{OPEN_SOURCE.text}</p>
              </div>
              <div className="grid gap-10 md:grid-cols-2">
                {OPEN_SOURCE.columns.map((column, i) => (
                  <div key={column.title} className="grid content-start gap-3">
                    <IconTile icon={i === 0 ? Cloud : Server} dark />
                    <h3 className="mt-2 text-lg font-medium tracking-[-0.015em]">{column.title}</h3>
                    <p className="max-w-md text-[15px] leading-relaxed text-white/65">{column.text}</p>
                  </div>
                ))}
              </div>
              <Pending confirmed={OPEN_SOURCE.licence.confirmed && !!OPEN_SOURCE.licence.name} review={review} compact className="justify-self-start">
                <p className="font-mono text-xs text-white/55">Licence {OPEN_SOURCE.licence.name ?? "[À CONFIRMER]"}</p>
              </Pending>
            </div>
          </div>
        </section>

        {/* 8. Fondateur */}
        <Pending confirmed={FOUNDER.confirmed} review={review} className="mx-4 rounded-2xl sm:mx-8">
          <section className="mx-auto grid max-w-3xl gap-8 px-4 pb-20 sm:px-8 sm:pb-28" aria-labelledby="fondateur">
            <SectionTitle id="fondateur">{FOUNDER.title}</SectionTitle>
            <p className="text-xl leading-relaxed font-[420] tracking-[-0.01em] sm:text-2xl sm:leading-relaxed">{FOUNDER.text}</p>
            <div className="flex items-center gap-3">
              <span aria-hidden className="flex size-10 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: `linear-gradient(140deg, #f6a046, ${ORANGE} 50%, #b4501a)` }}>T</span>
              <Pending confirmed={!!LINKS.email} review={review} inline compact>
                <a href={LINKS.email ? `mailto:${LINKS.email}` : undefined} className="border-b border-foreground/40 pb-0.5 text-sm font-medium outline-none hover:border-foreground focus-visible:border-foreground">
                  {FOUNDER.link}
                </a>
              </Pending>
            </div>
          </section>
        </Pending>

        {/* Témoignages : masqués tant qu'il n'y a pas de vraies citations. */}
        {TESTIMONIALS.items.length > 0 && (
          <section className="mx-auto grid max-w-6xl gap-12 px-4 pb-20 sm:px-8 sm:pb-28" aria-labelledby="temoignages">
            <SectionTitle id="temoignages">{TESTIMONIALS.title}</SectionTitle>
            <ul className="grid gap-4 md:grid-cols-3">
              {TESTIMONIALS.items.map((item) => (
                <li key={item.author}>
                  <figure className="grid h-full content-between gap-4 rounded-xl bg-card p-6 shadow-[0_0_0_1px_rgb(0_0_0/0.06)]">
                    <blockquote className="text-[15px] leading-relaxed">{item.quote}</blockquote>
                    <figcaption className="text-sm text-muted-foreground">{item.author}</figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 9. FAQ : le titre à gauche, les questions à droite, séparées par des filets. */}
        <section id="faq" className="mx-auto grid max-w-6xl gap-10 px-4 pb-20 sm:px-8 sm:pb-28 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16" aria-labelledby="faq-titre">
          <SectionTitle id="faq-titre" className="lg:sticky lg:top-24 lg:self-start">{FAQ.title}</SectionTitle>
          <div className="grid border-t">
            {FAQ.items.map((item) => (
              <Pending key={item.q} confirmed={item.confirmed} review={review} className="rounded-none">
                <details className="group border-b [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[17px] font-medium tracking-[-0.01em] outline-none focus-visible:underline">
                    {item.q}
                    <Plus className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45" aria-hidden />
                  </summary>
                  <p className="max-w-2xl pb-6 text-[15px] leading-relaxed text-muted-foreground">{item.a}</p>
                </details>
              </Pending>
            ))}
          </div>
        </section>

        {/* 10. CTA final : centré, sur une lueur. */}
        <section className="relative isolate overflow-hidden px-4 py-24 sm:px-8 sm:py-36" aria-labelledby="cta-final">
          <Glow className="top-1/2 left-1/2 -z-10 h-72 w-[42rem] -translate-x-1/2 -translate-y-1/2 opacity-30" />
          <div className="mx-auto grid max-w-4xl justify-items-center gap-6 text-center">
            <h2 id="cta-final" className="text-[2.3rem] leading-[1.04] font-[450] tracking-[-0.04em] text-balance sm:text-6xl">{FINAL_CTA.title}</h2>
            <p className={cn(LEAD, "text-center")}>{FINAL_CTA.subtitle}</p>
            <Cta href={LINKS.signup} className="mt-2 w-full sm:w-auto">{CTA.primary} <ArrowRight /></Cta>
            <Pending confirmed={FINAL_CTA.underCta.confirmed} review={review}>
              <p className="text-[13px] text-muted-foreground">{FINAL_CTA.underCta.text}</p>
            </Pending>
          </div>
        </section>
      </main>

      {/* 11. Pied de page : les liens, la mention légale, le nom en relief et la bande lumineuse. */}
      <footer className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 pt-12 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-6 border-t pt-10">
            <Logo />
            <nav aria-label="Liens du site">
              <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                {footerLinks.filter((l) => l.show !== false).map((l) => (
                  <li key={l.label}>
                    <Pending confirmed={!!l.href} review={review} inline compact>
                      <a
                        href={l.href ?? undefined}
                        {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
                        className="text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
                      >
                        {l.label}
                      </a>
                    </Pending>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{FOOTER.legalNotice}</p>
          <p
            aria-hidden
            className="pointer-events-none mt-6 text-center text-[24vw] leading-[0.8] font-semibold tracking-[-0.06em] text-[color-mix(in_oklch,var(--background)_95%,var(--foreground))] select-none lg:text-[17rem]"
            style={{ textShadow: "0 2px 1px rgb(255 255 255 / 0.95), 0 -1px 1px rgb(0 0 0 / 0.14)" }}
          >
            dexlane
          </p>
        </div>
        <div aria-hidden className="relative mt-4 h-24 sm:h-32">
          <Streaks className="inset-0 [mask-image:linear-gradient(to_bottom,transparent,black_55%)]" angle={72} />
        </div>
      </footer>
    </div>
  );
}

/** Le logo GitHub au format d'une icône Lucide, pour les tuiles. */
function GitHubTileIcon({ className }: { className?: string }) {
  return <GitHubMark className={className} />;
}

/** Une étape : carte blanche flottante avec son onglet numéroté ; sur ordinateur, reliée à la suivante par un trait coudé. */
function StepItem({ index, title, text, last }: { index: number; title: string; text: string; last: boolean }) {
  // La deuxième carte descend d'un cran : les traits coudés font le lien, comme sur le panneau d'Hoplite.
  const down = index === 1;
  return (
    <>
      <li className={cn("relative lg:h-56", down && "lg:mt-16")}>
        <div className="relative h-full rounded-xl bg-card p-6 pt-7 shadow-[0_0_0_1px_rgb(0_0_0/0.05),0_1px_2px_rgb(0_0_0/0.05),0_16px_32px_-16px_rgb(0_0_0/0.2)]">
          <span className="absolute -top-3 left-5 rounded-t-md rounded-b-sm bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.05)]">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h3 className="text-lg font-medium tracking-[-0.015em]">{title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{text}</p>
        </div>
      </li>
      {!last && (
        <li aria-hidden className="relative hidden lg:block">
          {/* Du milieu d'une carte au milieu de la suivante, décalée de 4 rem vers le bas (ou vers le haut). */}
          {index === 0 ? (
            <>
              <span className="absolute top-28 left-0 h-8 w-1/2 rounded-tr-lg border-t border-r border-foreground/20" />
              <span className="absolute top-36 right-0 h-8 w-1/2 rounded-bl-lg border-b border-l border-foreground/20" />
            </>
          ) : (
            <>
              <span className="absolute top-36 left-0 h-8 w-1/2 rounded-br-lg border-r border-b border-foreground/20" />
              <span className="absolute top-28 right-0 h-8 w-1/2 rounded-tl-lg border-t border-l border-foreground/20" />
            </>
          )}
        </li>
      )}
    </>
  );
}
