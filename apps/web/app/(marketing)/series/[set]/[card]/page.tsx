import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { PublicCard } from "@dexlane/catalog";
import { pageMetadata } from "@/components/marketing/metadata";
import { JsonLd, breadcrumb } from "@/components/marketing/structured-data";
import { SectionTitle } from "@/components/marketing/ui";
import { PRICE_SOURCE, SERIES_PATH, cardImage, cardPath, formatDay, formatPrice, formatRelease, printedNumber, setPath, variantName } from "@/components/series/format";
import { CardPicture, Crumbs, SellCta, Sparkline } from "@/components/series/ui";
import { publicCard } from "@/lib/public-catalog";

export const revalidate = 86400;
/** Aucune carte n'est rendue à la construction : chacune l'est à sa première visite, puis gardée en cache. */
export function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ set: string; card: string }> };

/** La cote la plus haute et la plus basse des variantes cotées, pour le titre et le résumé. */
function priceRange(card: PublicCard) {
  const prices = card.variants.flatMap((v) => (v.price ? [v.price] : []));
  if (prices.length === 0) return null;
  const cents = prices.map((p) => p.trendCents);
  const latest = prices.reduce((a, b) => (a.observedAt > b.observedAt ? a : b)).observedAt;
  return { min: Math.min(...cents), max: Math.max(...cents), latest };
}

const priceText = (range: { min: number; max: number }) =>
  range.min === range.max ? formatPrice(range.min) : `de ${formatPrice(range.min)} à ${formatPrice(range.max)}`;

export async function generateMetadata({ params }: Params) {
  const { set: setSegment, card: cardSegment } = await params;
  const card = await publicCard(setSegment, cardSegment);
  if (!card) return {};
  const number = printedNumber(card.localNumber, card.set.cardCountOfficial);
  const range = priceRange(card);
  return pageMetadata(
    {
      title: `${card.name} ${number} ${card.set.name} : cote et prix — Dexlane`,
      description: range
        ? `Cote de ${card.name} (${card.set.name}, ${number}) : ${priceText(range)} au ${formatDay(range.latest)}, par variante, avec son évolution sur six mois. Vends la tienne sur eBay avec Dexlane.`
        : `${card.name} (${card.set.name}, ${number}) : rareté, variantes et visuel. Vends la tienne sur eBay avec Dexlane.`,
    },
    cardPath(card.set, card),
    // Sans cote, la page n'apporte rien de plus que celle de la série : elle reste hors des moteurs.
    { noindex: !range },
  );
}

