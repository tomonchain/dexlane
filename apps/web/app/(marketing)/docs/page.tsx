import { ArrowUpRight, Cloud, Server } from "lucide-react";
import { DOCS, SEO } from "@/components/landing/content";
import { pageMetadata } from "@/components/marketing/metadata";
import { SectionTitle } from "@/components/marketing/ui";
import { README_URL } from "@/config/site";

export const dynamic = "force-static";
export const metadata = pageMetadata(SEO.docs, "/docs");

const ICONS = [Cloud, Server];

/** Docs : deux entrées, qui pointent pour l'instant vers le README du dépôt. */
export default function DocsPage() {
  return (
    <div className="mx-auto grid max-w-4xl gap-10 px-4 pt-12 pb-20 sm:px-8 sm:pt-20 sm:pb-28">
      <SectionTitle as="h1">{DOCS.title}</SectionTitle>
      <ul className="grid gap-4 sm:grid-cols-2">
        {DOCS.entries.map((entry, i) => {
          const Icon = ICONS[i]!;
          return (
            <li key={entry}>
              <a
                href={README_URL}
                target="_blank"
                rel="noreferrer"
                className="group flex h-full items-start gap-4 rounded-2xl bg-card p-6 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.04)] outline-none transition-shadow hover:shadow-[0_0_0_1px_rgb(0_0_0/0.12),0_12px_24px_-12px_rgb(0_0_0/0.25)] focus-visible:ring-[3px] focus-visible:ring-ring/30"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted"><Icon className="size-5" aria-hidden /></span>
                <h2 className="flex-1 pt-2.5 text-lg font-medium tracking-[-0.015em]">{entry}</h2>
                <ArrowUpRight className="mt-3 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
