import { ArrowRight, Cloud, Server } from "lucide-react";
import Link from "next/link";
import { DOCS_INDEX, DOC_GROUPS, DOC_PAGES } from "@/components/docs/content";
import { DocsHelp } from "@/components/docs/page";
import { pageMetadata } from "@/components/marketing/metadata";
import { LEAD, SectionTitle } from "@/components/marketing/ui";

export const dynamic = "force-static";
export const metadata = pageMetadata(DOCS_INDEX.seo, "/docs");

const CARD = "group flex h-full items-start gap-4 rounded-2xl bg-card p-5 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.04)] outline-none transition-shadow hover:shadow-[0_0_0_1px_rgb(0_0_0/0.12),0_12px_24px_-12px_rgb(0_0_0/0.25)] focus-visible:ring-[3px] focus-visible:ring-ring/30 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]";

/** Accueil des docs : les deux points d'entrée (hébergée, Community), puis toutes les pages par groupe. */
export default function DocsIndexPage() {
  const entries = [
    { page: DOC_PAGES.find((p) => p.slug === "demarrer")!, icon: Cloud },
    { page: DOC_PAGES.find((p) => p.slug === "community")!, icon: Server },
  ];
  return (
    <div className="grid gap-14">
      <header className="grid gap-5">
        <SectionTitle as="h1">{DOCS_INDEX.title}</SectionTitle>
        <p className={LEAD}>{DOCS_INDEX.lead}</p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2">
        {entries.map(({ page, icon: Icon }) => (
          <li key={page.slug}>
            <Link href={`/docs/${page.slug}`} className={CARD}>
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted"><Icon className="size-5" aria-hidden /></span>
              <span className="grid flex-1 gap-1.5">
                <span className="text-lg font-medium tracking-[-0.015em]">{page.title}</span>
                <span className="text-sm leading-relaxed text-muted-foreground">{page.lead}</span>
              </span>
              <ArrowRight className="mt-1.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {DOC_GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`groupe-${group.id}`} className="grid gap-4">
          <h2 id={`groupe-${group.id}`} className="text-xl font-[450] tracking-[-0.02em]">{group.title}</h2>
          <ul className="grid border-t">
            {DOC_PAGES.filter((p) => p.group === group.id).map((page) => (
              <li key={page.slug} className="border-b">
                <Link href={`/docs/${page.slug}`} className="group grid gap-1 py-4 outline-none focus-visible:underline sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_1rem] sm:items-baseline sm:gap-6">
                  <span className="font-medium">{page.title}</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">{page.lead}</span>
                  <ArrowRight className="hidden size-4 self-center text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <DocsHelp />
    </div>
  );
}
