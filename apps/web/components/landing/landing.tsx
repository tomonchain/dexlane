import {
  ArrowRight, BadgeCheck, Check, ChevronDown, Download, Layers, Minus, Package, RefreshCw, Sparkles,
  Store, Library, Repeat, TrendingDown, TriangleAlert, Copy, type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AUDIENCE, CTA, FAQ, FEATURES, FINAL_CTA, FOOTER, FOUNDER, HERO, HERO_VARIANT, HERO_VARIANTS, LINKS, OPEN_SOURCE,
  PRICING, PROBLEM, STEPS, TESTIMONIALS, type FeatureIcon,
} from "./content";

const FEATURE_ICONS: Record<FeatureIcon, LucideIcon> = {
  bulk: Layers, compliant: BadgeCheck, sync: RefreshCw, lots: Package, suggest: Sparkles, data: Download,
};
const PROBLEM_ICONS = [Copy, TriangleAlert, TrendingDown];
const AUDIENCE_ICONS = [Library, Repeat, Store];

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
      {!compact && <span className="absolute right-0 bottom-full z-10 mb-2 rounded bg-warning-soft whitespace-nowrap px-1.5 py-px text-[10px] leading-4 font-semibold tracking-wide text-warning uppercase">
        À confirmer
      </span>}
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

function PrimaryCta({ className }: { className?: string }) {
  return (
    <Button asChild size="xl" className={className}>
      <Link href={LINKS.signup}>{CTA.primary} <ArrowRight /></Link>
    </Button>
  );
}

