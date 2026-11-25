import {
  ArrowRight, BadgeCheck, Check, Cloud, Coins, Download, Layers, MapPin, Package, RefreshCw, Server, Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { PlanGrid } from "@/components/marketing/plans";
import { PhoneDemo, StockDemoDesktop } from "@/components/marketing/product-demo";
import { Cta, GitHubMark, Glow, LEAD, ORANGE, RealCard, SectionTitle, Streaks, TextLink, WithEbayLogo } from "@/components/marketing/ui";
import { CONTACT_EMAIL, GITHUB_URL, SIGNUP_URL } from "@/config/site";
import { cn } from "@/lib/utils";
import {
  AUDIENCE, CTA, FAQ, FEATURES, FINAL_CTA, FOUNDER, HERO, HERO_VARIANT, HERO_VARIANTS, OPEN_SOURCE, PRICING, PROBLEM,
  STEPS, TESTIMONIALS, type FeatureIcon,
} from "./content";

/*
 * Landing page, aux couleurs de Dexlane et dans l'esprit d'hoplite.sh : titres fins, démonstration du produit posée sur
 * des traînées lumineuses, panneau gris où les étapes se répondent, bloc sombre texturé, FAQ éditoriale.
 * L'en-tête et le pied de page sont ceux du layout marketing.
 */

const FEATURE_ICONS: Record<FeatureIcon, LucideIcon> = {
  bulk: Layers, compliant: BadgeCheck, sync: RefreshCw, lots: Package, suggest: Sparkles, data: Download, location: MapPin, margin: Coins,
};

/** Tuile d'icône : carré bordé. */
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

/* ——— Démonstration du produit ——— */

function WindowDots() {
  return (
    <span aria-hidden className="flex gap-1.5">
      <span className="size-3 rounded-full bg-[#ff5f57]" /><span className="size-3 rounded-full bg-[#febc2e]" /><span className="size-3 rounded-full bg-[#28c840]" />
    </span>
  );
}

/** L'écran Stock dans une fenêtre, avec le téléphone qui la chevauche (ordinateur) ; le téléphone seul sur mobile. */
function ProductShot() {
  return (
    <div className="relative" role="img" aria-label="Aperçu de l'écran Stock de Dexlane : des cartes en ligne sur eBay, planifiées ou prêtes, avec leur prix">
      <Streaks className="-inset-x-[30vw] top-[12%] bottom-[-10%] [mask-image:linear-gradient(to_bottom,transparent,black_30%,black_65%,transparent)]" />
      <div aria-hidden className="relative mx-auto w-[76%] max-w-xs sm:hidden">
        <PhoneDemo />
      </div>
      <div aria-hidden className="relative hidden sm:block sm:pr-[12%] lg:pr-[14%]">
        <div className="overflow-hidden rounded-2xl bg-card p-1.5 shadow-[0_0_0_1px_rgb(0_0_0/0.07),0_40px_80px_-30px_rgb(0_0_0/0.35)]">
          <div className="flex items-center gap-3 px-3 pt-1.5 pb-2.5"><WindowDots /></div>
          <div className="overflow-hidden rounded-xl ring-1 ring-border">
            <StockDemoDesktop />
          </div>
        </div>
        <PhoneDemo className="absolute right-0 -bottom-12 w-[25%] lg:w-[23%]" />
      </div>
    </div>
  );
}

/* ——— Vignettes de « Pour qui » : de vraies cartes en classeur et en étuis rigides. ——— */

function BinderVignette() {
  const filled: Partial<Record<number, string>> = { 0: "006", 1: "151", 2: "025", 4: "150", 5: "094", 7: "133" };
  return (
    <div className="grid w-[62%] grid-cols-3 gap-2 rounded-xl bg-card p-3 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_12px_30px_-12px_rgb(0_0_0/0.25)]">
      {Array.from({ length: 9 }, (_, i) => {
        const n = filled[i];
        return n
          ? <RealCard key={i} n={n} />
          : <span key={i} className="aspect-[63/88] rounded-[10%/7%] border border-dashed border-foreground/15 bg-muted" />;
      })}
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
  const cards = ["143", "149", "004"];
  return (
    <div className="relative h-36 w-[70%]">
      {cards.map((n, i) => (
        <span
          key={n}
          className="absolute bottom-0 w-[34%] rounded-md border-2 border-foreground/10 bg-card/70 p-1.5 shadow-[0_10px_24px_-12px_rgb(0_0_0/0.35)] backdrop-blur-[1px]"
          style={{ left: `${i * 30}%`, transform: `translateY(${-i * 10}px) rotate(${(i - 1) * 4}deg)` }}
        >
          <span className="mb-1 block h-1.5 rounded-full bg-foreground/10" />
          <RealCard n={n} />
        </span>
      ))}
      <span className="absolute -top-1 right-0 flex -space-x-2">
        {["#f6a046", "#3f3a36", "#c4521a"].map((c) => <span key={c} className="size-7 rounded-full border-2 border-card" style={{ background: c }} />)}
      </span>
    </div>
  );
}
const AUDIENCE_VIGNETTES = [BinderVignette, RhythmVignette, ShopVignette];

/** Une étape : carte blanche flottante avec son onglet numéroté ; sur ordinateur, reliée à la suivante par un trait coudé. */
function StepItem({ index, title, text, last }: { index: number; title: string; text: string; last: boolean }) {
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

/** Les trois étapes dans leur panneau gris (landing et page /colis). */
export function StepsPanel() {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-muted px-4 py-10 ring-1 ring-border/60 sm:px-10 sm:py-14">
      <Streaks className="right-[-10%] bottom-[-35%] h-[70%] w-[75%] [mask-image:radial-gradient(closest-side,black,transparent)]" angle={100} />
      <ol className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)_3rem_minmax(0,1fr)] lg:gap-0">
        {STEPS.items.map((step, i) => (
          <StepItem key={step.title} index={i} title={step.title} text={step.text} last={i === STEPS.items.length - 1} />
        ))}
      </ol>
    </div>
  );
}

