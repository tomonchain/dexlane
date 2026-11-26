import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { pageMetadata } from "@/components/marketing/metadata";
import { JsonLd, breadcrumb } from "@/components/marketing/structured-data";
import { LEAD, SectionTitle } from "@/components/marketing/ui";
import { Crumbs, SellCta } from "@/components/series/ui";
import { formatGuideDate, listGuides, publishedGuides } from "@/lib/guides";

export const dynamic = "force-static";

const SEO = {
  title: "Guides pour vendre ses cartes Pokémon — Dexlane",
  description: "Nos guides pratiques pour vendre ses cartes Pokémon : fixer le bon prix, publier sur eBay, expédier sans casse, et tout ce qu'on a appris en vendant les nôtres.",
};
// Tant qu'aucun guide n'est publié, l'index reste hors des moteurs : une page vide n'apporte rien.
const base = pageMetadata(SEO, "/guides", { noindex: publishedGuides().length === 0 });
export const metadata = { ...base, alternates: { ...base.alternates, types: { "application/rss+xml": "/guides/rss.xml" } } };

/** Tous les guides, les plus récents d'abord. */
export default function GuidesIndexPage() {
  const guides = listGuides();
  return (
    <div className="mx-auto grid max-w-4xl gap-12 px-4 pt-12 pb-20 sm:px-8 sm:pt-16 sm:pb-28">
      <JsonLd graph={[breadcrumb([{ name: "Dexlane", path: "/" }, { name: "Guides", path: "/guides" }])]} />
      <header className="grid gap-5">
        <Crumbs items={[{ name: "Dexlane", href: "/" }, { name: "Guides" }]} />
        <SectionTitle as="h1">Guides</SectionTitle>
        <p className={LEAD}>Vendre ses cartes Pokémon, pas à pas : fixer le bon prix, publier, expédier. Ce qu&apos;on a appris en vendant les nôtres.</p>
      </header>
      {guides.length === 0 ? (
        <p className="text-muted-foreground" data-testid="guides-empty">Les premiers guides arrivent bientôt.</p>
      ) : (
        <ul className="grid border-t" data-testid="guides-list">
          {guides.map((guide) => (
            <li key={guide.slug} className="border-b">
              <Link
                href={`/guides/${guide.slug}`}
                className={`group grid gap-4 py-6 outline-none focus-visible:underline ${guide.image ? "sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6" : ""}`}
              >
                {guide.image && (
                  <span className="relative block aspect-[1200/630] overflow-hidden rounded-xl bg-muted ring-1 ring-border/60">
                    <Image src={guide.image.src} alt="" fill sizes="(min-width: 640px) 192px, 100vw" className="object-cover transition-transform group-hover:scale-[1.02]" />
                  </span>
                )}
                <span className="grid content-start gap-2">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                  <time dateTime={guide.updated ?? guide.date}>{formatGuideDate(guide.updated ?? guide.date)}</time>
                  <span aria-hidden>·</span>
                  <span>{guide.readingMinutes} min de lecture</span>
                  {guide.draft && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">Brouillon</span>}
                </span>
                <span className="flex items-start justify-between gap-6">
                  <span className="grid gap-1.5">
                    <span className="text-xl font-medium tracking-[-0.015em] group-hover:underline">{guide.title}</span>
                    <span className="leading-relaxed text-muted-foreground">{guide.description}</span>
                  </span>
                  <ArrowRight className="mt-1.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <SellCta
        title="Tu préfères qu'on le fasse pour toi ?"
        text="Dexlane reconnaît tes cartes au scan, fixe leur prix d'après les cotes et publie les annonces sur eBay à ta place."
      />
    </div>
  );
}
