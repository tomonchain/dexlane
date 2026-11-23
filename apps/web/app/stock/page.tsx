"use client";

import { CalendarClock, Check, Copy, Images, Megaphone, RefreshCw, ScanLine, Search, ShoppingCart, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { CardThumb } from "@/components/card-chooser";
import { OfferPhotos } from "@/components/offer-photos";
import { PlanModal } from "@/components/plan-modal";
import { PriceHistory } from "@/components/price-history";
import { SalesBasis } from "@/components/sales-basis";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Code, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { Pagination, SegmentedTabs } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { cardImage, dayLabel, formatEuros, parseEuros, variantLabel } from "@/lib/format";
import { CONFIDENCE_LABEL, age, eurosInput, quoteLabel, reasonLabel } from "@/lib/pricing";
import { CONDITIONS, type ChannelState, type ListingBlocker, type Schedule, type StockDetail, type StockFacets, type StockPage, type StockRow, type StockStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { composeMissingVisuals } from "@/lib/visuals";
import { InspectorSkeleton, StockRowsSkeleton } from "@/components/skeletons";

const PAGE_SIZE = 50;
type Filter = StockStatus | "ALL";
type Sort = "recent" | "value" | "name";

const STATUS: Record<StockStatus, { label: string; dot: string }> = {
  TO_PRICE: { label: "À tarifer", dot: "bg-brand" },
  READY: { label: "Prête", dot: "bg-foreground/35" },
  LISTED: { label: "En ligne", dot: "bg-success" },
  DRAFT: { label: "Brouillon", dot: "border border-muted-foreground/70" },
};
const BLOCKERS: Record<ListingBlocker, string> = { PRICE: "un prix", PHOTO: "une photo de l'exemplaire", VARIANT: "une variante confirmée" };
const ERRORS: Record<string, string> = {
  FLOOR_ABOVE_TARGET: "Ce prix est inférieur au plancher de l'offre.",
  CHANNEL_DISABLED: "Ce canal est désactivé.",
  LISTING_NOT_READY: "Il manque un prix, une photo ou une variante confirmée pour publier.",
  OFFER_NOT_SELLABLE: "Cette carte n'a plus de stock vendable.",
};
const message = (e: unknown) => (e instanceof ApiError ? (ERRORS[e.code] ?? e.message) : (e as Error).message);
const subtitle = (r: StockRow) => `${r.setName ?? r.setId.toUpperCase()} · ${r.localNumber} · ${variantLabel(r)}`;

const PLAN_ERRORS: Record<string, string> = {
  LISTING_NOT_READY: "prix, photo ou variante manquante",
  OFFER_NOT_SELLABLE: "plus de stock vendable",
  CHANNEL_DISABLED: "canal désactivé",
  CHANNEL_NOT_CONFIGURED: "connecteur du canal non configuré",
};

function StatusMark({ status, plannedOn }: { status: StockStatus; plannedOn?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap">
      <span className={cn("size-2 rounded-full", STATUS[status].dot)} aria-hidden />
      {plannedOn && status === "READY" ? `Planifiée ${dayLabel(plannedOn)}` : STATUS[status].label}
    </span>
  );
}

/** Prix d'une ligne, modifiable sur place : cliquer, taper, Entrée. Un prix suggéré s'accepte d'un clic. */
function PriceCell({ row, onSaved }: { row: StockRow; onSaved: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(cents: number) {
    setSaving(true);
    try {
      await api.setOfferPrice(row.offerId, { targetPriceCents: cents });
      setDraft(null);
      onSaved();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setSaving(false);
    }
  }
  function commit() {
    const cents = draft === null ? null : parseEuros(draft);
    if (cents === null || cents === row.targetPriceCents) return setDraft(null);
    void save(cents);
  }

  if (draft !== null) {
    return (
      <input
        autoFocus
        inputMode="decimal"
        value={draft}
        disabled={saving}
        aria-label={`Prix de ${row.name}`}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
        className="tabular h-7 w-24 rounded-md border border-ring bg-card px-2 text-right text-sm outline-none ring-[3px] ring-ring/15"
      />
    );
  }
  const edit = (cents: number | null) => setDraft(cents === null ? "" : eurosInput(cents));
  if (row.targetPriceCents !== null) {
    return (
      <button type="button" onClick={() => edit(row.targetPriceCents)} aria-label={`Modifier le prix de ${row.name}`} className="tabular h-7 rounded-md px-2 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30">
        {formatEuros(row.targetPriceCents)}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={() => edit(row.suggestedPriceCents)} aria-label={`Fixer le prix de ${row.name}`} className="tabular h-7 rounded-md px-2 text-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30">
        {row.suggestedPriceCents === null ? "Fixer" : formatEuros(row.suggestedPriceCents)}
      </button>
      {row.suggestedPriceCents !== null && (
        <button
          type="button"
          disabled={saving}
          onClick={() => save(row.suggestedPriceCents!)}
          aria-label={`Accepter ${formatEuros(row.suggestedPriceCents)} pour ${row.name}`}
          title="Accepter le prix suggéré"
          className="flex size-7 items-center justify-center rounded-md border bg-card text-foreground shadow-xs outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30"
        >
          {saving ? <Spinner className="size-3.5" /> : <Check className="size-3.5" strokeWidth={2.5} />}
        </button>
      )}
    </span>
  );
}

const FILTERS: Filter[] = ["ALL", "TO_PRICE", "READY", "LISTED", "DRAFT"];

interface Filters { setId: string; location: string; condition: string; price: string }
const NO_FILTERS: Filters = { setId: "", location: "", condition: "", price: "" };
/** Fourchettes de prix : prix fixé, sinon prix suggéré. */
const PRICE_RANGES: { value: string; label: string; min?: number; max?: number }[] = [
  { value: "lt1", label: "Moins de 1 €", max: 100 },
  { value: "1-10", label: "1 à 10 €", min: 100, max: 1000 },
  { value: "10-50", label: "10 à 50 €", min: 1000, max: 5000 },
  { value: "50-200", label: "50 à 200 €", min: 5000, max: 20000 },
  { value: "gte200", label: "200 € et plus", min: 20000 },
];

/** Un filtre : liste déroulante compacte, mise en avant quand une valeur est choisie. */
function FilterSelect({ label, value, all, options, onChange }: {
  label: string; value: string; all: string; options: { value: string; label: string; count?: number }[]; onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={cn("h-8 w-auto max-w-52 text-[13px] md:h-8", value && "border-primary/50 bg-accent font-medium")}
    >
      <option value="">{all}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}{o.count !== undefined ? ` (${o.count.toLocaleString("fr-FR")})` : ""}</option>)}
    </Select>
  );
}

export default function StockPage() {
  return (
    <Suspense>
      <Stock />
    </Suspense>
  );
}

function Stock() {
  // L'accueil renvoie ici avec un filtre déjà posé (« ?statut=TO_PRICE »).
  const requested = useSearchParams().get("statut") as Filter | null;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(requested && FILTERS.includes(requested) ? requested : "ALL");
  const [sort, setSort] = useState<Sort>("recent");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [facets, setFacets] = useState<StockFacets | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<StockPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [accepting, setAccepting] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [planning, setPlanning] = useState(false);
  const desktop = useIsDesktop();

  const load = useCallback(() => {
    const price = PRICE_RANGES.find((r) => r.value === filters.price);
    api.stock({
      q: query.trim() || undefined, status: filter, sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE,
      setId: filters.setId || undefined, location: filters.location || undefined, condition: filters.condition || undefined,
      minCents: price?.min, maxCents: price?.max,
    })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [query, filter, sort, page, filters]);
  useEffect(() => {
    const timer = setTimeout(load, query ? 200 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);
  useEffect(() => {
    api.channels().then((r) => setChannels(r.channels.filter((c) => c.mode !== "OFF"))).catch(() => setChannels([]));
  }, []);

  // Les valeurs des filtres suivent le stock : rechargées à chaque changement (entrée, vente, correction).
  useEffect(() => {
    api.stockFacets().then(setFacets).catch(() => setFacets(null));
  }, [version]);

  const loadSchedule = useCallback(() => {
    api.schedule().then(setSchedule).catch(() => setSchedule(null));
  }, []);
  useEffect(loadSchedule, [loadSchedule]);

  const changed = useCallback(() => {
    load();
    loadSchedule();
    setVersion((v) => v + 1);
  }, [load, loadSchedule]);

  const toggle = (offerId: string) => setChecked((current) => {
    const next = new Set(current);
    if (!next.delete(offerId)) next.add(offerId);
    return next;
  });
  const pageIds = (data?.items ?? []).map((r) => r.offerId);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => checked.has(id));

  const suggested = (data?.items ?? []).filter((r) => r.targetPriceCents === null && r.suggestedPriceCents !== null);
  async function acceptAll() {
    setAccepting(true);
    let done = 0;
    try {
      for (const row of suggested) {
        await api.setOfferPrice(row.offerId, { targetPriceCents: row.suggestedPriceCents! });
        done++;
      }
      toast.success(`${done} prix accepté${done > 1 ? "s" : ""}`);
    } catch (e) {
      toast.error(message(e));
    } finally {
      setAccepting(false);
      changed();
    }
  }

  /** Flèches haut et bas : passer d'une carte à l'autre sans quitter le clavier. */
  function onRowKey(e: KeyboardEvent<HTMLTableRowElement>, index: number) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelected(data!.items[index]!.offerId);
    }
    const next = e.key === "ArrowDown" ? index + 1 : e.key === "ArrowUp" ? index - 1 : null;
    if (next === null || !data?.items[next]) return;
    e.preventDefault();
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
    if (selected) setSelected(data.items[next].offerId);
  }

  const filtered = Object.values(filters).some(Boolean);
  const empty = data && data.counts.ALL === 0 && !query && !filtered;
  const setFilterValue = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const inspector = selected && (
    <Inspector key={selected} offerId={selected} version={version} channels={channels} onChanged={changed} onClose={() => setSelected(null)} />
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Stock</h1>
        {data && data.counts.ALL > 0 && (
          <p className="tabular text-sm text-muted-foreground" data-testid="stock-totals">
            {data.totals.cards.toLocaleString("fr-FR")} carte{data.totals.cards > 1 ? "s" : ""} · {formatEuros(data.totals.valueCents)}
          </p>
        )}
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Carte, série ou référence"
              aria-label="Rechercher dans le stock"
              className="h-9 w-full rounded-md border border-input bg-card pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15 sm:w-64"
            />
          </div>
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Trier" className="h-9 w-auto text-sm md:h-9">
            <option value="recent">Plus récentes</option>
            <option value="value">Plus chères</option>
            <option value="name">Nom</option>
          </Select>
        </div>
      </div>

      {!empty && facets && (facets.sets.length > 1 || facets.locations.length > 1 || facets.conditions.length > 1 || filtered) && (
        <div className="flex flex-wrap items-center gap-2" data-testid="stock-filters" role="group" aria-label="Filtres">
          <FilterSelect label="Série" value={filters.setId} onChange={(v) => setFilterValue("setId", v)} all="Toutes les séries"
            options={facets.sets.map((s) => ({ value: s.id, label: s.name, count: s.cards }))} />
          <FilterSelect label="Boîte" value={filters.location} onChange={(v) => setFilterValue("location", v)} all="Toutes les boîtes"
            options={facets.locations.map((l) => ({ value: l.code, label: l.code, count: l.cards }))} />
          <FilterSelect label="État" value={filters.condition} onChange={(v) => setFilterValue("condition", v)} all="Tous les états"
            options={facets.conditions.map((c) => ({ value: c.code, label: `${c.code} · ${CONDITIONS.find((k) => k.code === c.code)?.label ?? c.code}`, count: c.cards }))} />
          <FilterSelect label="Prix" value={filters.price} onChange={(v) => setFilterValue("price", v)} all="Tous les prix"
            options={PRICE_RANGES.map((r) => ({ value: r.value, label: r.label }))} />
          {filtered && (
            <Button variant="ghost" size="sm" onClick={() => { setFilters(NO_FILTERS); setPage(1); }}><X /> Effacer les filtres</Button>
          )}
        </div>
      )}

      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive">{error}</p>}

      {empty ? (
        <div className="grid justify-items-center gap-4 rounded-lg border border-dashed px-6 py-16 text-center">
          <div className="grid gap-1">
            <p className="text-base font-semibold">Votre stock est vide</p>
            <p className="max-w-sm text-sm text-muted-foreground">Faites entrer vos cartes : elles sont identifiées, estimées, puis prêtes à vendre.</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild><Link href="/scanner/lot"><Images /> Importer un lot d'images</Link></Button>
            <Button asChild variant="outline"><Link href="/ajouter"><ScanLine /> Ajouter une carte</Link></Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="max-w-full overflow-x-auto">
            <SegmentedTabs
              label="Statut"
              value={filter}
              onChange={(next) => {
                setFilter(next);
                setPage(1);
              }}
              tabs={[
                { value: "ALL", label: "Tout", count: data?.counts.ALL },
                { value: "TO_PRICE", label: "À tarifer", count: data?.counts.TO_PRICE },
                { value: "READY", label: "Prêtes", count: data?.counts.READY },
                { value: "LISTED", label: "En ligne", count: data?.counts.LISTED },
                { value: "DRAFT", label: "Brouillons", count: data?.counts.DRAFT },
              ]}
            />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {suggested.length > 0 && (
                <Button variant="outline" size="sm" onClick={acceptAll} disabled={accepting}>
                  {accepting ? <Spinner /> : <Check />} Accepter les {suggested.length} prix suggérés
                </Button>
              )}
              {channels.length > 0 && data && (checked.size > 0 || data.counts.READY > 0) && (
                <Button size="sm" onClick={() => setPlanning(true)}>
                  <CalendarClock /> Planifier la mise en ligne{checked.size > 0 ? ` (${checked.size})` : ""}
                </Button>
              )}
            </div>
          </div>

          {schedule && (schedule.pending > 0 || schedule.failed.length > 0) && (
            <SchedulePanel schedule={schedule} channels={channels} onChanged={changed} />
          )}

          <div className={cn("grid items-start gap-4", selected && desktop && "lg:grid-cols-[minmax(0,1fr)_25rem]")}>
            <div className="overflow-hidden rounded-lg border bg-card">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="h-9 w-9 pl-3">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        aria-label="Sélectionner toutes les cartes de la page"
                        onChange={() => setChecked((current) => {
                          const next = new Set(current);
                          for (const id of pageIds) if (allChecked) next.delete(id); else next.add(id);
                          return next;
                        })}
                        className="size-4 cursor-pointer accent-foreground"
                      />
                    </th>
                    <th className="h-9 px-3 font-medium">Carte</th>
                    <th className="hidden px-3 font-medium sm:table-cell">État</th>
                    <th className="px-3 text-right font-medium">Qté</th>
                    <th className="hidden px-3 font-medium md:table-cell">Emplacement</th>
                    <th className={cn("hidden px-3 text-right font-medium", selected ? "2xl:table-cell" : "lg:table-cell")} title="Prix estimé d'après les ventes réussies, toutes langues et tous états confondus">Ventes</th>
                    <th className="px-3 text-right font-medium">Prix</th>
                    <th className="hidden px-3 font-medium sm:table-cell">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((row, index) => (
                    <tr
                      key={row.offerId}
                      tabIndex={0}
                      aria-selected={row.offerId === selected}
                      data-testid={`stock-${row.offerSku}`}
                      onClick={() => setSelected(row.offerId)}
                      onKeyDown={(e) => onRowKey(e, index)}
                      className={cn(
                        "cursor-pointer border-b outline-none transition-colors last:border-b-0 hover:bg-accent/50 focus-visible:bg-accent/70",
                        row.offerId === selected && "bg-accent/70 hover:bg-accent/70",
                      )}
                    >
                      <td className="w-9 pl-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={checked.has(row.offerId)} onChange={() => toggle(row.offerId)} aria-label={`Sélectionner ${row.name} ${row.condition}`} className="size-4 cursor-pointer accent-foreground" />
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-3">
                          <CardThumb imageUrl={row.imageUrl} size="sm" className="w-8 rounded-[3px]" />
                          <span className="grid min-w-0">
                            <span className="truncate font-medium">{row.name}</span>
                            <span className="truncate text-xs text-muted-foreground">{subtitle(row)}</span>
                          </span>
                        </span>
                      </td>
                      <td className="hidden px-3 font-mono text-xs sm:table-cell">{row.condition}</td>
                      <td className="tabular px-3 text-right">
                        {row.onHand}
                        {row.reserved > 0 && <span className="text-xs text-muted-foreground"> · {row.reserved} rés.</span>}
                      </td>
                      <td className="hidden px-3 md:table-cell">
                        <Code className="text-xs">{row.locations[0]}</Code>
                        {row.locations.length > 1 && <span className="text-xs text-muted-foreground"> +{row.locations.length - 1}</span>}
                      </td>
                      <td className={cn("tabular hidden px-3 text-right text-muted-foreground", selected ? "2xl:table-cell" : "lg:table-cell")} title={row.reference ? (row.sales
                        ? `Ventes réussies Cardmarket (${CONFIDENCE_LABEL[row.sales.confidence]}), relevées ${age(row.reference.observedAt)}`
                        : `Aucune vente récente : ${quoteLabel(row.reference.quoteType).toLowerCase()} des annonces Cardmarket, relevée ${age(row.reference.observedAt)}`) : undefined}>
                        {row.reference ? `${row.sales ? "" : "≈ "}${formatEuros(row.reference.amountCents)}` : "—"}
                      </td>
                      <td className="px-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <PriceCell row={row} onSaved={changed} />
                      </td>
                      <td className="hidden px-3 sm:table-cell"><StatusMark status={row.status} plannedOn={row.planned?.plannedOn} /></td>
                    </tr>
                  ))}
                </tbody>
                {!data && <StockRowsSkeleton wideSales={!selected} />}
              </table>
              {data && data.items.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">Aucune carte ne correspond.</p>}
            </div>
            {desktop ? inspector : selected && <Modal title="Carte" onClose={() => setSelected(null)}>{inspector}</Modal>}
          </div>
          {data && <Pagination page={page} pageCount={Math.ceil(data.total / PAGE_SIZE)} onChange={setPage} />}
          {planning && data && (
            <PlanModal
              channels={channels}
              selected={[...checked]}
              readyCount={data.counts.READY}
              onClose={() => setPlanning(false)}
              onPlanned={() => {
                setPlanning(false);
                setChecked(new Set());
                changed();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return desktop;
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2.5 border-t px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular text-sm font-medium">{children}</dd>
    </div>
  );
}

/** Panneau d'une carte : tout ce qui sert à la vendre, au même endroit. */
function Inspector({ offerId, version, channels, onChanged, onClose }: {
  offerId: string;
  version: number;
  channels: ChannelState[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.stockDetail(offerId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        // Le champ suit le prix enregistré, sans écraser une saisie en cours sur la même carte.
        if (loadedFor.current !== `${offerId}:${d.targetPriceCents}`) setPrice(d.targetPriceCents === null ? "" : eurosInput(d.targetPriceCents));
        loadedFor.current = `${offerId}:${d.targetPriceCents}`;
      })
      .catch((e: ApiError) => !cancelled && (e.status === 404 ? onClose() : setError(e.message)));
    return () => {
      cancelled = true;
    };
  }, [offerId, version, onClose]);

  async function run(action: () => Promise<string | void>) {
    setBusy(true);
    setError(null);
    try {
      const done = await action();
      if (done) toast.success(done);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  if (!detail) {
    return error ? <aside className="rounded-lg border bg-card p-4 text-sm text-muted-foreground lg:sticky lg:top-6">{error}</aside> : <InspectorSkeleton />;
  }
  const d = detail;
  const cents = parseEuros(price);
  const dirty = cents !== null && cents !== d.targetPriceCents;
  const savePrice = (value: number) => run(async () => {
    await api.setOfferPrice(d.offerId, { targetPriceCents: value });
  });
  const copy = (text: string, what: string) => void navigator.clipboard?.writeText(text).then(() => toast.success(`${what} copié${what === "Description" ? "e" : ""}`));
  const picture = d.photoUrl ?? cardImage(d.imageUrl, "high");

  return (
    <aside className="overflow-hidden rounded-lg border bg-card lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto" aria-label={`Carte ${d.name}`} data-testid="stock-inspector">
      <div className="flex gap-3 p-4">
        {picture
          ? <img src={picture} alt="" className={cn("w-24 shrink-0 rounded-md bg-muted object-cover ring-1 ring-border", d.photoUrl?.includes("/annonces/") ? "aspect-square" : "aspect-[63/88]")} />
          : <CardThumb imageUrl={null} size="lg" />}
        <div className="grid min-w-0 flex-1 content-start gap-1">
          <h2 className="text-base leading-snug font-semibold [overflow-wrap:anywhere]">{d.name}</h2>
          <p className="text-[13px] text-muted-foreground">{subtitle(d)} · {d.condition}</p>
          <div className="mt-1"><StatusMark status={d.status} /></div>
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer la fiche" className="hidden size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 lg:flex">
          <X className="size-4" />
        </button>
      </div>

      <dl className="grid grid-cols-4 gap-3 border-t px-4 py-3">
        <Figure label="En stock">{d.onHand}</Figure>
        <Figure label="Vendable">{d.available}</Figure>
        <Figure label="Coût">{formatEuros(d.averageCostCents)}</Figure>
        <Figure label="Marge">{d.targetPriceCents === null ? "—" : formatEuros(d.targetPriceCents - d.averageCostCents)}</Figure>
      </dl>

      <Section title="Prix">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (cents !== null && dirty) void savePrice(cents);
          }}
        >
          <span className="relative min-w-0 flex-1">
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={d.suggestedPriceCents === null ? "Prix de vente" : eurosInput(d.suggestedPriceCents)}
              aria-label="Prix de vente (€)"
              aria-invalid={price !== "" && cents === null}
              className="tabular h-10 w-full rounded-md border border-input bg-card pr-8 pl-3 text-base font-medium outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15 aria-invalid:border-destructive"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">€</span>
          </span>
          <Button type="submit" disabled={busy || !dirty}>Enregistrer</Button>
        </form>
        <div className="flex items-end justify-between gap-3">
          <div className="grid gap-1 text-[13px] text-muted-foreground">
            <SalesBasis reference={d.reference} sales={d.sales} />
            {d.suggestedPriceCents !== null && d.suggestedPriceCents !== d.targetPriceCents && (
              <p>
                Suggéré pour cet état : <span className="tabular font-medium text-foreground">{formatEuros(d.suggestedPriceCents)}</span>{" "}
                <button type="button" disabled={busy} onClick={() => savePrice(d.suggestedPriceCents!)} className="font-medium text-foreground underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring/40">
                  Accepter
                </button>
              </p>
            )}
            {d.priceReasons.map((r) => <p key={r} className="text-warning">{reasonLabel(r)}</p>)}
          </div>
        </div>
      </Section>

      <section className="border-t px-4 py-4">
        <PriceHistory variantId={d.variantId} />
      </section>

      <Section title="Annonce" aside={<Link href="/reglages/annonces" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Modèle et photos</Link>}>
        <div className="flex items-start gap-2">
          <p className="flex-1 text-sm leading-snug [overflow-wrap:anywhere]" data-testid="stock-listing-title">{d.text.title}</p>
          <Button variant="ghost" size="icon-sm" onClick={() => copy(d.text.title, "Titre")} aria-label="Copier le titre"><Copy /></Button>
        </div>
        <details className="text-[13px]">
          <summary className="cursor-pointer text-muted-foreground outline-none select-none hover:text-foreground focus-visible:underline">Description</summary>
          <div className="mt-2 flex items-start gap-2">
            <p className="flex-1 whitespace-pre-wrap">{d.text.description}</p>
            <Button variant="ghost" size="icon-sm" onClick={() => copy(d.text.description, "Description")} aria-label="Copier la description"><Copy /></Button>
          </div>
        </details>
        <OfferPhotos offerId={d.offerId} photos={d.photos} disabled={busy} run={(action) => void run(action)} />
        {d.photos.some((p) => p.kind === "SCAN_FRONT" || p.kind === "SCAN_BACK") && (
          <Button
            variant="outline" size="sm" className="justify-self-start" disabled={busy}
            onClick={() => run(async () => {
              const n = await composeMissingVisuals([d.offerId], undefined, { force: true, all: true });
              return `${n} photo${n > 1 ? "s" : ""} d'annonce composée${n > 1 ? "s" : ""}`;
            })}
          >
            <Wand2 /> {d.photos.some((p) => p.kind === "LISTING") ? "Recomposer les photos d'annonce" : "Composer les photos d'annonce"}
          </Button>
        )}
        {d.missing.length > 0 && <p className="text-[13px] text-muted-foreground">Pour publier, il manque {d.missing.map((m) => BLOCKERS[m]).join(" et ")}.</p>}
        {d.planned && (
          <p className="flex items-center gap-2 text-[13px]">
            <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="flex-1">Mise en ligne prévue {dayLabel(d.planned.plannedOn)}</span>
            <button type="button" disabled={busy} onClick={() => run(async () => { await api.cancelPublications({ offerId: d.offerId }); return "Mise en ligne annulée"; })} className="font-medium underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring/40">
              Annuler
            </button>
          </p>
        )}
        {channels.map((channel) => {
          const listing = d.listings.find((l) => l.channel === channel.id);
          return (
            <div key={channel.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2" data-testid={`stock-channel-${channel.id}`}>
              <span className="text-sm font-medium">{channel.label}</span>
              {(listing ? listing.simulated : channel.mode === "SIMULATION") && <span className="text-xs text-muted-foreground">simulation</span>}
              {listing ? (
                <>
                  <span className="tabular text-xs text-muted-foreground">
                    {listing.status === "ACTIVE" ? "en ligne" : listing.status === "PAUSED" ? "en pause" : "erreur"} · {listing.quantitySent} × {formatEuros(listing.priceCents)}
                  </span>
                  <span className="ml-auto flex gap-1">
                    {listing.simulated && listing.status === "ACTIVE" && (
                      <Button variant="ghost" size="icon-sm" disabled={busy} aria-label="Simuler un achat" title="Simuler un achat" onClick={() => run(async () => `Commande ${(await api.simulateOrder(listing.id)).externalId} reçue`)}><ShoppingCart /></Button>
                    )}
                    {d.available > 0 && (
                      <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Mettre à jour l'annonce ${channel.label}`} title="Mettre à jour" onClick={() => run(async () => { await api.publishListing(d.offerId, channel.id); return "Annonce mise à jour"; })}><RefreshCw /></Button>
                    )}
                    <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Retirer l'annonce ${channel.label}`} title="Retirer" onClick={() => run(async () => { await api.endListing(listing.id); return "Annonce retirée"; })}><X /></Button>
                  </span>
                </>
              ) : (
                <Button size="sm" variant="outline" className="ml-auto" disabled={busy || d.missing.length > 0 || d.available === 0} onClick={() => run(async () => { await composeMissingVisuals([d.offerId]); await api.publishListing(d.offerId, channel.id); return `Publiée sur ${channel.label}`; })}>
                  <Megaphone /> Publier
                </Button>
              )}
            </div>
          );
        })}
      </Section>

      <Section title={d.positions.length > 1 ? `${d.positions.length} positions` : "Position"}>
        <ul className="grid gap-1">
          {d.positions.map((p) => (
            <li key={p.id} className="flex items-center gap-3 text-[13px]">
              <Link href={`/inventaire/${p.unitSku}`} className="font-mono text-xs font-medium underline-offset-2 outline-none hover:underline focus-visible:underline">{p.unitSku}</Link>
              <Code className="text-xs text-muted-foreground">{p.locationCode}</Code>
              <span className="tabular ml-auto">× {p.onHand}</span>
              {p.lifecycle === "DRAFT" && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await api.activate(p.id); return "Position validée"; })}>Valider</Button>
              )}
            </li>
          ))}
        </ul>
      </Section>
      {error && <p role="alert" className="border-t px-4 py-3 text-sm text-destructive">{error}</p>}
    </aside>
  );
}

/** Planning des mises en ligne : ce qui part, quel jour, et ce qui n'a pas pu partir. */
function SchedulePanel({ schedule, channels, onChanged }: { schedule: Schedule; channels: ChannelState[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const label = (id: string) => channels.find((c) => c.id === id)?.label ?? id;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  async function run(action: () => Promise<string>) {
    setBusy(true);
    try {
      toast.success(await action());
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
      onChanged();
    }
  }
  const due = schedule.days.filter((d) => d.plannedOn <= today).reduce((sum, d) => sum + d.count, 0);
  return (
    <section className="overflow-hidden rounded-lg border bg-card" aria-label="Planning des mises en ligne" data-testid="schedule">
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted/50 px-4 py-2">
        <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="flex-1 text-[13px] font-medium">
          {schedule.pending} mise{schedule.pending > 1 ? "s" : ""} en ligne planifiée{schedule.pending > 1 ? "s" : ""} sur {schedule.days.length} jour{schedule.days.length > 1 ? "s" : ""}
        </h2>
        {due > 0 && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => {
            const r = await api.runPublications();
            return `${r.published} annonce${r.published > 1 ? "s" : ""} publiée${r.published > 1 ? "s" : ""}${r.failed ? `, ${r.failed} en échec` : ""}`;
          })}>
            Publier maintenant les {due} du jour
          </Button>
        )}
      </div>
      <ul className="divide-y text-sm">
        {schedule.days.map((d) => (
          <li key={`${d.plannedOn}-${d.channel}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
            <span className="w-28 font-medium first-letter:uppercase">{dayLabel(d.plannedOn)}</span>
            <span className="tabular w-36 text-muted-foreground">{d.count} carte{d.count > 1 ? "s" : ""} · {label(d.channel)}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{d.cardNames.join(", ")}{d.count > d.cardNames.length ? "…" : ""}</span>
            <Button variant="ghost" size="sm" disabled={busy} aria-label={`Annuler les mises en ligne du ${dayLabel(d.plannedOn)}`} onClick={() => run(async () => {
              const r = await api.cancelPublications({ plannedOn: d.plannedOn, channel: d.channel });
              return `${r.cancelled} mise${r.cancelled > 1 ? "s" : ""} en ligne annulée${r.cancelled > 1 ? "s" : ""}`;
            })}>
              Annuler
            </Button>
          </li>
        ))}
        {schedule.failed.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[13px]">
            <span className="size-2 rounded-full bg-destructive" aria-hidden />
            <span className="flex-1">
              <strong className="font-medium">{f.cardName}</strong> n'a pas pu être publiée {dayLabel(f.plannedOn)} : {PLAN_ERRORS[f.errorCode ?? ""] ?? "erreur du canal"}.
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