/** Questions-réponses à filets (landing et /tarifs). */
export function FaqList({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="grid border-t">
      {items.map((item) => (
        <details key={item.q} className="group border-b [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[17px] font-medium tracking-[-0.01em] outline-none focus-visible:underline">
            {item.q}
            <span aria-hidden className="relative size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45">
              <span className="absolute top-1/2 left-0 h-px w-4 -translate-y-1/2 bg-current" />
              <span className="absolute top-0 left-1/2 h-4 w-px -translate-x-1/2 bg-current" />
            </span>
          </summary>
          <p className="max-w-2xl pb-6 text-[15px] leading-relaxed text-muted-foreground">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

/* ——— Page ——— */

/** Landing page publique, d'après le brief. */
export function Landing() {
  const hero = HERO_VARIANTS[HERO_VARIANT];

  return (
    <div className="overflow-x-clip">
      {/* 1. Hero */}
      <section id="accueil" className="relative isolate mx-auto max-w-6xl px-4 pt-8 pb-20 sm:px-8 sm:pt-20 sm:pb-28" aria-labelledby="hero-titre">
        <Streaks
          className="top-[14%] right-[-40vw] -z-10 hidden h-[72%] w-[90vw] sm:block [mask-image:radial-gradient(ellipse_48%_46%_at_58%_55%,black_30%,transparent_100%)]"
          angle={68}
        />
        <div className="grid justify-items-start gap-5 sm:gap-6">
          <p className="inline-flex items-center gap-2 rounded-md bg-card px-2.5 py-1 text-[13px] text-muted-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.07),0_1px_2px_rgb(0_0_0/0.05)]">
            <span aria-hidden className="size-3 rounded-[3px]" style={{ background: ORANGE }} />
            {HERO.eyebrow}
          </p>
          <h1 id="hero-titre" className="max-w-4xl text-[2.45rem] leading-[1.02] font-[450] tracking-[-0.045em] text-balance sm:text-7xl"><WithEbayLogo text={hero.h1} /></h1>
          <p className={LEAD}>{HERO.subtitle}</p>
          <div className="grid w-full gap-2.5 sm:w-auto">
            <div className="grid gap-3 sm:flex sm:flex-wrap">
              <Cta href={SIGNUP_URL} className="w-full sm:w-auto">{CTA.primary} <ArrowRight /></Cta>
              <p className="-mt-0.5 text-[13px] text-muted-foreground max-sm:text-center sm:hidden">{HERO.underCta}</p>
              <Cta href={GITHUB_URL} tone="paper" external className="w-full sm:w-auto"><GitHubMark className="size-[18px]" /> {CTA.secondary}</Cta>
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
      <section id="probleme" className="mx-auto grid max-w-6xl scroll-mt-20 gap-12 px-4 py-20 sm:px-8 sm:py-28 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-20" aria-labelledby="probleme-titre">
        <div className="grid content-start gap-6">
          <SectionTitle id="probleme-titre">{PROBLEM.title}</SectionTitle>
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

      {/* 3. Comment ça marche */}
      <section id="comment-ca-marche" className="mx-auto grid max-w-6xl scroll-mt-20 gap-10 px-4 pb-20 sm:px-8 sm:pb-28" aria-labelledby="etapes-titre">
        <div className="grid justify-items-start gap-4">
          <SectionTitle id="etapes-titre">{STEPS.title}</SectionTitle>
          <TextLink href={SIGNUP_URL}>{CTA.primary} <ArrowRight className="size-4" aria-hidden /></TextLink>
        </div>
        <StepsPanel />
      </section>

      {/* 4. Fonctionnalités */}
      <section id="fonctionnalites" className="scroll-mt-16 border-y bg-card" aria-labelledby="fonctionnalites-titre">
        <div className="mx-auto grid max-w-6xl gap-14 px-4 py-20 sm:px-8 sm:py-28">
          <SectionTitle id="fonctionnalites-titre">{FEATURES.title}</SectionTitle>
          <ul className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.items.map((feature) => (
              <li key={feature.title} className="grid content-start gap-3">
                <IconTile icon={FEATURE_ICONS[feature.icon]} />
                <h3 className="mt-2 text-lg font-medium tracking-[-0.015em]">{feature.title}</h3>
                <p className="text-[15px] leading-relaxed text-muted-foreground">{feature.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 5. Pour qui */}
      <section id="pour-qui" className="mx-auto grid max-w-6xl scroll-mt-20 gap-12 px-4 py-20 sm:px-8 sm:py-28" aria-labelledby="pour-qui-titre">
        <SectionTitle id="pour-qui-titre">{AUDIENCE.title}</SectionTitle>
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

      {/* 6. Tarifs : version courte, le détail est sur /tarifs. */}
      <section id="tarifs" className="scroll-mt-16 border-y bg-card" aria-labelledby="tarifs-titre">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-8 sm:py-28">
          <div className="grid gap-5">
            <SectionTitle id="tarifs-titre">{PRICING.title}</SectionTitle>
            <p className={LEAD}>{PRICING.subtitle}</p>
          </div>
          <PlanGrid />
          <TextLink href="/tarifs" className="justify-self-start">{PRICING.detailLink}</TextLink>
        </div>
      </section>

      {/* 7. Open-source : le bloc sombre et texturé. */}
      <section id="open-source" className="scroll-mt-16 px-4 py-20 sm:px-8 sm:py-28" aria-labelledby="open-source-titre">
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
              <IconTile icon={GitHubMark} dark />
              <SectionTitle id="open-source-titre" className="text-[oklch(0.97_0.003_85)]">{OPEN_SOURCE.title}</SectionTitle>
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
            <p className="font-mono text-xs text-white/55">{OPEN_SOURCE.licence}</p>
          </div>
        </div>
      </section>

      {/* 8. Fondateur */}
      <section id="fondateur" className="mx-auto grid max-w-3xl scroll-mt-20 gap-8 px-4 pb-20 sm:px-8 sm:pb-28" aria-labelledby="fondateur-titre">
        <SectionTitle id="fondateur-titre">{FOUNDER.title}</SectionTitle>
        <p className="text-xl leading-relaxed font-[420] tracking-[-0.01em] sm:text-2xl sm:leading-relaxed">{FOUNDER.text}</p>
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-10 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: `linear-gradient(140deg, #f6a046, ${ORANGE} 50%, #b4501a)` }}>T</span>
          <a href={`mailto:${CONTACT_EMAIL}`} className="border-b border-foreground/40 pb-0.5 text-sm font-medium outline-none hover:border-foreground focus-visible:border-foreground">
            {FOUNDER.link}
          </a>
        </div>
      </section>

      {/* Témoignages : masqués tant qu'il n'y a pas de vraies citations. */}
      {TESTIMONIALS.items.length > 0 && (
        <section id="temoignages" className="mx-auto grid max-w-6xl gap-12 px-4 pb-20 sm:px-8 sm:pb-28" aria-labelledby="temoignages-titre">
          <SectionTitle id="temoignages-titre">{TESTIMONIALS.title}</SectionTitle>
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

      {/* 9. FAQ */}
      <section id="faq" className="mx-auto grid max-w-6xl scroll-mt-20 gap-10 px-4 pb-20 sm:px-8 sm:pb-28 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16" aria-labelledby="faq-titre">
        <SectionTitle id="faq-titre" className="lg:sticky lg:top-24 lg:self-start">{FAQ.title}</SectionTitle>
        <FaqList items={FAQ.items} />
      </section>

      {/* 10. CTA final */}
      <section id="essayer" className="relative isolate overflow-hidden px-4 py-24 sm:px-8 sm:py-36" aria-labelledby="cta-final-titre">
        <Glow className="top-1/2 left-1/2 -z-10 h-72 w-[42rem] -translate-x-1/2 -translate-y-1/2 opacity-30" />
        <div className="mx-auto grid max-w-4xl justify-items-center gap-6 text-center">
          <div aria-hidden className="relative mb-4 h-36 w-64 sm:h-44 sm:w-80">
            {([["025", -14, -34], ["006", 0, 0], ["151", 14, 34]] as const).map(([n, r, x], i) => (
              <RealCard
                key={n}
                n={n}
                sizes="140px"
                className="absolute top-0 left-1/2 w-24 sm:w-28"
                style={{ transform: `translateX(calc(-50% + ${x}%)) rotate(${r}deg) translateY(${i === 1 ? -6 : 6}px)`, transformOrigin: "50% 120%", zIndex: i === 1 ? 2 : 1 }}
              />
            ))}
          </div>
          <h2 id="cta-final-titre" className="text-[2.3rem] leading-[1.04] font-[450] tracking-[-0.04em] text-balance sm:text-6xl">{FINAL_CTA.title}</h2>
          <p className={cn(LEAD, "text-center")}>{FINAL_CTA.subtitle}</p>
          <Cta href={SIGNUP_URL} className="mt-2 w-full sm:w-auto">{CTA.primary} <ArrowRight /></Cta>
          <p className="text-[13px] text-muted-foreground">{FINAL_CTA.underCta}</p>
        </div>
      </section>
    </div>
  );
}