export default async function CardPage({ params }: Params) {
  const { set: setSegment, card: cardSegment } = await params;
  const card = await publicCard(setSegment, cardSegment);
  if (!card) notFound();
  const path = cardPath(card.set, card);
  if (decodeURIComponent(`${setSegment}/${cardSegment}`) !== decodeURIComponent(path.slice(SERIES_PATH.length + 1))) permanentRedirect(path);

  const { set } = card;
  const number = printedNumber(card.localNumber, set.cardCountOfficial);
  const range = priceRange(card);
  const release = formatRelease(set.releaseDate);
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-4 pt-12 pb-20 sm:px-8 sm:pt-16 sm:pb-28">
      <JsonLd
        graph={[breadcrumb([
          { name: "Dexlane", path: "/" },
          { name: "Séries", path: SERIES_PATH },
          { name: set.name, path: setPath(set) },
          { name: `${card.name} ${number}`, path },
        ])]}
      />
      <Crumbs items={[{ name: "Dexlane", href: "/" }, { name: "Séries", href: SERIES_PATH }, { name: set.name, href: setPath(set) }, { name: `${card.name} ${number}` }]} />
      <div className="grid gap-10 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:gap-14">
        <CardPicture src={cardImage(card.imageUrl, "high")} alt={`Carte Pokémon ${card.name} ${number}, série ${set.name}`} eager className="mx-auto w-full max-w-72 shadow-xl shadow-black/10 md:max-w-none" />
        <div className="grid content-start gap-8">
          <header className="grid gap-4">
            <SectionTitle as="h1">{card.name} <span className="font-mono text-[0.6em] font-normal text-muted-foreground">{number}</span></SectionTitle>
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg" data-testid="card-summary">
              {range ? (
                <>
                  La carte {card.name} de la série {set.name} ({number}) est cotée <strong className="font-medium text-foreground">{priceText(range)}</strong> sur
                  Cardmarket au {formatDay(range.latest)}, selon la variante.
                </>
              ) : (
                <>La carte {card.name} de la série {set.name} ({number}) n&apos;a pas encore de cote.</>
              )}
            </p>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Série</dt><dd><Link href={setPath(set)} className="font-medium underline-offset-4 hover:underline">{set.name}</Link></dd></div>
              {set.serieName && <div><dt className="text-muted-foreground">Bloc</dt><dd className="font-medium">{set.serieName}</dd></div>}
              <div><dt className="text-muted-foreground">Numéro</dt><dd className="font-mono font-medium">{number}</dd></div>
              {card.rarity && <div><dt className="text-muted-foreground">Rareté</dt><dd className="font-medium">{card.rarity}</dd></div>}
              {card.category && <div><dt className="text-muted-foreground">Catégorie</dt><dd className="font-medium">{card.category}</dd></div>}
              {release && <div><dt className="text-muted-foreground">Sortie</dt><dd className="font-medium">{release}</dd></div>}
            </dl>
          </header>
          <section aria-labelledby="cote" className="grid gap-3">
            <h2 id="cote" className="text-xl font-[450] tracking-[-0.02em]">Cote par variante</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="card-prices">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-normal">Variante</th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">Cote</th>
                    <th scope="col" className="hidden py-2 pr-4 font-normal sm:table-cell">Six mois</th>
                    <th scope="col" className="py-2 font-normal">Relevée le</th>
                  </tr>
                </thead>
                <tbody>
                  {card.variants.map((v) => (
                    <tr key={variantName(v) || "normale"} className="border-b">
                      <th scope="row" className="py-3 pr-4 text-left font-medium">{variantName(v) || "Normale"}</th>
                      <td className="tabular py-3 pr-4 text-right whitespace-nowrap">
                        {v.price ? formatPrice(v.price.trendCents) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="hidden py-3 pr-4 sm:table-cell">
                        <Sparkline points={v.history} label={`Évolution de la cote de ${card.name} ${variantName(v)} sur six mois`} />
                      </td>
                      <td className="py-3 whitespace-nowrap text-muted-foreground">{v.price ? formatDay(v.price.observedAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              {PRICE_SOURCE}
              {card.variants.some((v) => v.price?.ambiguous) && " Pour certaines variantes, la source ne distingue pas l'impression : la cote peut être celle de la carte en général."}
            </p>
          </section>
          <nav aria-label="Cartes voisines" className="flex flex-wrap justify-between gap-4 text-sm">
            {card.previous ? (
              <Link href={cardPath(set, card.previous)} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-4" aria-hidden /> {card.previous.name} {printedNumber(card.previous.localNumber, set.cardCountOfficial)}
              </Link>
            ) : <span />}
            {card.next && (
              <Link href={cardPath(set, card.next)} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                {card.next.name} {printedNumber(card.next.localNumber, set.cardCountOfficial)} <ArrowRight className="size-4" aria-hidden />
              </Link>
            )}
          </nav>
        </div>
      </div>
      <SellCta
        title={`Vendre ta carte ${card.name} ?`}
        text={`Prends-la en photo : Dexlane la reconnaît, propose un prix d'après sa cote${range ? ` (${priceText(range)} aujourd'hui)` : ""}, et publie l'annonce sur eBay avec un titre et des photos prêts.`}
      />
    </div>
  );
}
