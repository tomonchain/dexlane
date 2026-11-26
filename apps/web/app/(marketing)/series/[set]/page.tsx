import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { pageMetadata } from "@/components/marketing/metadata";
import { JsonLd, breadcrumb } from "@/components/marketing/structured-data";
import { LEAD, SectionTitle } from "@/components/marketing/ui";
import { PRICE_SOURCE, SERIES_PATH, cardImage, cardPath, formatDay, formatPrice, formatRelease, printedNumber, setPath } from "@/components/series/format";
import { CardPicture, Crumbs, SellCta } from "@/components/series/ui";
import { SetLogo } from "@/components/set-logo";
import { publicSet } from "@/lib/public-catalog";

export const revalidate = 86400;
/** Aucune série n'est rendue à la construction : chacune l'est à sa première visite, puis gardée en cache. */
export function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ set: string }> };

export async function generateMetadata({ params }: Params) {
  const found = await publicSet((await params).set);
  if (!found) return {};
  const { set } = found;
  const release = formatRelease(set.releaseDate);
  return pageMetadata(
    {
      title: `${set.name} (${set.code}) : liste des cartes et cotes — Dexlane`,
      description: `Les ${set.cards} cartes de la série Pokémon ${set.name}${set.serieName ? ` (${set.serieName})` : ""}${release ? `, sortie en ${release}` : ""} : numéros, raretés et cote Cardmarket de chaque carte, mise à jour chaque jour.`,
    },
    setPath(set),
  );
}

export default async function SetPage({ params }: Params) {
  const segment = (await params).set;
  const found = await publicSet(segment);
  if (!found) notFound();
  const { set, cards } = found;
  // Une seule adresse par série : un ancien nom ou une casse différente mènent à l'adresse actuelle.
  if (decodeURIComponent(segment) !== decodeURIComponent(setPath(set).slice(SERIES_PATH.length + 1))) permanentRedirect(setPath(set));

  const release = formatRelease(set.releaseDate);
  const priced = cards.filter((c) => c.fromCents !== null);
  const top = [...priced].sort((a, b) => b.fromCents! - a.fromCents!).slice(0, 3);
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-4 pt-12 pb-20 sm:px-8 sm:pt-16 sm:pb-28">
      <JsonLd graph={[breadcrumb([{ name: "Dexlane", path: "/" }, { name: "Séries", path: SERIES_PATH }, { name: set.name, path: setPath(set) }])]} />
      <header className="grid gap-5">
        <Crumbs items={[{ name: "Dexlane", href: "/" }, { name: "Séries", href: SERIES_PATH }, { name: set.name }]} />
        <div className="flex flex-wrap items-center gap-6">
          <SetLogo url={set.logoUrl} name={set.name} className="h-16 w-32" />
          <SectionTitle as="h1">{set.name}</SectionTitle>
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm" data-testid="set-facts">
          {set.serieName && <div><dt className="text-muted-foreground">Bloc</dt><dd className="font-medium">{set.serieName}</dd></div>}
          <div><dt className="text-muted-foreground">Code</dt><dd className="font-medium">{set.code}</dd></div>
          {release && <div><dt className="text-muted-foreground">Sortie</dt><dd className="font-medium">{release}</dd></div>}
          <div>
            <dt className="text-muted-foreground">Cartes</dt>
            <dd className="font-medium">{set.cardCountOfficial && set.cardCountTotal && set.cardCountTotal > set.cardCountOfficial ? `${set.cardCountOfficial} numérotées, ${set.cardCountTotal} en tout` : (set.cardCountTotal ?? set.cards)}</dd>
          </div>
        </dl>
        <p className={LEAD}>
          {set.name} compte {set.cards} cartes dans notre catalogue, dont {priced.length} avec une cote.
          {top.length > 0 && (
            <> Les plus chères aujourd&apos;hui : {top.map((c, i) => (
              <span key={c.localNumber}>{i > 0 && (i === top.length - 1 ? " et " : ", ")}{c.name} ({formatPrice(c.fromCents!)})</span>
            ))}.</>
          )}
        </p>
      </header>
      <section aria-labelledby="cartes" className="grid gap-4">
        <h2 id="cartes" className="text-xl font-[450] tracking-[-0.02em]">Cartes et cotes</h2>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" data-testid="set-cards">
          {cards.map((card) => (
            <li key={card.localNumber}>
              <Link href={cardPath(set, card)} className="group grid gap-2 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30">
                <CardPicture src={cardImage(card.imageUrl)} alt={`${card.name} ${printedNumber(card.localNumber, set.cardCountOfficial)}`} className="transition-transform group-hover:-translate-y-0.5" />
                <span className="grid gap-0.5 text-sm">
                  <span className="font-medium leading-snug group-hover:underline">{card.name}</span>
                  <span className="flex justify-between gap-2 text-[13px] text-muted-foreground">
                    <span className="font-mono">{printedNumber(card.localNumber, set.cardCountOfficial)}</span>
                    {card.fromCents !== null && <span className="tabular text-foreground">{formatPrice(card.fromCents)}</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          {PRICE_SOURCE} Prix « à partir de » : la plus basse des variantes.{set.updatedAt && ` Mis à jour le ${formatDay(set.updatedAt)}.`}
        </p>
      </section>
      <SellCta
        title={`Tu as des cartes de ${set.name} à vendre ?`}
        text="Scanne-les : Dexlane reconnaît chaque carte, propose un prix d'après sa cote et publie l'annonce sur eBay pour toi."
      />
    </div>
  );
}
