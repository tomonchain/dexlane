"use client";

import { BellRing, ChartLine, Check, ExternalLink, Plus, RefreshCw, Search, Star, TrendingDown, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { CardThumb } from "@/components/card-chooser";
import { PriceHistory } from "@/components/price-history";
import { ListSkeleton } from "@/components/skeletons";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { SegmentedTabs } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { formatEuros, parseEuros, variantLabel } from "@/lib/format";
import { CONFIDENCE_HINT, CONFIDENCE_LABEL, age, eurosInput } from "@/lib/pricing";
import type { CatalogHit, Deal, DealList, TopCard, WatchedCard } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "WATCH" | "DEALS";
type Card = WatchedCard["card"];
type Prices = Pick<WatchedCard, "cardmarket" | "tcgplayer">;

const dollars = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD" });
const DOT = { HIGH: "bg-success", MEDIUM: "bg-warning", LOW: "bg-muted-foreground/50" } as const;
const MIN_VALUES = [1000, 2500, 5000, 10000];
const MIN_DISCOUNTS = [20, 25, 35, 50];

/** Recherche de la carte sur Cardmarket et sur eBay : là où l'achat se fait. */
function shopLinks(card: Card) {
  const query = `${card.name} ${card.localNumber}`;
  return [
    { label: "Cardmarket", href: `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name)}` },
    { label: "eBay", href: `https://www.ebay.fr/sch/i.html?_nkw=${encodeURIComponent(`${query} ${card.setName ?? ""} pokemon`.trim())}` },
  ];
}

function CardLabel({ card, owned, children }: { card: Card; owned: number; children?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <CardThumb imageUrl={card.imageUrl} size="sm" className="w-9 rounded-[3px]" />
      <span className="grid min-w-0 gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/carte/${card.catalogCardId}`} className="truncate text-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:underline">{card.name}</Link>
          {owned > 0 && <Badge variant="outline">{owned} en stock</Badge>}
          {children}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {card.setName ?? card.setId} · {card.localNumber} · {variantLabel(card)} · {card.language.toUpperCase()}
        </span>
      </span>
    </span>
  );
}

/** Une valeur avec son libellé, dans la grille d'une ligne. */
function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-0.5", className)}>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="tabular text-sm">{children}</span>
    </div>
  );
}

/** Les prix d'une carte sur chaque plateforme : ventes réussies et annonce la moins chère sur Cardmarket, marché TCGplayer. */
function PlatformCells({ prices }: { prices: Prices }) {
  const { cardmarket, tcgplayer } = prices;
  return (
    <>
      <Cell label="Ventes Cardmarket">
        {cardmarket.sales ? (
          <span className="inline-flex items-center gap-1.5" title={CONFIDENCE_HINT[cardmarket.sales.confidence]}>
            <span className={cn("size-1.5 rounded-full", DOT[cardmarket.sales.confidence])} aria-hidden />
            <span className="font-medium">{formatEuros(cardmarket.sales.cents)}</span>
            <span className="sr-only">({CONFIDENCE_LABEL[cardmarket.sales.confidence]})</span>
          </span>
        ) : <span className="text-muted-foreground">{cardmarket.trendCents !== null ? `≈ ${formatEuros(cardmarket.trendCents)}` : "—"}</span>}
      </Cell>
      <Cell label="Annonce dès">{cardmarket.lowCents !== null ? formatEuros(cardmarket.lowCents) : "—"}</Cell>
      <Cell label="TCGplayer" className="hidden sm:grid">{tcgplayer ? dollars.format(tcgplayer.marketCents / 100) : "—"}</Cell>
    </>
  );
}

function Links({ card }: { card: Card }) {
  return (
    <span className="flex items-center gap-1">
      {shopLinks(card).map((l) => (
        <Button key={l.label} asChild variant="ghost" size="sm" className="text-muted-foreground">
          <a href={l.href} target="_blank" rel="noopener noreferrer" aria-label={`Chercher ${card.name} sur ${l.label}`}>{l.label} <ExternalLink className="size-3" /></a>
        </Button>
      ))}
    </span>
  );
}

