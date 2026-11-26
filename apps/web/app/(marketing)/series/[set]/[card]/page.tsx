import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import type { PublicCard, PublicCardLink } from "@dexlane/catalog";
import { pageMetadata } from "@/components/marketing/metadata";
import { JsonLd, breadcrumb } from "@/components/marketing/structured-data";
import { SectionTitle } from "@/components/marketing/ui";
import {
  PRICE_SOURCE, SERIES_PATH, cardImage, cardPath, formatDay, formatPrice, formatRelease, printedNumber, setPath, variantName,
} from "@/components/series/format";
import { CardPicture, CardTile, ChangeBadge, Crumbs, SellCta, Sparkline, change30 } from "@/components/series/ui";
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
  const metadata = pageMetadata(
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
  // Le visuel de la carte comme image de partage.
  const image = cardImage(card.imageUrl, "high");
  if (!image) return metadata;
  return {
    ...metadata,
    openGraph: { ...metadata.openGraph, images: [{ url: image, alt: `Carte Pokémon ${card.name} ${number}` }] },
    twitter: { ...metadata.twitter, card: "summary_large_image" as const, images: [image] },
  };
}

/** Carte précédente ou suivante dans la série, avec son image. */
function Neighbour({ card, direction }: { card: PublicCardLink; direction: "previous" | "next" }) {
  const Arrow = direction === "previous" ? ArrowLeft : ArrowRight;
  return (
    <Link
      href={cardPath({ id: card.setId, name: card.setName }, card)}
      className={`group flex items-center gap-3 rounded-xl p-2 outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/30 ${direction === "next" ? "flex-row-reverse text-right" : ""}`}
      data-testid={`card-${direction}`}
    >
      <CardPicture src={cardImage(card.imageUrl)} alt="" className="w-14 shrink-0" />
      <span className="grid gap-0.5 text-sm">
        <span className={`flex items-center gap-1 text-[13px] text-muted-foreground ${direction === "next" ? "justify-end" : ""}`}>
          {direction === "previous" && <Arrow className="size-3.5" aria-hidden />}
          {direction === "previous" ? "Carte précédente" : "Carte suivante"}
          {direction === "next" && <Arrow className="size-3.5" aria-hidden />}
        </span>
        <span className="font-medium group-hover:underline">{card.name}</span>
        <span className="font-mono text-[13px] text-muted-foreground">{printedNumber(card.localNumber, card.setCardCountOfficial)}</span>
      </span>
    </Link>
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
  const search = encodeURIComponent(`${card.name} ${number}`);
  const facts: { label: string; value: ReactNode }[] = [
    { label: "Série", value: <Link href={setPath(set)} className="font-medium underline-offset-4 hover:underline">{set.name}</Link> },
    ...(set.serieName ? [{ label: "Bloc", value: set.serieName }] : []),
    { label: "Numéro", value: <span className="font-mono">{number}</span> },
    ...(card.rarity ? [{ label: "Rareté", value: card.rarity }] : []),
    ...(card.stage ? [{ label: "Stade", value: card.stage }] : card.category ? [{ label: "Catégorie", value: card.category }] : []),
    ...(card.types?.length ? [{ label: card.types.length > 1 ? "Types" : "Type", value: card.types.join(", ") }] : []),
    ...(card.hp ? [{ label: "PV", value: card.hp }] : []),
    ...(card.illustrator ? [{ label: "Illustration", value: card.illustrator }] : []),
    ...(release ? [{ label: "Sortie", value: release }] : []),
  ];
  return (
    <div className="mx-auto grid max-w-6xl gap-14 px-4 pt-12 pb-20 sm:px-8 sm:pt-16 sm:pb-28">
      <JsonLd
        graph={[breadcrumb([
          { name: "Dexlane", path: "/" },
          { name: "Séries", path: SERIES_PATH },
          { name: set.name, path: setPath(set) },
          { name: `${card.name} ${number}`, path },
        ])]}
      />
      <div className="grid gap-10">
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
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3" data-testid="card-facts">
                {facts.map((f) => (
                  <div key={f.label}><dt className="text-muted-foreground">{f.label}</dt><dd className="font-medium">{f.value}</dd></div>
                ))}
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
                      <th scope="col" className="py-2 pr-4 text-right font-normal">30 jours</th>
                      <th scope="col" className="hidden py-2 pr-4 font-normal sm:table-cell">Six mois</th>
                      <th scope="col" className="hidden py-2 font-normal sm:table-cell">Relevée le</th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.variants.map((v) => (
                      <tr key={variantName(v) || "normale"} className="border-b">
                        <th scope="row" className="py-3 pr-4 text-left font-medium">{variantName(v) || "Normale"}</th>
                        <td className="tabular py-3 pr-4 text-right whitespace-nowrap">
                          {v.price ? formatPrice(v.price.trendCents) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-3 pr-4 text-right whitespace-nowrap"><ChangeBadge ratio={change30(v.history)} /></td>
                        <td className="hidden py-3 pr-4 sm:table-cell">
                          <Sparkline points={v.history} label={`Évolution de la cote de ${card.name} ${variantName(v)} sur six mois`} />
                        </td>
                        <td className="hidden py-3 whitespace-nowrap text-muted-foreground sm:table-cell">{v.price ? formatDay(v.price.observedAt) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                {PRICE_SOURCE}
                {card.variants.some((v) => v.price?.ambiguous) && " Pour certaines variantes, la source ne distingue pas l'impression : la cote peut être celle de la carte en général."}
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm" data-testid="card-external">
                <a href={`https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${search}`} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline">
                  Voir les offres sur Cardmarket <ExternalLink className="size-3.5" aria-hidden />
                </a>
                <a href={`https://www.ebay.fr/sch/i.html?_nkw=${search}`} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline">
                  Chercher sur eBay <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </div>
            </section>
          </div>
        </div>
        {(card.previous || card.next) && (
          <nav aria-label="Cartes voisines dans la série" className="grid gap-2 border-y py-3 sm:grid-cols-2">
            <div>{card.previous && <Neighbour card={card.previous} direction="previous" />}</div>
            <div className="sm:justify-self-end">{card.next && <Neighbour card={card.next} direction="next" />}</div>
          </nav>
        )}
      </div>

      {card.related.length > 0 && (
        <section aria-labelledby="meme-pokemon" className="grid gap-4">
          <h2 id="meme-pokemon" className="text-xl font-[450] tracking-[-0.02em]">
            {card.relatedBy === "pokedex" ? "D'autres cartes de ce Pokémon" : "Cette carte dans d'autres séries"}
          </h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" data-testid="card-related">
            {card.related.map((c) => <li key={`${c.setId}-${c.localNumber}`}><CardTile card={c} /></li>)}
          </ul>
        </section>
      )}

      {card.sameIllustrator.length > 0 && (
        <section aria-labelledby="illustrateur" className="grid gap-4">
          <h2 id="illustrateur" className="text-xl font-[450] tracking-[-0.02em]">Illustrées aussi par {card.illustrator}</h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" data-testid="card-illustrator">
            {card.sameIllustrator.map((c) => <li key={`${c.setId}-${c.localNumber}`}><CardTile card={c} /></li>)}
          </ul>
        </section>
      )}

      <SellCta
        title={`Vendre ta carte ${card.name} ?`}
        text={`Prends-la en photo : Dexlane la reconnaît, propose un prix d'après sa cote${range ? ` (${priceText(range)} aujourd'hui)` : ""}, et publie l'annonce sur eBay avec un titre et des photos prêts.`}
      />
    </div>
  );
}
