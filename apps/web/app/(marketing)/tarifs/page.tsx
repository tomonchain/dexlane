import { Server } from "lucide-react";
import { FAQ, PRICING, PRICING_FAQ, SEO } from "@/components/landing/content";
import { FaqList } from "@/components/landing/landing";
import { pageMetadata } from "@/components/marketing/metadata";
import { PlanGrid, PlanNotes } from "@/components/marketing/plans";
import { LEAD, SectionTitle, TextLink } from "@/components/marketing/ui";
import { GITHUB_URL } from "@/config/site";

export const dynamic = "force-static";
export const metadata = pageMetadata(SEO.tarifs, "/tarifs");

/** Tarifs : la grille complète (config/plans.ts), les trois lignes, l'encart auto-hébergement et la FAQ du prix. */
export default function PricingPage() {
  const faq = FAQ.items.filter((item) => PRICING_FAQ.includes(item.id));
  return (
    <div className="mx-auto grid max-w-6xl gap-14 px-4 pt-12 pb-20 sm:px-8 sm:pt-20 sm:pb-28">
      <header className="grid gap-5">
        <SectionTitle as="h1">{PRICING.title}</SectionTitle>
        <p className={LEAD}>{PRICING.subtitle}</p>
      </header>
      <section aria-label="Forfaits" className="grid gap-8">
        <PlanGrid detailed headingLevel={2} />
        <PlanNotes />
      </section>
      <aside className="grid gap-4 rounded-2xl bg-muted p-6 ring-1 ring-border/60 sm:flex sm:items-center sm:justify-between sm:gap-8">
        <div className="flex gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-card shadow-[0_0_0_1px_rgb(0_0_0/0.07)]"><Server className="size-5" aria-hidden /></span>
          <div className="grid gap-1">
            <h2 className="text-[15px] font-medium">{PRICING.selfHost.title}</h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{PRICING.selfHost.text}</p>
          </div>
        </div>
        <TextLink href={GITHUB_URL} external className="shrink-0 text-sm max-sm:justify-self-start">{PRICING.selfHost.link}</TextLink>
      </aside>
      <section aria-labelledby="faq-tarifs" className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <SectionTitle id="faq-tarifs" className="text-[1.75rem] sm:text-[2.5rem]">{FAQ.title}</SectionTitle>
        <FaqList items={faq} />
      </section>
    </div>
  );
}
