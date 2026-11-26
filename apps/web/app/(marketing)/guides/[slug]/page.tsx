import { notFound } from "next/navigation";
import { pageMetadata } from "@/components/marketing/metadata";
import { JsonLd, breadcrumb } from "@/components/marketing/structured-data";
import { SectionTitle } from "@/components/marketing/ui";
import { Crumbs, SellCta } from "@/components/series/ui";
import { SITE_URL } from "@/config/site";
import { formatGuideDate, getGuide, listGuides } from "@/lib/guides";

export const dynamic = "force-static";
/** Seuls les fichiers du dossier content/guides existent : une autre adresse sous /guides est une 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return listGuides().map((guide) => ({ slug: guide.slug }));
}

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const guide = getGuide((await params).slug);
  if (!guide) return {};
  const metadata = pageMetadata({ title: `${guide.title} — Dexlane`, description: guide.description }, `/guides/${guide.slug}`, { noindex: guide.draft });
  return {
    ...metadata,
    openGraph: { ...metadata.openGraph, type: "article", publishedTime: guide.date, modifiedTime: guide.updated ?? guide.date, authors: [guide.author] },
  };
}

export default async function GuidePage({ params }: Params) {
  const guide = getGuide((await params).slug);
  if (!guide) notFound();
  const path = `/guides/${guide.slug}`;
  const url = new URL(path, SITE_URL).toString();
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-4 pt-12 pb-20 sm:px-8 sm:pt-16 sm:pb-28">
      <JsonLd
        graph={[
          breadcrumb([{ name: "Dexlane", path: "/" }, { name: "Guides", path: "/guides" }, { name: guide.title, path }]),
          {
            "@type": "BlogPosting",
            "@id": `${url}#article`,
            headline: guide.title,
            description: guide.description,
            datePublished: guide.date,
            dateModified: guide.updated ?? guide.date,
            inLanguage: "fr-FR",
            url,
            mainEntityOfPage: url,
            author: { "@type": "Person", name: guide.author },
            publisher: { "@id": new URL("/#organisation", SITE_URL).toString() },
          },
        ]}
      />
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <article className="grid min-w-0 content-start gap-10">
          <header className="grid gap-5">
            <Crumbs items={[{ name: "Dexlane", href: "/" }, { name: "Guides", href: "/guides" }, { name: guide.title }]} />
            {guide.draft && (
              <p className="justify-self-start rounded-lg bg-amber-500/15 px-3 py-1.5 text-sm font-medium text-amber-800 dark:text-amber-200" data-testid="guide-draft">
                Brouillon : visible en préversion seulement, pas en production.
              </p>
            )}
            <SectionTitle as="h1">{guide.title}</SectionTitle>
            <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">{guide.description}</p>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>Par {guide.author}</span>
              <span aria-hidden>·</span>
              <time dateTime={guide.date}>Publié le {formatGuideDate(guide.date)}</time>
              {guide.updated && guide.updated !== guide.date && (
                <>
                  <span aria-hidden>·</span>
                  <time dateTime={guide.updated}>mis à jour le {formatGuideDate(guide.updated)}</time>
                </>
              )}
              <span aria-hidden>·</span>
              <span>{guide.readingMinutes} min de lecture</span>
            </p>
          </header>
          {/* Contenu écrit par l'équipe dans content/guides : du Markdown du dépôt, pas une saisie d'utilisateur. */}
          <div className="guide-prose max-w-[68ch]" data-testid="guide-body" dangerouslySetInnerHTML={{ __html: guide.html }} />
        </article>
        {guide.toc.length > 1 && (
          <nav aria-label="Sommaire du guide" className="hidden lg:block">
            <div className="sticky top-24 grid gap-3 text-sm">
              <p className="font-medium">Sommaire</p>
              <ol className="grid gap-2 text-muted-foreground">
                {guide.toc.map((item) => (
                  <li key={item.id}><a href={`#${item.id}`} className="hover:text-foreground">{item.title}</a></li>
                ))}
              </ol>
            </div>
          </nav>
        )}
      </div>
      <SellCta
        title="Vendre tes cartes sans y passer tes soirées"
        text="Dexlane reconnaît tes cartes au scan, fixe leur prix d'après les cotes et publie les annonces sur eBay à ta place."
      />
    </div>
  );
}
