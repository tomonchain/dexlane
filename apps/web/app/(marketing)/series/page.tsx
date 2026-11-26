import Link from "next/link";
import { pageMetadata } from "@/components/marketing/metadata";
import { JsonLd, breadcrumb } from "@/components/marketing/structured-data";
import { LEAD, SectionTitle } from "@/components/marketing/ui";
import { SERIES_PATH, formatRelease, setPath } from "@/components/series/format";
import { Crumbs, SellCta } from "@/components/series/ui";
import { SetLogo } from "@/components/set-logo";
import { publicSets } from "@/lib/public-catalog";

/** Cotes relevées chaque nuit : la page est recalculée une fois par jour au plus. */
export const revalidate = 86400;

const SEO = {
  title: "Séries et cotes des cartes Pokémon — Dexlane",
  description:
    "Toutes les séries de cartes Pokémon en français, de Wizards à Écarlate et Violet : liste des cartes, numéros, raretés et cote Cardmarket de chaque carte, mise à jour chaque jour.",
};
export const metadata = pageMetadata(SEO, SERIES_PATH);

/** Toutes les séries du catalogue, rangées par bloc, les plus récentes d'abord. */
export default async function SeriesIndexPage() {
  const sets = await publicSets();
  const blocks = new Map<string, typeof sets>();
  for (const set of sets) {
    const key = set.serieName ?? "Autres séries";
    blocks.set(key, [...(blocks.get(key) ?? []), set]);
  }
  return (
    <div className="mx-auto grid max-w-6xl gap-14 px-4 pt-12 pb-20 sm:px-8 sm:pt-16 sm:pb-28">
      <JsonLd graph={[breadcrumb([{ name: "Dexlane", path: "/" }, { name: "Séries", path: SERIES_PATH }])]} />
      <header className="grid gap-5">
        <Crumbs items={[{ name: "Dexlane", href: "/" }, { name: "Séries" }]} />
        <SectionTitle as="h1">Séries et cotes des cartes Pokémon</SectionTitle>
        <p className={LEAD}>
          {sets.length} séries en français, avec chaque carte, son numéro, sa rareté et sa cote Cardmarket du jour. Choisis
          une série pour voir ses cartes, puis une carte pour sa cote par variante et son évolution sur six mois.
        </p>
      </header>
      {[...blocks].map(([block, list]) => (
        <section key={block} aria-labelledby={`bloc-${list[0]!.id}`} className="grid gap-4">
          <h2 id={`bloc-${list[0]!.id}`} className="text-xl font-[450] tracking-[-0.02em]">{block}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="series-list">
            {list.map((set) => (
              <li key={set.id}>
                <Link
                  href={setPath(set)}
                  className="flex h-full items-center gap-4 rounded-xl bg-card p-4 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.04)] outline-none transition-shadow hover:shadow-[0_0_0_1px_rgb(0_0_0/0.12),0_12px_24px_-12px_rgb(0_0_0/0.25)] focus-visible:ring-[3px] focus-visible:ring-ring/30 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]"
                >
                  <SetLogo url={set.logoUrl} name={set.name} className="h-10 w-20" />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate font-medium">{set.name}</span>
                    <span className="text-[13px] text-muted-foreground">
                      {[set.code, formatRelease(set.releaseDate), `${set.cards} cartes`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <SellCta
        title="Tu as des cartes à vendre ?"
        text="Dexlane reconnaît tes cartes au scan, fixe leur prix d'après ces cotes et publie les annonces sur eBay à ta place."
      />
    </div>
  );
}