// ───────────────────────── Cartes suivies ─────────────────────────

function TargetInput({ item, onSaved }: { item: WatchedCard; onSaved: () => void }) {
  const [value, setValue] = useState(item.targetCents === null ? "" : eurosInput(item.targetCents));
  const cents = value.trim() === "" ? null : parseEuros(value);
  const changed = cents !== item.targetCents && !(value.trim() !== "" && cents === null);
  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!changed || (cents !== null && cents <= 0)) return;
    try {
      await api.updateWatched(item.id, { targetCents: cents });
      toast.success(cents === null ? "Prix cible retiré" : `Prix cible : ${formatEuros(cents)}`);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }
  return (
    <form onSubmit={save} className="grid gap-0.5">
      <label className="text-[11px] text-muted-foreground" htmlFor={`target-${item.id}`}>Prix cible</label>
      <span className="relative">
        <input
          id={`target-${item.id}`}
          inputMode="decimal"
          value={value}
          placeholder="—"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void save()}
          aria-invalid={value.trim() !== "" && cents === null}
          aria-label={`Prix cible pour ${item.card.name}`}
          className="tabular h-8 w-24 rounded-md border border-input bg-card pr-6 pl-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15 aria-invalid:border-destructive"
        />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">€</span>
      </span>
    </form>
  );
}

