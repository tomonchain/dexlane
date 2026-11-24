"use client";

import { CircleSlash, ExternalLink, PackageOpen, Star } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { PriceHistory } from "@/components/price-history";
import { PageSkeleton } from "@/components/skeletons";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BackLink, Code, EmptyState, Spinner } from "@/components/ui/misc";
import { SegmentedTabs } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { useCardImage } from "@/lib/card-image";
import { formatDateTime, formatEuros, formatNumber, variantLabel } from "@/lib/format";
import { intlLocale, t, tn } from "@/lib/i18n";
import { CONFIDENCE_HINT, CONFIDENCE_LABEL } from "@/lib/pricing";
import type { CardPage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useCachedState } from "@/lib/cache";

type Variant = CardPage["variants"][number];
type Offer = CardPage["offers"][number];

const dollars = () => new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "USD" });
const DOT = { HIGH: "bg-success", MEDIUM: "bg-warning", LOW: "bg-muted-foreground/50" } as const;
const STATUS: Record<string, { label: string; dot: string }> = {
  TO_PRICE: { label: "À tarifer", dot: "bg-brand" },
  READY: { label: "Prête", dot: "bg-foreground/35" },
  LISTED: { label: "En ligne", dot: "bg-success" },
  DRAFT: { label: "Brouillon", dot: "border border-muted-foreground/70" },
};
const STAGE: Record<string, string> = { PENDING: "À préparer", PACKED: "Emballée", SHIPPED: "Remise" };
const CHANNEL: Record<string, string> = { direct: "Vente directe", ebay: "eBay", cardtrader: "CardTrader" };
const LANGUAGE: Record<string, string> = { fr: "Français", en: "Anglais", de: "Allemand", it: "Italien", es: "Espagnol", pt: "Portugais", ja: "Japonais" };