function SectionTitle({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return <h2 id={id} className={cn("max-w-3xl text-[1.75rem] leading-[1.15] font-semibold tracking-tight text-balance sm:text-4xl", className)}>{children}</h2>;
}

/** Capture réelle de l'écran Stock : version téléphone sur petit écran, version ordinateur au-delà. */
function ProductShot() {
  return (
    <figure className="relative mx-auto w-full max-w-5xl">
      <div aria-hidden className="absolute inset-x-8 -top-6 -bottom-6 -z-10 rounded-[2rem] bg-brand-soft blur-2xl sm:inset-x-16" />
      <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-black/10 sm:hidden">
        <Image src="/landing/stock-mobile.png" alt="L'écran Stock de Dexlane sur téléphone : des cartes en ligne, planifiées ou prêtes" width={824} height={1100} sizes="100vw" priority className="h-auto w-full" />
      </div>
      <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-black/10 sm:block">
        <div aria-hidden className="flex items-center gap-1.5 border-b bg-muted/60 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-border" /><span className="size-2.5 rounded-full bg-border" /><span className="size-2.5 rounded-full bg-border" />
        </div>
        <Image src="/landing/stock-desktop.png" alt="L'écran Stock de Dexlane : des cartes en ligne, planifiées ou prêtes, avec leur prix et leur extension" width={2560} height={1440} sizes="(min-width: 1024px) 1024px, 100vw" priority className="h-auto w-full" />
      </div>
    </figure>
  );
}

/** Dos de cartes génériques et étuis rigides : des formes abstraites, sans visuel de marque. */
function CardStack() {
  return (
    <div aria-hidden className="relative mx-auto h-44 w-56 sm:h-52 sm:w-64">
      {[-14, -5, 5].map((r, i) => (
        <span
          key={r}
          style={{ transform: `translateX(${(i - 1) * 34}px) rotate(${r}deg)` }}
          className="absolute inset-x-0 top-2 mx-auto aspect-[63/88] w-28 rounded-[10px] border-[5px] border-card bg-[linear-gradient(135deg,var(--brand)_0%,color-mix(in_oklch,var(--brand)_55%,var(--foreground))_100%)] shadow-lg ring-1 ring-border sm:w-32"
        >
          <span className="absolute inset-2 rounded-[5px] border border-white/30" />
          <span className="absolute inset-0 m-auto size-8 rounded-full border-2 border-white/40" />
        </span>
      ))}
      <span className="absolute right-0 bottom-0 aspect-[3/4] w-24 rotate-12 rounded-md border-2 border-foreground/15 bg-card/40 backdrop-blur-[2px] sm:w-28">
        <span className="absolute inset-x-0 top-0 h-3 rounded-t border-b-2 border-foreground/10" />
      </span>
    </div>
  );
}

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
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-8 sm:py-5">
        <Link href="/" aria-label="Dexlane" className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"><Logo /></Link>
        <Link href="/login" className="rounded-md px-2 py-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30">Se connecter</Link>
      </header>

      <main>
        {/* 1. Hero */}
        <section className="mx-auto grid max-w-6xl gap-12 px-4 pt-6 pb-16 sm:px-8 sm:pt-14 sm:pb-24" aria-labelledby="hero-title">
          <div className="grid justify-items-start gap-5 sm:justify-items-center sm:text-center">
            <p className="rounded-full border bg-card px-3 py-1 text-[13px] font-medium text-muted-foreground shadow-xs">{HERO.eyebrow}</p>
            <Pending confirmed={hero.confirmed} review={review}>
              <h1 id="hero-title" className="max-w-4xl text-[2.15rem] leading-[1.06] font-semibold tracking-tight text-balance sm:text-6xl">{hero.h1}</h1>
            </Pending>
            <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">{HERO.subtitle}</p>
            <div className="grid w-full gap-3 sm:flex sm:w-auto sm:flex-wrap sm:justify-center">
              <div className="grid gap-2 sm:justify-items-center">
                <PrimaryCta className="w-full sm:w-auto" />
                <p className="text-[13px] text-muted-foreground max-sm:text-center">{HERO.underCta}</p>
              </div>
              <Button asChild size="xl" variant="outline" className="w-full sm:w-auto">
                <a href={LINKS.github} target="_blank" rel="noreferrer"><GitHubMark className="size-5" /> {CTA.secondary}</a>
              </Button>
            </div>
            <ul className="flex w-full flex-wrap gap-x-4 gap-y-1.5 text-[13px] font-medium max-sm:justify-center sm:w-auto sm:gap-x-6">
              {HERO.reassurance.map((item) => (
                <li key={item} className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-success" aria-hidden />{item}</li>
              ))}
            </ul>
          </div>
          <ProductShot />
        </section>

        {/* 2. Le problème */}
        <section className="border-y bg-card" aria-labelledby="probleme">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-8 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-16">
            <div className="grid content-start gap-5">
              <SectionTitle id="probleme">{PROBLEM.title}</SectionTitle>
              <p className="text-base leading-relaxed text-muted-foreground">{PROBLEM.text}</p>
            </div>
            <ul className="grid gap-3">
              {PROBLEM.points.map((point, i) => {
                const Icon = PROBLEM_ICONS[i]!;
                return (
                  <li key={point.title} className="flex gap-4 rounded-xl border bg-background p-5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive-soft text-destructive"><Icon className="size-[18px]" aria-hidden /></span>
                    <span className="grid gap-1">
                      <h3 className="text-[15px] font-semibold">{point.title}</h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">{point.text}</p>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* 3. Comment ça marche */}
        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-8 sm:py-24" aria-labelledby="etapes">
          <SectionTitle id="etapes">{STEPS.title}</SectionTitle>
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.items.map((step, i) => (
              <li key={step.title} className="relative grid content-start gap-3 rounded-xl border bg-card p-6 shadow-xs">
                <span className="tabular flex size-9 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background">{i + 1}</span>
                <h3 className="text-lg font-semibold tracking-tight">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.text}</p>
              </li>
            ))}
          </ol>
          <PrimaryCta className="w-full justify-self-start sm:w-auto" />
        </section>

        {/* 4. Fonctionnalités */}
        <section className="bg-muted/50" aria-labelledby="fonctionnalites">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-8 sm:py-24">
            <SectionTitle id="fonctionnalites">{FEATURES.title}</SectionTitle>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.items.map((feature) => {
                const Icon = FEATURE_ICONS[feature.icon];
                return (
                  <Pending key={feature.title} as="li" confirmed={feature.confirmed} review={review} className="grid rounded-xl">
                    <div className="grid h-full content-start gap-3 rounded-xl border bg-card p-6">
                      <span className="flex size-10 items-center justify-center rounded-lg bg-brand-soft text-primary"><Icon className="size-5" aria-hidden /></span>
                      <h3 className="text-[15px] font-semibold">{feature.title}</h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">{feature.text}</p>
                    </div>
                  </Pending>
                );
              })}
            </ul>
          </div>
        </section>

        {/* 5. Pour qui */}
        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-8 sm:py-24" aria-labelledby="pour-qui">
          <SectionTitle id="pour-qui">{AUDIENCE.title}</SectionTitle>
          <ul className="grid gap-x-10 gap-y-8 md:grid-cols-3">
            {AUDIENCE.items.map((item, i) => {
              const Icon = AUDIENCE_ICONS[i]!;
              return (
                <li key={item.title} className="grid content-start gap-2 border-t pt-6">
                  <Icon className="size-5 text-muted-foreground" aria-hidden />
                  <h3 className="mt-1 text-lg font-semibold tracking-tight">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{item.text}</p>
                </li>
              );
            })}
          </ul>
        </section>

        {/* 6. Tarifs */}
        {showPricing && (
          <section id="tarifs" className="scroll-mt-4 border-y bg-card" aria-labelledby="tarifs-titre">
            <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-8 sm:py-24">
              <div className="grid gap-4">
                <SectionTitle id="tarifs-titre">{PRICING.title}</SectionTitle>
                <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">{PRICING.subtitle}</p>
              </div>
              <Pending confirmed={PRICING.confirmed} review={review} className="rounded-2xl">
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {PRICING.plans.map((plan) => (
                    <li
                      key={plan.name}
                      data-testid={`plan-${plan.name}`}
                      className={cn("relative flex flex-col gap-5 rounded-2xl border bg-background p-6", plan.featured && "border-transparent bg-card ring-2 ring-primary shadow-lg")}
                    >
                      {plan.featured && (
                        <span className="absolute -top-3 left-6 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">{PRICING.featuredBadge}</span>
                      )}
                      <div className="grid gap-1">
                        <h3 className="text-lg font-semibold tracking-tight">{plan.name}</h3>
                        <p className="text-sm text-muted-foreground">{plan.pitch}</p>
                      </div>
                      <p className="text-3xl font-semibold tracking-tight">{plan.price}</p>
                      <p className="grid gap-0.5 border-y py-3">
                        <span className="tabular text-xl font-semibold">{plan.quota}</span>
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
                      <Button asChild size="lg" variant={plan.featured ? "default" : "outline"} className="mt-auto w-full">
                        <Link href={LINKS.signup}>{plan.button}</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
                <ul className="mt-8 grid gap-2 text-sm text-muted-foreground">
                  {PRICING.notes.map((note) => <li key={note} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />{note}</li>)}
                </ul>
              </Pending>
              <aside className="grid gap-3 rounded-2xl border border-dashed bg-background p-6 sm:flex sm:items-center sm:justify-between sm:gap-8">
                <div className="grid gap-1">
                  <h3 className="text-[15px] font-semibold">{PRICING.selfHost.title}</h3>
                  <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{PRICING.selfHost.text}</p>
                </div>
                <a href={LINKS.github} target="_blank" rel="noreferrer" className="shrink-0 text-sm font-semibold underline-offset-4 outline-none hover:underline focus-visible:underline">
                  {PRICING.selfHost.link}
                </a>
              </aside>
            </div>
          </section>
        )}

        {/* 7. Open-source */}
        <section className="bg-muted/50" aria-labelledby="open-source">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-8 sm:py-24">
            <div className="grid gap-5">
              <GitHubMark className="size-7" />
              <SectionTitle id="open-source">{OPEN_SOURCE.title}</SectionTitle>
              <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">{OPEN_SOURCE.text}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {OPEN_SOURCE.columns.map((column) => (
                <div key={column.title} className="grid content-start gap-2 rounded-xl border bg-card p-6">
                  <h3 className="text-lg font-semibold tracking-tight">{column.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{column.text}</p>
                </div>
              ))}
            </div>
            <Pending confirmed={OPEN_SOURCE.licence.confirmed && !!OPEN_SOURCE.licence.name} review={review} compact className="justify-self-start">
              <p className="text-sm text-muted-foreground">Licence {OPEN_SOURCE.licence.name ?? "[À CONFIRMER]"}</p>
            </Pending>
          </div>
        </section>

        {/* 8. Fondateur */}
        <Pending confirmed={FOUNDER.confirmed} review={review} className="mx-4 rounded-2xl sm:mx-8">
          <section className="border-y bg-card" aria-labelledby="fondateur">
            <div className="mx-auto grid max-w-3xl gap-5 px-4 py-16 sm:px-8 sm:py-24">
              <SectionTitle id="fondateur">{FOUNDER.title}</SectionTitle>
              <p className="text-lg leading-relaxed">{FOUNDER.text}</p>
              <Pending confirmed={!!LINKS.email} review={review} inline compact className="justify-self-start">
                <a href={LINKS.email ? `mailto:${LINKS.email}` : undefined} className="text-sm font-semibold underline-offset-4 outline-none hover:underline focus-visible:underline">
                  {FOUNDER.link}
                </a>
              </Pending>
            </div>
          </section>
        </Pending>

        {/* Témoignages : masqués tant qu'il n'y a pas de vraies citations. */}
        {TESTIMONIALS.items.length > 0 && (
          <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-8 sm:py-24" aria-labelledby="temoignages">
            <SectionTitle id="temoignages">{TESTIMONIALS.title}</SectionTitle>
            <ul className="grid gap-4 md:grid-cols-3">
              {TESTIMONIALS.items.map((item) => (
                <li key={item.author}>
                  <figure className="grid h-full content-between gap-4 rounded-xl border bg-card p-6">
                    <blockquote className="text-[15px] leading-relaxed">{item.quote}</blockquote>
                    <figcaption className="text-sm text-muted-foreground">{item.author}</figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 9. FAQ */}
        <section id="faq" className="mx-auto grid max-w-3xl gap-8 px-4 py-16 sm:px-8 sm:py-24" aria-labelledby="faq-titre">
          <SectionTitle id="faq-titre">{FAQ.title}</SectionTitle>
          <div className="grid gap-3">
            {FAQ.items.map((item) => (
              <Pending key={item.q} confirmed={item.confirmed} review={review} className="rounded-xl">
                <details className="group rounded-xl border bg-card [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-4 text-[15px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30">
                    {item.q}
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
                </details>
              </Pending>
            ))}
          </div>
        </section>

        {/* 10. CTA final */}
        <section className="px-4 pb-16 sm:px-8 sm:pb-24" aria-labelledby="cta-final">
          <div className="mx-auto grid max-w-6xl items-center gap-10 overflow-hidden rounded-3xl bg-foreground px-6 py-14 text-background sm:px-12 sm:py-20 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="grid justify-items-start gap-5">
              <h2 id="cta-final" className="text-[1.75rem] leading-[1.15] font-semibold tracking-tight text-balance sm:text-4xl">{FINAL_CTA.title}</h2>
              <p className="max-w-lg text-base leading-relaxed text-background/70">{FINAL_CTA.subtitle}</p>
              <Button asChild size="xl" className="w-full bg-background text-foreground hover:bg-background/90 sm:w-auto">
                <Link href={LINKS.signup}>{CTA.primary} <ArrowRight /></Link>
              </Button>
              <Pending confirmed={FINAL_CTA.underCta.confirmed} review={review}>
                <p className="text-[13px] text-background/70">{FINAL_CTA.underCta.text}</p>
              </Pending>
            </div>
            <CardStack />
          </div>
        </section>
      </main>

      {/* 11. Pied de page */}
      <footer className="border-t">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Logo />
            <nav aria-label="Liens du site">
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {footerLinks.filter((l) => l.show !== false).map((l) => (
                  <li key={l.label}>
                    <Pending confirmed={!!l.href} review={review} inline compact>
                      <a
                        href={l.href ?? undefined}
                        {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
                        className="text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:underline"
                      >
                        {l.label}
                      </a>
                    </Pending>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">{FOOTER.legalNotice}</p>
        </div>
      </footer>
    </div>
  );
}
