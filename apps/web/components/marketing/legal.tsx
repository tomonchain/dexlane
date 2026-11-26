import type { ReactNode } from "react";
import { SectionTitle } from "./ui";

/** Une rubrique de page légale : un titre, et des champs à renseigner ou un texte. */
export interface LegalSection {
  id: string;
  title: string;
  /** Champs (libellé : valeur). */
  fields?: { label: string; value: string }[];
  /** Texte libre, un paragraphe par entrée. */
  paragraphs?: string[];
}

/** Mise en page de texte long : largeur de lecture limitée, sommaire en haut, rubriques numérotées. */
export function LegalPage({ title, sections, intro }: { title: string; sections: LegalSection[]; intro?: ReactNode }) {
  return (
    <article className="mx-auto grid w-full max-w-[68ch] gap-10 px-4 pt-12 pb-20 sm:px-0 sm:pt-20 sm:pb-28">
      <header className="grid gap-5">
        <SectionTitle as="h1">{title}</SectionTitle>
        {intro}
      </header>
      <nav aria-labelledby="sommaire" className="rounded-xl bg-muted p-5 ring-1 ring-border/60">
        <h2 id="sommaire" className="text-sm font-medium">Sommaire</h2>
        <ol className="mt-3 grid gap-1.5 text-[15px]">
          {sections.map((section, i) => (
            <li key={section.id} className="flex gap-3">
              <span className="tabular w-5 shrink-0 font-mono text-xs leading-6 text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <a href={`#${section.id}`} className="text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline">
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {sections.map((section, i) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-titre`} className="grid scroll-mt-24 gap-4">
          <h2 id={`${section.id}-titre`} className="flex items-baseline gap-3 text-2xl font-[450] tracking-[-0.025em]">
            <span className="tabular font-mono text-sm text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            {section.title}
          </h2>
          {section.fields && (
            <dl className="grid gap-x-6 gap-y-2 border-t pt-4 text-[15px] leading-relaxed sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
              {section.fields.map((field) => (
                <div key={field.label} className="contents">
                  <dt className="text-muted-foreground">{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {section.paragraphs?.map((p, j) => <p key={j} className="text-[15px] leading-relaxed">{p}</p>)}
        </section>
      ))}
    </article>
  );
}