function Section({ title, aside, children, testId }: { title: string; aside?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="grid content-start gap-2" aria-label={title} data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Figure({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="grid content-start gap-1 bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular text-lg leading-none font-semibold tracking-tight">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** Une variante : ses prix sur chaque plateforme, ce qu'on en a, et son suivi. */
function VariantRow({ variant, selected, onChart, onWatch }: { variant: Variant; selected: boolean; onChart: () => void; onWatch: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const { cardmarket, tcgplayer } = variant.prices;
  return (
    <li className={cn("grid items-center gap-x-5 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto]", selected && "bg-accent/50")} data-testid="card-variant">
      <div className="grid gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {variantLabel(variant)}
          {variant.onHand > 0 && <Badge variant="outline">{t("{n} en stock", { n: formatNumber(variant.onHand) })}</Badge>}
          {variant.incomplete && <Badge variant="warning">{t("À confirmer")}</Badge>}
        </span>
        <span className="text-xs text-muted-foreground">
          {cardmarket.ambiguous ? t("Cote partagée avec une autre impression : à prendre avec prudence.") : cardmarket.observedAt ? t("Relevé Cardmarket du {date}", { date: formatDateTime(cardmarket.observedAt) }) : t("Aucune cote connue")}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <span className="grid gap-0.5">
          <span className="text-[11px] text-muted-foreground">{t("Ventes Cardmarket")}</span>
          <span className="tabular text-sm">
            {cardmarket.sales ? (
              <span className="inline-flex items-center gap-1.5" title={t(CONFIDENCE_HINT[cardmarket.sales.confidence])}>
                <span className={cn("size-1.5 rounded-full", DOT[cardmarket.sales.confidence])} aria-hidden />
                <span className="font-medium">{cardmarket.ambiguous ? "≈ " : ""}{formatEuros(cardmarket.sales.cents)}</span>
                <span className="sr-only">({t(CONFIDENCE_LABEL[cardmarket.sales.confidence])})</span>
              </span>
            ) : cardmarket.trendCents !== null ? `≈ ${formatEuros(cardmarket.trendCents)}` : "—"}
          </span>
        </span>
        <span className="grid gap-0.5">
          <span className="text-[11px] text-muted-foreground">{t("Annonce dès")}</span>
          <span className="tabular text-sm">{cardmarket.lowCents !== null ? formatEuros(cardmarket.lowCents) : "—"}</span>
        </span>
        <span className="grid gap-0.5">
          <span className="text-[11px] text-muted-foreground">TCGplayer</span>
          <span className="tabular text-sm">{tcgplayer ? dollars().format(tcgplayer.marketCents / 100) : "—"}</span>
        </span>
        <span className="flex items-center gap-1">
          <Button variant={selected ? "secondary" : "outline"} size="sm" onClick={onChart} aria-pressed={selected}>{t("Courbe")}</Button>
          {variant.watched ? (
            <Button asChild variant="ghost" size="sm"><Link href="/buying"><Star className="fill-current" /> {t("Suivie")}</Link></Button>
          ) : (
            <Button variant="outline" size="sm" disabled={busy} aria-label={t("Suivre {variant}", { variant: variantLabel(variant) })}
              onClick={async () => { setBusy(true); await onWatch().finally(() => setBusy(false)); }}>
              {busy ? <Spinner /> : <Star />} {t("Suivre")}
            </Button>
          )}
        </span>
      </div>
    </li>
  );
}

/** Une offre (variante × état) et ses exemplaires, regroupés. */
function OfferGroup({ offer, copies, variant }: { offer: Offer; copies: CardPage["copies"]; variant: Variant | undefined }) {
  const status = STATUS[offer.status] ?? STATUS.READY!;
  const price = offer.targetPriceCents ?? offer.suggestedPriceCents;
  return (
    <li className="grid gap-2 px-4 py-3" data-testid={`card-offer-${offer.offerSku}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-sm font-medium">{variant ? variantLabel(variant) : t("Variante")} · {offer.condition}</span>
        <span className="inline-flex items-center gap-1.5 text-[13px]"><span className={cn("size-2 rounded-full", status.dot)} aria-hidden />{t(status.label)}</span>
        {offer.listings.map((l) => (
          <Badge key={l.id} variant="outline">{CHANNEL[l.channel] ? t(CHANNEL[l.channel]!) : l.channel} · {formatEuros(l.priceCents)}{l.simulated ? ` · ${t("simulé")}` : ""}</Badge>
        ))}
        <span className="tabular ml-auto text-sm">
          {offer.onHand} × <span className="font-semibold">{price === null ? t("sans prix") : formatEuros(price)}</span>
          {offer.targetPriceCents === null && offer.suggestedPriceCents !== null && <span className="text-xs text-muted-foreground"> {t("suggéré")}</span>}
        </span>
        <Button asChild variant="outline" size="sm"><Link href={`/stock?offer=${offer.offerId}`}>{t("Ouvrir dans le stock")}</Link></Button>
      </div>
      <ul className="grid gap-1.5">
        {copies.map((copy) => (
          <li key={copy.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-[13px]" data-testid="card-copy">
            {copy.photoUrl
              ? <img src={copy.photoUrl} alt={t("Scan de {sku}", { sku: copy.unitSku })} loading="lazy" className="aspect-[63/88] w-7 rounded-[3px] bg-muted object-cover ring-1 ring-border" />
              : <span className="flex aspect-[63/88] w-7 items-center justify-center rounded-[3px] bg-card text-muted-foreground ring-1 ring-border" aria-hidden><PackageOpen className="size-3" /></span>}
            <Link href={`/inventory/${copy.unitSku}`} className="font-mono text-xs font-medium underline-offset-2 hover:underline">{copy.unitSku}</Link>
            <Code className="text-xs">{copy.locationCode}</Code>
            {copy.scan && <span className="text-xs text-muted-foreground">{t("carte n° {position} du lot « {batch} »", { position: copy.scan.position, batch: copy.scan.batchName })}</span>}
            {copy.lifecycle === "DRAFT" && <Badge variant="outline">{t("Brouillon")}</Badge>}
            {copy.reserved > 0 && <Badge variant="warning">{tn(copy.reserved, "{n} réservée", "{n} réservées")}</Badge>}
            <span className="tabular ml-auto text-xs text-muted-foreground">
              {copy.onHand > 1 ? `${copy.onHand} × ` : ""}{t("acheté {price} · entré le {date}", { price: formatEuros(copy.unitCostCents), date: formatDateTime(copy.createdAt) })}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

export default function CardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useCachedState<CardPage>(`card:${id}`);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [chartVariant, setChartVariant] = useState<string | null>(null);

  const load = useCallback(() => {
    api.card(id)
      .then((d) => {
        setData(d);
        // Courbe : la variante la plus détenue, sinon la première qui a une cote.
        setChartVariant((current) => current ?? ([...d.variants].sort((a, b) => b.onHand - a.onHand).find((v) => v.onHand > 0 || v.prices.cardmarket.observedAt) ?? d.variants[0])?.id ?? null);
      })
      .catch((e: unknown) => (e instanceof ApiError && e.status === 404 ? setMissing(true) : setError((e as Error).message)));
  }, [id]);
  useEffect(load, [load]);
  const picture = useCardImage(data?.card.imageUrl ?? null, "high");

  const back = <BackLink onClick={() => router.back()}>{t("Retour")}</BackLink>;
  if (missing) return <div className="grid gap-5">{back}<EmptyState icon={<CircleSlash />} title={t("Carte introuvable")} /></div>;
  if (!data) return error ? <Alert variant="destructive">{error}</Alert> : <PageSkeleton label={t("Chargement de la carte")} />;

  const { card, variants, offers, copies, sales, totals } = data;
  const numbering = card.officialCount ? `${card.localNumber}/${card.officialCount}` : card.localNumber;
  const watch = (variant: Variant) => async () => {
    try {
      await api.watch({ variantId: variant.id });
      toast.success(t("{name} ({variant}) suivie", { name: card.name, variant: variantLabel(variant) }));
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const query = `${card.name} ${card.localNumber}`;

  return (
    <div className="grid gap-6">
      {back}
      <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="mx-auto w-48 lg:sticky lg:top-6 lg:mx-0 lg:w-full">
          {picture.src
            ? <img src={picture.src} onError={picture.onError} alt={`${card.name} ${numbering}`} className="aspect-[63/88] w-full rounded-xl bg-muted object-cover shadow-sm ring-1 ring-border" />
            : <div className="flex aspect-[63/88] w-full items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border" aria-hidden><PackageOpen className="size-8" /></div>}
        </div>

        <div className="grid min-w-0 gap-6">
          <div className="grid gap-2">
            <h1 className="text-xl leading-tight font-semibold tracking-tight sm:text-2xl" data-testid="card-name">{card.name}</h1>
            <p className="text-sm text-muted-foreground">
              {card.setName ?? card.setId} {card.serieName ? `(${card.serieName})` : ""} · {t("n° {number}", { number: numbering })}{card.rarity ? ` · ${card.rarity}` : ""} · {LANGUAGE[card.language] ? t(LANGUAGE[card.language]!) : card.language.toUpperCase()}
            </p>
            <p className="flex flex-wrap gap-1">
              <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                <a href={`https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name)}`} target="_blank" rel="noopener noreferrer">Cardmarket <ExternalLink className="size-3" /></a>
              </Button>
              <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                <a href={`https://www.ebay.fr/sch/i.html?_nkw=${encodeURIComponent(`${query} ${card.setName ?? ""} pokemon`.trim())}`} target="_blank" rel="noopener noreferrer">eBay <ExternalLink className="size-3" /></a>
              </Button>
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4" data-testid="card-totals">
            <Figure label={t("Exemplaires en stock")} value={totals.copies} hint={tn(offers.length, "{n} offre", "{n} offres")} />
            <Figure label={t("Valeur")} value={formatEuros(totals.valueCents)} hint={t("au prix fixé")} />
            <Figure label={t("Coût d'achat")} value={formatEuros(totals.costCents)} hint={totals.copies > 0 ? t("des exemplaires en stock") : undefined} />
            <Figure label={t("Vendues")} value={totals.soldCards} hint={totals.soldCards > 0 ? formatEuros(totals.soldCents) : undefined} />
          </dl>

          <Section title={variants.length > 1 ? t("{n} variantes", { n: formatNumber(variants.length) }) : t("Variante")} testId="card-variants">
            <ul className="divide-y overflow-hidden rounded-lg border bg-card">
              {variants.map((v) => (
                <VariantRow key={v.id} variant={v} selected={v.id === chartVariant} onChart={() => setChartVariant(v.id)} onWatch={watch(v)} />
              ))}
            </ul>
          </Section>

          {chartVariant && (
            <Section title={t("Évolution du prix")}>
              <div className="rounded-lg border bg-card p-4">
                {variants.length > 1 && (
                  <div className="mb-3">
                    <SegmentedTabs label={t("Variante")} value={chartVariant} onChange={setChartVariant}
                      tabs={variants.map((v) => ({ value: v.id, label: variantLabel(v) }))} />
                  </div>
                )}
                <PriceHistory key={chartVariant} variantId={chartVariant} title={variants.length > 1 ? null : variantLabel(variants[0]!)} />
              </div>
            </Section>
          )}

          <Section title={totals.copies > 0 ? t("Exemplaires en stock ({n})", { n: formatNumber(totals.copies) }) : t("Exemplaires en stock")} testId="card-copies">
            {offers.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{t("Aucun exemplaire en stock.")}</p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                {offers.map((offer) => (
                  <OfferGroup key={offer.offerId} offer={offer} copies={copies.filter((c) => c.offerId === offer.offerId)} variant={variants.find((v) => v.id === offer.variantId)} />
                ))}
              </ul>
            )}
          </Section>

          <Section title={t("Ventes")} testId="card-sales">
            {sales.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{t("Cette carte n'a pas encore été vendue.")}</p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                {sales.map((sale) => {
                  const variant = variants.find((v) => v.id === sale.variantId);
                  return (
                    <li key={`${sale.orderId}-${sale.variantId}-${sale.condition}`}>
                      <Link href={`/sales/${sale.orderId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent">
                        <Code className="text-[13px] font-semibold">{sale.externalId}</Code>
                        <span className="text-[13px] text-muted-foreground">{CHANNEL[sale.channel] ?? sale.channel} · {formatDateTime(sale.orderedAt)} · {STAGE[sale.stage] ? t(STAGE[sale.stage]!) : sale.stage}</span>
                        <span className="text-[13px]">{sale.qty} × {variant ? variantLabel(variant) : ""} · {sale.condition}</span>
                        <span className="tabular ml-auto font-semibold">{formatEuros(sale.qty * sale.unitPriceCents)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
