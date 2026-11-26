import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { LEAD, SectionTitle, TextLink } from "@/components/marketing/ui";
import { cn } from "@/lib/utils";
import { DOCS_HELP_LINKS, DOCS_INDEX, DOC_GROUPS, docNeighbours, type DocPage } from "./content";
import { DocBlocks } from "./prose";

/** Encadré « Une question sans réponse ici ? » en bas des docs. */
export function DocsHelp() {
  return (
    <aside className="grid gap-4 rounded-2xl bg-muted p-6 ring-1 ring-border/60 sm:flex sm:items-center sm:justify-between">
      <div className="grid gap-1">
        <h2 className="text-[15px] font-medium">{DOCS_INDEX.help.title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{DOCS_INDEX.help.text}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-5">
        <TextLink href="/contact" className="text-sm">{DOCS_INDEX.help.contact}</TextLink>
        <TextLink href={DOCS_HELP_LINKS.issues} external className="text-sm">{DOCS_INDEX.help.issues}</TextLink>
      </div>
    </aside>
  );
}

/** Une page de documentation : titre, chapeau, sommaire de la page (grand écran), sections, page précédente et suivante. */
export function DocArticle({ page }: { page: DocPage }) {
  const { previous, next } = docNeighbours(page.slug);
  const group = DOC_GROUPS.find((g) => g.id === page.group)!;
  return (
    <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_12rem] xl:gap-12">
      <article className="grid min-w-0 content-start gap-12">
        <header className="grid gap-4">
          <p className="text-[13px] font-medium text-muted-foreground">{group.title}</p>
          <SectionTitle as="h1" className="text-[2.1rem] sm:text-[2.75rem]">{page.title}</SectionTitle>
          <p className={LEAD}>{page.lead}</p>
        </header>
        {page.sections.map((section) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-titre`} className="grid scroll-mt-24 gap-5">
            <h2 id={`${section.id}-titre`} className="text-[1.45rem] leading-tight font-[450] tracking-[-0.025em]">
              <a href={`#${section.id}`} className="outline-none hover:underline hover:decoration-foreground/30 hover:underline-offset-4 focus-visible:underline">{section.title}</a>
            </h2>
            <DocBlocks blocks={section.blocks} />
          </section>
        ))}
        <nav aria-label={`${DOCS_INDEX.previous} / ${DOCS_INDEX.next}`} className="grid gap-3 border-t pt-8 sm:grid-cols-2">
          {previous ? <Neighbour href={`/docs/${previous.slug}`} label={DOCS_INDEX.previous} title={previous.title} /> : <span />}
          {next && <Neighbour href={`/docs/${next.slug}`} label={DOCS_INDEX.next} title={next.title} forward />}
        </nav>
        <DocsHelp />
      </article>
      {page.sections.length > 1 && (
        <nav aria-label={DOCS_INDEX.onThisPage} className="sticky top-24 hidden self-start xl:block">
          <p className="pb-3 text-xs font-medium">{DOCS_INDEX.onThisPage}</p>
          <ul className="grid gap-2 border-l text-[13px]">
            {page.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="-ml-px block border-l border-transparent pl-3 text-muted-foreground outline-none hover:border-foreground hover:text-foreground focus-visible:text-foreground">{section.title}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

function Neighbour({ href, label, title, forward }: { href: string; label: string; title: string; forward?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "group grid gap-1 rounded-xl p-4 shadow-[0_0_0_1px_rgb(0_0_0/0.07)] outline-none transition-shadow hover:shadow-[0_0_0_1px_rgb(0_0_0/0.14),0_8px_20px_-12px_rgb(0_0_0/0.3)] focus-visible:ring-[3px] focus-visible:ring-ring/30 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.1)]",
        forward && "text-right sm:col-start-2",
      )}
    >
      <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", forward && "justify-end")}>
        {!forward && <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" aria-hidden />}
        {label}
        {forward && <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />}
      </span>
      <span className="font-medium">{title}</span>
    </Link>
  );
}