function WatchedRow({ item, onChanged }: { item: WatchedCard; onChanged: () => void }) {
  const [chart, setChart] = useState(false);
  const reached = item.alerts.includes("TARGET_REACHED");
  const moved = item.alerts.includes("PRICE_MOVE");
  async function remove() {
    try {
      await api.unwatch(item.id);
      toast.success(`${item.card.name} n'est plus suivie`);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <li className={cn("grid gap-3 px-4 py-3", item.alerts.length > 0 && "bg-brand-soft/40")} data-testid="watched-card">
      <div className="grid items-center gap-x-5 gap-y-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <CardLabel card={item.card} owned={item.owned}>
          {reached && <Badge variant="success"><BellRing /> Sous votre prix cible</Badge>}
          {moved && item.change && <Badge variant="warning">{item.change.percent > 0 ? <TrendingUp /> : <TrendingDown />} {item.change.percent > 0 ? "+" : ""}{item.change.percent.toLocaleString("fr-FR")} % en {item.change.windowDays} j</Badge>}
        </CardLabel>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <PlatformCells prices={item} />
          <Cell label={`Sur ${item.change?.windowDays ?? 7} j`}>
            {item.change ? (
              <span className={cn("inline-flex items-center gap-1", item.change.percent > 0 ? "text-success" : item.change.percent < 0 ? "text-destructive" : "text-muted-foreground")}>
                {item.change.percent > 0 ? "+" : ""}{item.change.percent.toLocaleString("fr-FR")} %
              </span>
            ) : <span className="text-muted-foreground">—</span>}
          </Cell>
          <TargetInput key={item.targetCents ?? "none"} item={item} onSaved={onChanged} />
          <span className="flex items-center gap-1">
            <Button variant={chart ? "secondary" : "ghost"} size="icon-sm" onClick={() => setChart(!chart)} aria-label={`Évolution du prix de ${item.card.name}`} aria-expanded={chart} title="Évolution du prix"><ChartLine /></Button>
            <Button variant="ghost" size="icon-sm" onClick={remove} aria-label={`Ne plus suivre ${item.card.name}`} title="Ne plus suivre"><X /></Button>
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {item.cardmarket.observedAt ? `Relevé Cardmarket ${age(item.cardmarket.observedAt)}` : "Aucune cote connue pour cette variante pour l'instant."}
          {item.cardmarket.ambiguous ? " · cote partagée avec une autre variante" : ""}
        </span>
        <Links card={item.card} />
      </div>
      {chart && <div className="rounded-md border bg-card p-3"><PriceHistory variantId={item.variantId} /></div>}
    </li>
  );
}

/** Une carte proposée dans la fenêtre de suivi : de quoi la reconnaître, son prix, et le bouton pour la suivre. */
function PickRow({ card, price, trend, watchedId, onWatch }: {
  card: Card; price: ReactNode; trend?: number | null; watchedId: string | null; onWatch: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex items-center gap-3 px-3 py-2.5" data-testid="pick-card">
      <span className="min-w-0 flex-1"><CardLabel card={card} owned={0} /></span>
      <span className="grid justify-items-end gap-0.5 text-right">
        <span className="tabular text-sm font-medium">{price}</span>
        {trend !== undefined && trend !== null && (
          <span className={cn("tabular text-[11px]", trend > 0 ? "text-success" : trend < 0 ? "text-destructive" : "text-muted-foreground")} title="Ventes de la semaine comparées à celles du mois">
            {trend > 0 ? "+" : ""}{trend} % cette semaine
          </span>
        )}
      </span>
      {watchedId ? (
        <Badge variant="outline" className="w-[5.5rem] justify-center"><Check /> Suivie</Badge>
      ) : (
        <Button variant="outline" size="sm" className="w-[5.5rem]" disabled={busy} aria-label={`Suivre ${card.name} ${card.localNumber}`}
          onClick={async () => { setBusy(true); await onWatch().finally(() => setBusy(false)); }}>
          {busy ? <Spinner /> : <Star />} Suivre
        </Button>
      )}
    </li>
  );
}

/**
 * Suivre une carte : une seule saisie (nom, numéro, série), des résultats pendant la frappe. Sans saisie, les cartes les
 * plus chères du moment. Le prix cible se règle ensuite dans la liste.
 */
function WatchModal({ onClose, onWatched }: { onClose: () => void; onWatched: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogHit[] | null>(null);
  const [top, setTop] = useState<TopCard[] | null>(null);
  const [followed, setFollowed] = useState<Record<string, string>>({});
  const request = useRef(0);
  const searching = query.trim().length >= 2;

  useEffect(() => {
    api.trendingCards(5).then((r) => setTop(r.cards)).catch(() => setTop([]));
  }, []);
  useEffect(() => {
    if (!searching) {
      setResults(null);
      return;
    }
    const id = ++request.current;
    const timer = setTimeout(() => {
      api.searchCards(query.trim()).then((r) => id === request.current && setResults(r.results)).catch(() => id === request.current && setResults([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, searching]);

  const watch = (variantId: string, name: string) => async () => {
    try {
      const { id } = await api.watch({ variantId });
      setFollowed((f) => ({ ...f, [variantId]: id }));
      toast.success(`${name} suivie`);
      onWatched();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Modal title="Suivre une carte" description="Cherchez par nom, numéro ou série. Le prix cible se règle ensuite dans la liste." onClose={onClose}>
      <div className="grid gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Dracaufeu, mew 151, fouinar ténèbres…"
            aria-label="Rechercher une carte"
            autoCorrect="off"
            enterKeyHint="search"
            className="h-11 w-full rounded-md border border-input bg-card pr-3 pl-9 text-base outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15"
          />
        </div>

        {!searching ? (
          <section className="grid gap-2" aria-label="Les plus demandées en ce moment" data-testid="top-cards">
            <div className="grid gap-0.5 px-1">
              <h3 className="text-xs font-medium text-muted-foreground">Les plus demandées en ce moment</h3>
              <p className="text-[11px] text-muted-foreground">
                Cartes de plus de 10 € de vos séries importées, vendues hier sur Cardmarket et dont le prix de vente monte le plus cette semaine : la demande dépasse l'offre.
                Cardmarket ne publie pas le nombre de recherches ; c'est l'indice le plus proche.
              </p>
            </div>
            {!top ? <ListSkeleton count={5} thumb label="Chargement des cartes demandées" /> : top.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
                Aucune carte de plus de 10 € en hausse dans vos séries importées. Importez d'autres séries dans le catalogue, ou actualisez les prix.
              </p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                {top.map((t) => (
                  <PickRow key={t.variantId} card={t.card} price={formatEuros(t.sales.cents)} trend={t.trendPercent}
                    watchedId={followed[t.variantId] ?? t.watchedId} onWatch={watch(t.variantId, t.card.name)} />
                ))}
              </ul>
            )}
          </section>
        ) : !results ? <ListSkeleton count={4} thumb label="Recherche" /> : results.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground" role="status">
            Aucune carte ne correspond. Seules les séries importées dans le catalogue sont cherchées.
          </p>
        ) : (
          <ul className="max-h-[50dvh] divide-y overflow-y-auto rounded-lg border bg-card" aria-label="Résultats" data-testid="search-results">
            {results.map((h) => (
              <PickRow
                key={h.variantId}
                card={{ ...h, catalogCardId: h.catalogCardId }}
                price={h.estimate
                  ? <span title={h.estimate.variantAmbiguous ? "Cote partagée avec une autre variante" : h.estimate.sales ? "Ventes réussies Cardmarket" : "Aucune vente récente : tendance des annonces"}>
                      {h.estimate.sales && !h.estimate.variantAmbiguous ? "" : "≈ "}{formatEuros(h.estimate.cents)}
                    </span>
                  : <span className="text-muted-foreground">—</span>}
                watchedId={followed[h.variantId] ?? h.watchedId}
                onWatch={watch(h.variantId, h.name)}
              />
            ))}
          </ul>
        )}
        <Button variant="outline" onClick={onClose} className="justify-self-end">Terminé</Button>
      </div>
    </Modal>
  );
}

function Watchlist({ data, onChanged }: { data: { items: WatchedCard[]; alerts: number } | null; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {data && data.items.length > 0
          ? `${data.items.length} carte${data.items.length > 1 ? "s" : ""} suivie${data.items.length > 1 ? "s" : ""}, relevée${data.items.length > 1 ? "s" : ""} chaque jour.`
          : "Les cartes que vous voulez acheter au bon prix."}
      </p>
      <Button onClick={() => setAdding(true)}><Plus /> Suivre une carte</Button>
    </div>
  );
  return (
    <div className="grid gap-3">
      {header}
      {!data ? <ListSkeleton count={4} thumb label="Chargement des cartes suivies" /> : data.items.length === 0 ? (
        <EmptyState icon={<Star />} title="Aucune carte suivie">
          Suivez une carte pour voir son prix de vente, l'annonce la moins chère et le prix TCGplayer, et être alerté quand elle passe sous votre prix.
        </EmptyState>
      ) : (
        <>
          {data.alerts > 0 && (
            <Alert variant="info">
              {data.alerts} carte{data.alerts > 1 ? "s demandent" : " demande"} votre attention : prix cible atteint ou variation au-delà de vos seuils d'alerte.
            </Alert>
          )}
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {[...data.items].sort((a, b) => b.alerts.length - a.alerts.length).map((item) => <WatchedRow key={item.id} item={item} onChanged={onChanged} />)}
          </ul>
        </>
      )}
      {adding && <WatchModal onClose={() => setAdding(false)} onWatched={onChanged} />}
    </div>
  );
}

// ───────────────────────── Bonnes affaires ─────────────────────────

function DealRow({ deal, onWatched }: { deal: Deal; onWatched: () => void }) {
  const [busy, setBusy] = useState(false);
  async function watch() {
    setBusy(true);
    try {
      await api.watch({ variantId: deal.variantId });
      toast.success(`${deal.card.name} suivie`);
      onWatched();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <li className="grid items-center gap-x-5 gap-y-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto]" data-testid="deal">
      <CardLabel card={deal.card} owned={deal.owned} />
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <PlatformCells prices={deal} />
        <Cell label="Décote"><span className="font-semibold text-success">−{deal.discountPercent} %</span></Cell>
        <Cell label="Écart"><span className="font-medium">{formatEuros(deal.gainCents)}</span></Cell>
        <span className="flex items-center gap-1">
          <Links card={deal.card} />
          {deal.watchedId
            ? <Badge variant="outline"><Star /> Suivie</Badge>
            : <Button variant="outline" size="sm" disabled={busy} onClick={watch} aria-label={`Suivre ${deal.card.name}`}>{busy ? <Spinner /> : <Star />} Suivre</Button>}
        </span>
      </div>
    </li>
  );
}

function Deals({ onWatched }: { onWatched: () => void }) {
  const [minCents, setMinCents] = useState(1000);
  const [minDiscount, setMinDiscount] = useState(25);
  const [data, setData] = useState<DealList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.deals({ minCents, minDiscount }).then((d) => { setData(d); setError(null); }).catch((e: Error) => setError(e.message));
  }, [minCents, minDiscount]);
  useEffect(load, [load]);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Critères">
        <Select value={minCents} onChange={(e) => setMinCents(Number(e.target.value))} aria-label="Valeur minimale" className="h-8 w-auto text-[13px] md:h-8">
          {MIN_VALUES.map((v) => <option key={v} value={v}>Cartes de plus de {formatEuros(v).replace(",00", "")}</option>)}
        </Select>
        <Select value={minDiscount} onChange={(e) => setMinDiscount(Number(e.target.value))} aria-label="Décote minimale" className="h-8 w-auto text-[13px] md:h-8">
          {MIN_DISCOUNTS.map((v) => <option key={v} value={v}>Au moins {v} % sous les ventes</option>)}
        </Select>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {data && (
        <p className="text-xs text-muted-foreground" data-testid="deals-scope">
          {data.examined.toLocaleString("fr-FR")} carte{data.examined > 1 ? "s" : ""} des séries importées, cotée{data.examined > 1 ? "s" : ""} autour de {formatEuros(data.minCents).replace(",00", "")} ou plus et relevée{data.examined > 1 ? "s" : ""} depuis moins de {data.freshDays} jours, comparée{data.examined > 1 ? "s" : ""} à leurs ventes réussies.
          {" "}L'annonce la moins chère de Cardmarket mélange les états et les langues : vérifiez l'annonce avant d'acheter.
        </p>
      )}
      {!data && !error ? <ListSkeleton count={5} thumb label="Recherche des bonnes affaires" /> : data && data.deals.length === 0 ? (
        <EmptyState icon={<Search />} title="Aucune bonne affaire pour ces critères">
          {data.examined === 0
            ? "Aucune carte de cette valeur n'a été relevée récemment. Importez des séries dans le catalogue, puis actualisez les prix : les cartes de plus de 10 € sont relevées chaque jour."
            : "Baissez la valeur ou la décote minimale, ou revenez après le prochain relevé quotidien."}
        </EmptyState>
      ) : data && (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {data.deals.map((deal) => <DealRow key={deal.variantId} deal={deal} onWatched={() => { load(); onWatched(); }} />)}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────── Page ─────────────────────────

export default function PurchasesPage() {
  const [tab, setTab] = useState<Tab>("WATCH");
  const [watched, setWatched] = useState<{ items: WatchedCard[]; alerts: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);

  const loadWatched = useCallback(() => {
    api.watchlist().then((w) => { setWatched(w); setError(null); }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(loadWatched, [loadWatched]);

  async function refresh() {
    setRefreshing(true);
    try {
      const r = await api.refreshPrices();
      toast.success(`${r.cards} carte${r.cards > 1 ? "s" : ""} relevée${r.cards > 1 ? "s" : ""}${r.remaining > 0 ? `, ${r.remaining} au prochain relevé` : ""}`);
      loadWatched();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "CATALOG_UNAVAILABLE" ? "La source des prix ne répond pas. Réessayez plus tard." : (e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Achats"
        description="Les cartes à surveiller avant d'acheter, sur Cardmarket et TCGplayer, et les bonnes affaires du moment sur les cartes qui valent quelque chose."
        actions={<Button variant="outline" onClick={refresh} disabled={refreshing}>{refreshing ? <Spinner /> : <RefreshCw />} Actualiser les prix</Button>}
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="overflow-x-auto">
        <SegmentedTabs
          label="Vue"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "WATCH", label: "Cartes suivies", count: watched?.items.length },
            { value: "DEALS", label: "Bonnes affaires" },
          ]}
        />
      </div>
      {tab === "WATCH" ? <Watchlist data={watched} onChanged={loadWatched} /> : <Deals key={version} onWatched={loadWatched} />}
    </div>
  );
}
