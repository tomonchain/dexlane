"use client";

import { BadgeCheck, CalendarClock, Check, ChevronUp, Copy, Download, Images, Megaphone, MoveRight, RefreshCw, ScanLine, Search, ShoppingCart, SlidersHorizontal, Wand2, X } from "lucide-react";
import { DropdownMenu, Popover } from "radix-ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { AddMenu } from "@/components/add-menu";
import { CardThumb } from "@/components/card-chooser";
import { LocationPicker } from "@/components/location-picker";
import { OfferPhotos } from "@/components/offer-photos";
import { PhotoStack, PhotoViewer, type ViewerPhoto } from "@/components/photo-viewer";
import { PlanModal } from "@/components/plan-modal";
import { PriceHistory } from "@/components/price-history";
import { SalesBasis } from "@/components/sales-basis";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { ActionBar } from "@/components/ui/action-bar";
import { Code, Page, PageHeader, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { Pagination, SegmentedTabs } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { useCardImage } from "@/lib/card-image";
import { dayLabel, formatEuros, formatNumber, parseEuros, variantLabel } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import { CONFIDENCE_LABEL, age, eurosInput, quoteLabel, reasonLabel } from "@/lib/pricing";
import { CONDITIONS, type ChannelState, type ListingBlocker, type StockDetail, type StockFacets, type StockPage, type StockRow, type StockStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { composeMissingVisuals } from "@/lib/visuals";
import { exportStockCsv } from "@/lib/export";
import { InspectorSkeleton, StockRowsSkeleton } from "@/components/skeletons";
import { useCachedState } from "@/lib/cache";

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
const message = (e: unknown) => (e instanceof ApiError ? (ERRORS[e.code] ? t(ERRORS[e.code]!) : e.message) : (e as Error).message);
const subtitle = (r: StockRow) => `${r.setName ?? r.setId.toUpperCase()} · ${r.localNumber} · ${variantLabel(r)}`;


function StatusMark({ status, plannedOn }: { status: StockStatus; plannedOn?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap">
      <span className={cn("size-2 rounded-full", STATUS[status].dot)} aria-hidden />
      {plannedOn && status === "READY" ? t("Planifiée {day}", { day: dayLabel(plannedOn) }) : t(STATUS[status].label)}
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
        aria-label={t("Prix de {name}", { name: row.name })}
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
      <button type="button" onClick={() => edit(row.targetPriceCents)} aria-label={t("Modifier le prix de {name}", { name: row.name })} className="tabular h-7 rounded-md px-2 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30">
        {formatEuros(row.targetPriceCents)}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={() => edit(row.suggestedPriceCents)} aria-label={t("Fixer le prix de {name}", { name: row.name })} className="tabular h-7 rounded-md px-2 text-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30">
        {row.suggestedPriceCents === null ? t("Fixer") : formatEuros(row.suggestedPriceCents)}
      </button>
      {row.suggestedPriceCents !== null && (
        <button
          type="button"
          disabled={saving}
          onClick={() => save(row.suggestedPriceCents!)}
          aria-label={t("Accepter {price} pour {name}", { price: formatEuros(row.suggestedPriceCents), name: row.name })}
          title={t("Accepter le prix suggéré")}
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

const SORTS: { value: Sort; label: string }[] = [
  { value: "recent", label: "Plus récentes" },
  { value: "value", label: "Plus chères" },
  { value: "name", label: "Nom" },
];

/** Un filtre du panneau : libellé au-dessus, liste déroulante pleine largeur. */
function FilterSelect({ label, value, all, options, onChange }: {
  label: string; value: string; all: string; options: { value: string; label: string; count?: number }[]; onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={cn("h-9 w-full text-sm md:h-9", value && "border-primary/50 font-medium")}>
        <option value="">{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}{o.count !== undefined ? ` (${formatNumber(o.count)})` : ""}</option>)}
      </Select>
    </label>
  );
}

/** Les filtres posés, pour les puces sous la recherche : ce qu'ils filtrent et la valeur lisible. */
function activeFilters(filters: Filters, facets: StockFacets): { key: keyof Filters; label: string; value: string }[] {
  const out: { key: keyof Filters; label: string; value: string }[] = [];
  if (filters.setId) out.push({ key: "setId", label: t("Série"), value: facets.sets.find((x) => x.id === filters.setId)?.name ?? filters.setId });
  if (filters.location) out.push({ key: "location", label: t("Boîte"), value: filters.location });
  if (filters.condition) out.push({ key: "condition", label: t("État"), value: CONDITIONS.find((c) => c.code === filters.condition)?.label ?? filters.condition });
  if (filters.price) {
    const range = PRICE_RANGES.find((r) => r.value === filters.price);
    out.push({ key: "price", label: t("Prix"), value: range ? t(range.label) : filters.price });
  }
  return out;
}

/**
 * Filtres regroupés derrière un seul bouton : la barre reste lisible, le nombre de filtres posés s'affiche sur le bouton.
 * Sur téléphone, le tri y est aussi.
 */
function FiltersPopover({ facets, filters, onChange, onClear, sort, onSort, desktop }: {
  facets: StockFacets | null; filters: Filters; onChange: (key: keyof Filters, value: string) => void; onClear: () => void; sort: Sort; onSort: (sort: Sort) => void;
  desktop: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = Object.values(filters).filter(Boolean).length;
  const trigger = (
    <Button variant="outline" className="h-9 shrink-0 px-3" onClick={desktop ? undefined : () => setOpen(true)}
      aria-label={active > 0 ? tn(active, "Filtres, {n} actif", "Filtres, {n} actifs") : t("Filtres")} data-testid="stock-filters-button">
      <SlidersHorizontal />
      <span className="hidden sm:inline">{t("Filtres")}</span>
      {active > 0 && <span className="tabular flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{active}</span>}
    </Button>
  );
  const fields = (close: ReactNode) => (
    <>
      {!desktop && (
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("Trier par")}</span>
          <Select value={sort} onChange={(e) => onSort(e.target.value as Sort)} className="h-10 w-full text-sm md:h-10">
            {SORTS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
          </Select>
        </label>
      )}
      {facets && (
        <>
          <FilterSelect label={t("Série")} value={filters.setId} onChange={(v) => onChange("setId", v)} all={t("Toutes les séries")}
            options={facets.sets.map((x) => ({ value: x.id, label: x.name, count: x.cards }))} />
          <FilterSelect label={t("Boîte")} value={filters.location} onChange={(v) => onChange("location", v)} all={t("Toutes les boîtes")}
            options={facets.locations.map((l) => ({ value: l.code, label: l.code, count: l.cards }))} />
          <FilterSelect label={t("État")} value={filters.condition} onChange={(v) => onChange("condition", v)} all={t("Tous les états")}
            options={facets.conditions.map((c) => ({ value: c.code, label: `${c.code} · ${CONDITIONS.find((k) => k.code === c.code)?.label ?? c.code}`, count: c.cards }))} />
        </>
      )}
      <FilterSelect label={t("Prix")} value={filters.price} onChange={(v) => onChange("price", v)} all={t("Tous les prix")}
        options={PRICE_RANGES.map((r) => ({ value: r.value, label: t(r.label) }))} />
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <Button variant="ghost" size={desktop ? "sm" : "default"} onClick={onClear} disabled={active === 0}>{t("Effacer")}</Button>
        {close}
      </div>
    </>
  );

  // Sur téléphone, un tiroir depuis le bas : des champs pleine largeur, atteignables au pouce.
  if (!desktop) {
    return (
      <>
        {trigger}
        {open && (
          <Modal title={t("Filtres du stock")} onClose={() => setOpen(false)}>
            <div className="grid gap-4">{fields(<Button onClick={() => setOpen(false)}>{t("Voir les cartes")}</Button>)}</div>
          </Modal>
        )}
      </>
    );
  }
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 grid w-[min(20rem,calc(100vw-2rem))] gap-3 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          aria-label={t("Filtres du stock")}
        >
          {fields(<Popover.Close asChild><Button size="sm">{t("Voir les cartes")}</Button></Popover.Close>)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Actions sur les cartes cochées, dans une barre fixée en bas : ce qu'elles permettent dépend de leur état
 * (prix suggéré à accepter, brouillons à valider). Sur téléphone, les actions se replient dans un menu.
 */
function SelectionBar({ rows, busy, onClear, onBulk, onMove, onPlan }: {
  rows: StockRow[];
  busy: boolean;
  onClear: () => void;
  onBulk: (action: "ACCEPT_PRICE" | "ACTIVATE") => void;
  onMove: () => void;
  onPlan: () => void;
}) {
  const toPrice = rows.filter((r) => r.targetPriceCents === null && r.suggestedPriceCents !== null).length;
  const drafts = rows.filter((r) => r.draft > 0).length;
  const actions: { key: string; label: string; icon: ReactNode; onSelect: () => void; primary?: boolean }[] = [
    ...(toPrice > 0 ? [{ key: "price", label: t("Accepter les prix ({n})", { n: formatNumber(toPrice) }), icon: <Check />, onSelect: () => onBulk("ACCEPT_PRICE") }] : []),
    ...(drafts > 0 ? [{ key: "activate", label: t("Valider les brouillons ({n})", { n: formatNumber(drafts) }), icon: <BadgeCheck />, onSelect: () => onBulk("ACTIVATE") }] : []),
    { key: "move", label: t("Déplacer"), icon: <MoveRight />, onSelect: onMove },
    { key: "csv", label: t("Exporter"), icon: <Download />, onSelect: () => exportStockCsv(rows) },
    { key: "plan", label: t("Mettre en ligne"), icon: <CalendarClock />, onSelect: onPlan, primary: true },
  ];
  const n = rows.length;
  return (
    <ActionBar message={<span className="flex flex-wrap items-center gap-x-3"><strong className="font-semibold text-foreground">{tn(n, "{n} carte sélectionnée", "{n} cartes sélectionnées")}</strong>
      <button type="button" onClick={onClear} className="text-xs underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline">{t("Désélectionner")}</button></span>}
    >
      {busy && <Spinner />}
      <span className="hidden items-center gap-2 md:flex" data-testid="selection-actions">
        {actions.map((a) => (
          <Button key={a.key} size="sm" variant={a.primary ? "default" : "outline"} disabled={busy} onClick={a.onSelect}>{a.icon} {a.label}</Button>
        ))}
      </span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button size="sm" disabled={busy} className="md:hidden">{t("Actions")} <ChevronUp /></Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content side="top" align="end" sideOffset={8} className="z-50 w-60 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            {actions.map((a) => (
              <DropdownMenu.Item key={a.key} onSelect={a.onSelect} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground">
                {a.icon} {a.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </ActionBar>
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
  const params = useSearchParams();
  const requested = params.get("statut") as Filter | null;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(requested && FILTERS.includes(requested) ? requested : "ALL");
  const [sort, setSort] = useState<Sort>("recent");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [facets, setFacets] = useCachedState<StockFacets>("stock:facets");
  const [page, setPage] = useState(1);
  const [data, setData] = useCachedState<StockPage>(`stock:${JSON.stringify([query.trim(), filter, sort, page, filters])}`, { keepPrevious: true });
  const [error, setError] = useState<string | null>(null);
  // La fiche d'une carte renvoie ici sur une offre précise (« ?offre=… ») : son panneau s'ouvre d'emblée.
  const [selected, setSelected] = useState<string | null>(params.get("offre"));
  const [version, setVersion] = useState(0);
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [accepting, setAccepting] = useState(false);
  // La sélection garde les lignes elles-mêmes : les actions groupées en ont besoin, même d'une page à l'autre.
  const [checked, setChecked] = useState<Map<string, StockRow>>(new Map());
  const [scheduled, setScheduled] = useState(0);
  const [planning, setPlanning] = useState(false);
  const [moving, setMoving] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
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
    api.schedule().then((r) => setScheduled(r.pending)).catch(() => setScheduled(0));
  }, []);
  useEffect(loadSchedule, [loadSchedule]);

  const changed = useCallback(() => {
    load();
    loadSchedule();
    setVersion((v) => v + 1);
  }, [load, loadSchedule]);

  const toggle = (row: StockRow) => setChecked((current) => {
    const next = new Map(current);
    if (!next.delete(row.offerId)) next.set(row.offerId, row);
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
      toast.success(tn(done, "{n} prix accepté", "{n} prix acceptés"));
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
  const clearFilters = () => {
    setFilters(NO_FILTERS);
    setPage(1);
  };
  async function bulk(action: "ACCEPT_PRICE" | "ACTIVATE" | "MOVE", locationCode?: string) {
    const offerIds = [...checked.keys()];
    setBulkBusy(true);
    try {
      const { affected } = await api.stockBulk(action === "MOVE" ? { action, offerIds, locationCode: locationCode! } : { action, offerIds });
      toast.success(
        action === "ACCEPT_PRICE" ? tn(affected, "{n} prix accepté", "{n} prix acceptés")
          : action === "ACTIVATE" ? tn(affected, "{n} exemplaire validé", "{n} exemplaires validés")
          : affected === 0 ? t("Déjà rangées dans {code}", { code: locationCode! })
          : tn(affected, "{n} position déplacée dans {code}", "{n} positions déplacées dans {code}", { code: locationCode! }),
      );
      setChecked(new Map());
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBulkBusy(false);
      changed();
    }
  }
  const empty = data && data.counts.ALL === 0 && !query && !filtered;
  const setFilterValue = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const inspector = selected && (
    <Inspector key={selected} offerId={selected} version={version} channels={channels} onChanged={changed} onClose={() => setSelected(null)} />
  );

  return (
    <Page className="gap-4">
      <PageHeader
        title={t("Stock")}
        meta={data && data.counts.ALL > 0 && (
          <span className="tabular" data-testid="stock-totals">
            {tn(data.totals.cards, "{n} carte", "{n} cartes")} · {formatEuros(data.totals.valueCents)}
          </span>
        )}
        actions={<>
          <Button asChild variant="outline">
            <Link href="/mises-en-ligne">
              <CalendarClock /> {t("Mises en ligne")}
              {scheduled > 0 && <span className="tabular rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">{scheduled}</span>}
            </Link>
          </Button>
          <AddMenu />
        </>}
      />

      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive">{error}</p>}

      {empty ? (
        <div className="grid justify-items-center gap-4 rounded-lg border border-dashed px-6 py-16 text-center">
          <div className="grid gap-1">
            <p className="text-base font-semibold">{t("Votre stock est vide")}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t("Faites entrer vos cartes : elles sont identifiées, estimées, puis prêtes à vendre.")}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild><Link href="/scanner/lot"><Images /> {t("Importer un lot d'images")}</Link></Button>
            <Button asChild variant="outline"><Link href="/ajouter"><ScanLine /> {t("Ajouter une carte")}</Link></Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3">
            <div>
              <SegmentedTabs
                label={t("Statut")}
                value={filter}
                onChange={(next) => {
                  setFilter(next);
                  setPage(1);
                }}
                tabs={[
                  { value: "ALL", label: t("Tout"), count: data?.counts.ALL },
                  { value: "TO_PRICE", label: t("À tarifer"), count: data?.counts.TO_PRICE },
                  { value: "READY", label: t("Prêtes"), count: data?.counts.READY },
                  { value: "LISTED", label: t("En ligne"), count: data?.counts.LISTED },
                  { value: "DRAFT", label: t("Brouillons"), count: data?.counts.DRAFT },
                ]}
              />
            </div>

            <div className="flex items-center gap-2" role="search">
              <div className="relative min-w-0 flex-1 sm:max-w-md">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder={t("Nom, série, numéro ou référence")}
                  aria-label={t("Rechercher dans le stock")}
                  className="h-9 w-full rounded-md border border-input bg-card pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15"
                />
              </div>
              <FiltersPopover facets={facets} filters={filters} onChange={setFilterValue} onClear={clearFilters} sort={sort} onSort={setSort} desktop={desktop} />
              <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t("Trier")} className="hidden h-9 w-auto text-sm lg:ml-auto lg:block md:h-9">
                {SORTS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
              </Select>
            </div>

            {filtered && facets && (
              <div className="flex flex-wrap items-center gap-1.5" data-testid="stock-filters" aria-label={t("Filtres actifs")}>
                {activeFilters(filters, facets).map((f) => (
                  <span key={f.key} className="inline-flex h-7 items-center gap-1 rounded-full border bg-accent pr-1 pl-2.5 text-xs font-medium">
                    <span className="text-muted-foreground">{t("{label} :", { label: f.label })}</span> {f.value}
                    <button type="button" onClick={() => setFilterValue(f.key, "")} aria-label={t("Retirer le filtre {label}", { label: f.label })} className="flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <button type="button" onClick={clearFilters} className="px-1.5 text-xs font-medium text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline">
                  {t("Tout effacer")}
                </button>
              </div>
            )}
          </div>

          {suggested.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <Check className="size-4 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 text-muted-foreground">
                {tn(suggested.length, "{n} carte a un prix suggéré à valider sur cette page.", "{n} cartes ont un prix suggéré à valider sur cette page.")}
              </span>
              <Button variant="outline" size="sm" onClick={acceptAll} disabled={accepting}>
                {accepting ? <Spinner /> : <Check />} {t("Accepter les {n} prix suggérés", { n: formatNumber(suggested.length) })}
              </Button>
            </div>
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
                        aria-label={t("Sélectionner toutes les cartes de la page")}
                        onChange={() => setChecked((current) => {
                          const next = new Map(current);
                          for (const row of data?.items ?? []) if (allChecked) next.delete(row.offerId); else next.set(row.offerId, row);
                          return next;
                        })}
                        className="size-4 cursor-pointer accent-foreground"
                      />
                    </th>
                    <th className="h-9 px-3 font-medium">{t("Carte")}</th>
                    <th className="hidden px-3 font-medium sm:table-cell">{t("État")}</th>
                    <th className="px-3 text-right font-medium">{t("Qté")}</th>
                    <th className="hidden px-3 font-medium md:table-cell">{t("Emplacement")}</th>
                    <th className={cn("hidden px-3 text-right font-medium", selected ? "2xl:table-cell" : "lg:table-cell")} title={t("Prix estimé d'après les ventes réussies, toutes langues et tous états confondus")}>{t("Cote ventes")}</th>
                    <th className="px-3 text-right font-medium">{t("Prix")}</th>
                    <th className="hidden px-3 font-medium sm:table-cell">{t("Statut")}</th>
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
                        <input type="checkbox" checked={checked.has(row.offerId)} onChange={() => toggle(row)} aria-label={t("Sélectionner {name} {condition}", { name: row.name, condition: row.condition })} className="size-4 cursor-pointer accent-foreground" />
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-3">
                          {row.photoUrl
                            ? <img src={row.photoUrl} alt="" loading="lazy" className="aspect-[63/88] w-8 shrink-0 rounded-[3px] bg-muted object-cover ring-1 ring-border" />
                            : <CardThumb imageUrl={row.imageUrl} size="sm" className="w-8 rounded-[3px]" />}
                          <span className="grid min-w-0">
                            <span className="truncate font-medium">{row.name}</span>
                            <span className="truncate text-xs text-muted-foreground"><span className="sm:hidden">{row.condition} · </span>{subtitle(row)}</span>
                          </span>
                        </span>
                      </td>
                      <td className="hidden px-3 font-mono text-xs sm:table-cell">{row.condition}</td>
                      <td className="tabular px-3 text-right whitespace-nowrap">
                        {row.onHand}
                        {row.reserved > 0 && <span className="block text-[11px] leading-tight text-muted-foreground" title={tn(row.reserved, "{n} réservée par une vente", "{n} réservées par une vente")}>{t("{n} rés.", { n: formatNumber(row.reserved) })}</span>}
                      </td>
                      <td className="hidden px-3 md:table-cell">
                        <Code className="text-xs">{row.locations[0]}</Code>
                        {row.locations.length > 1 && <span className="text-xs text-muted-foreground"> +{row.locations.length - 1}</span>}
                      </td>
                      <td className={cn("tabular hidden px-3 text-right text-muted-foreground", selected ? "2xl:table-cell" : "lg:table-cell")} title={row.reference ? (row.sales
                        ? t("Ventes réussies Cardmarket ({confidence}), relevées {age}", { confidence: t(CONFIDENCE_LABEL[row.sales.confidence]), age: age(row.reference.observedAt) })
                        : t("Aucune vente récente : {quote} des annonces Cardmarket, relevée {age}", { quote: quoteLabel(row.reference.quoteType).toLowerCase(), age: age(row.reference.observedAt) })) : undefined}>
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
              {data && data.items.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("Aucune carte ne correspond.")}</p>}
            </div>
            {desktop ? inspector : selected && <Modal title={t("Carte")} onClose={() => setSelected(null)}>{inspector}</Modal>}
          </div>
          {data && <Pagination page={page} pageCount={Math.ceil(data.total / PAGE_SIZE)} onChange={setPage} />}
        </>
      )}

      {checked.size > 0 && (
        <SelectionBar
          rows={[...checked.values()]}
          busy={bulkBusy}
          onClear={() => setChecked(new Map())}
          onBulk={bulk}
          onMove={() => setMoving(true)}
          onPlan={() => {
            if (channels.length > 0) setPlanning(true);
            else toast.error(t("Aucun canal de vente actif"), { description: t("Activez eBay ou CardTrader, en simulation ou en réel, dans Réglages › Canaux de vente.") });
          }}
        />
      )}
      {moving && (
        <LocationPicker value="" onClose={() => setMoving(false)} onPick={(code) => {
          setMoving(false);
          void bulk("MOVE", code);
        }} />
      )}
      {planning && data && (
        <PlanModal
          channels={channels}
          selected={[...checked.keys()]}
          readyCount={data.counts.READY}
          onClose={() => setPlanning(false)}
          onPlanned={() => {
            setPlanning(false);
            setChecked(new Map());
            changed();
          }}
        />
      )}
    </Page>
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

function Figure({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5" title={hint}>
      <dt className="text-xs text-muted-foreground">{label}{hint && <span className="sr-only">{t(" : {hint}", { hint })}</span>}</dt>
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
  const [detail, setDetail] = useCachedState<StockDetail>(`stock:detail:${offerId}`);
  const [supplies, setSupplies] = useState(0);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);
  // Sleeve et top-loader : ce que coûte chaque carte vendue, en plus de son prix d'achat.
  useEffect(() => {
    api.shippingCosts().then((c) => setSupplies(c.supplies.sleeveCents + c.supplies.toploaderCents)).catch(() => setSupplies(0));
  }, []);

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

  // Avant tout retour anticipé : un hook s'appelle à chaque rendu.
  const catalogPicture = useCardImage(detail?.imageUrl ?? null, "high");
  const [viewing, setViewing] = useState<number | null>(null);
  if (!detail) {
    return error ? <aside className="rounded-lg border bg-card p-4 text-sm text-muted-foreground lg:sticky lg:top-6">{error}</aside> : <InspectorSkeleton />;
  }
  const d = detail;
  const cents = parseEuros(price);
  const dirty = cents !== null && cents !== d.targetPriceCents;
  const savePrice = (value: number) => run(async () => {
    await api.setOfferPrice(d.offerId, { targetPriceCents: value });
  });
  const copy = (text: string, done: string) => void navigator.clipboard?.writeText(text).then(() => toast.success(done));
  // Les vues de l'exemplaire : scans recto et verso, visuels d'annonce, puis l'image du catalogue.
  const frontScan = d.photos.find((p) => p.kind === "SCAN_FRONT");
  const backScan = d.photos.find((p) => p.kind === "SCAN_BACK");
  const visuals = d.photos.filter((p) => p.kind === "LISTING");
  const views: ViewerPhoto[] = [
    ...(frontScan ? [{ src: frontScan.url, label: t("Recto") }] : []),
    ...(backScan ? [{ src: backScan.url, label: t("Verso") }] : []),
    ...visuals.map((p, i) => ({ src: p.url, label: visuals.length > 1 ? t("Photo d'annonce {n}", { n: i + 1 }) : t("Photo d'annonce"), shape: "square" as const })),
    ...(catalogPicture.src ? [{ src: catalogPicture.src, label: t("Image du catalogue") }] : []),
  ];

  return (
    <aside className="overflow-hidden rounded-lg border bg-card lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto" aria-label={t("Carte {name}", { name: d.name })} data-testid="stock-inspector">
      <div className="flex gap-3 p-4">
        {views.length > 0
          ? <PhotoStack front={views[0]!} back={frontScan && backScan ? views[1] : null} onOpen={setViewing} className="w-24" />
          : <CardThumb imageUrl={null} size="lg" />}
        {viewing !== null && <PhotoViewer photos={views} start={viewing} title={`${d.name} · ${d.condition}`} onClose={() => setViewing(null)} />}
        <div className="grid min-w-0 flex-1 content-start gap-1">
          <h2 className="text-base leading-snug font-semibold [overflow-wrap:anywhere]">
            <Link href={`/carte/${d.catalogCardId}`} className="underline-offset-2 outline-none hover:underline focus-visible:underline" title={t("Fiche de la carte : toutes ses variantes et tous ses exemplaires")}>{d.name}</Link>
          </h2>
          <p className="text-[13px] text-muted-foreground">{subtitle(d)} · {d.condition}</p>
          <div className="mt-1"><StatusMark status={d.status} /></div>
        </div>
        <button type="button" onClick={onClose} aria-label={t("Fermer la fiche")} className="hidden size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 lg:flex">
          <X className="size-4" />
        </button>
      </div>

      <dl className="grid grid-cols-4 gap-3 border-t px-4 py-3">
        <Figure label={t("En stock")}>{d.onHand}</Figure>
        <Figure label={t("Vendable")}>{d.available}</Figure>
        <Figure label={t("Coût")}>{formatEuros(d.averageCostCents)}</Figure>
        <Figure label={t("Marge")} hint={t("{formula}. L'affranchissement et l'enveloppe se comptent sur la vente, en face du port facturé.", {
          formula: supplies > 0 ? t("Prix − coût d'achat − sleeve et top-loader ({price})", { price: formatEuros(supplies) }) : t("Prix − coût d'achat"),
        })}>
          <span data-testid="stock-margin">{d.targetPriceCents === null ? "—" : formatEuros(d.targetPriceCents - d.averageCostCents - supplies)}</span>
        </Figure>
      </dl>

      <Section title={t("Prix")}>
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
              placeholder={d.suggestedPriceCents === null ? t("Prix de vente") : eurosInput(d.suggestedPriceCents)}
              aria-label={t("Prix de vente (€)")}
              aria-invalid={price !== "" && cents === null}
              className="tabular h-10 w-full rounded-md border border-input bg-card pr-8 pl-3 text-base font-medium outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15 aria-invalid:border-destructive"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">€</span>
          </span>
          <Button type="submit" disabled={busy || !dirty}>{t("Enregistrer")}</Button>
        </form>
        <div className="flex items-end justify-between gap-3">
          <div className="grid gap-1 text-[13px] text-muted-foreground">
            <SalesBasis reference={d.reference} sales={d.sales} />
            {d.suggestedPriceCents !== null && d.suggestedPriceCents !== d.targetPriceCents && (
              <p>
                {t("Suggéré pour cet état :")} <span className="tabular font-medium text-foreground">{formatEuros(d.suggestedPriceCents)}</span>{" "}
                <button type="button" disabled={busy} onClick={() => savePrice(d.suggestedPriceCents!)} className="font-medium text-foreground underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring/40">
                  {t("Accepter")}
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

      <Section title={t("Annonce")} aside={<Link href="/reglages/annonces" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{t("Modèle et photos")}</Link>}>
        <div className="flex items-start gap-2">
          <p className="flex-1 text-sm leading-snug [overflow-wrap:anywhere]" data-testid="stock-listing-title">{d.text.title}</p>
          <Button variant="ghost" size="icon-sm" onClick={() => copy(d.text.title, t("Titre copié"))} aria-label={t("Copier le titre")}><Copy /></Button>
        </div>
        <details className="text-[13px]">
          <summary className="cursor-pointer text-muted-foreground outline-none select-none hover:text-foreground focus-visible:underline">{t("Description")}</summary>
          <div className="mt-2 flex items-start gap-2">
            <p className="flex-1 whitespace-pre-wrap">{d.text.description}</p>
            <Button variant="ghost" size="icon-sm" onClick={() => copy(d.text.description, t("Description copiée"))} aria-label={t("Copier la description")}><Copy /></Button>
          </div>
        </details>
        <OfferPhotos offerId={d.offerId} photos={d.photos} disabled={busy} run={(action) => void run(action)} onOpen={(photo) => setViewing(Math.max(0, views.findIndex((v) => v.src === photo.url)))} />
        {d.photos.some((p) => p.kind === "SCAN_FRONT" || p.kind === "SCAN_BACK") && (
          <Button
            variant="outline" size="sm" className="justify-self-start" disabled={busy}
            onClick={() => run(async () => {
              const n = await composeMissingVisuals([d.offerId], undefined, { force: true, all: true });
              return tn(n, "{n} photo d'annonce composée", "{n} photos d'annonce composées");
            })}
          >
            <Wand2 /> {d.photos.some((p) => p.kind === "LISTING") ? t("Recomposer les photos d'annonce") : t("Composer les photos d'annonce")}
          </Button>
        )}
        {d.missing.length > 0 && <p className="text-[13px] text-muted-foreground">{t("Pour publier, il manque {list}.", { list: d.missing.map((m) => t(BLOCKERS[m])).join(t(" et ")) })}</p>}
        {d.planned && (
          <p className="flex items-center gap-2 text-[13px]">
            <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="flex-1">{t("Mise en ligne prévue {day}", { day: dayLabel(d.planned.plannedOn) })}</span>
            <button type="button" disabled={busy} onClick={() => run(async () => { await api.cancelPublications({ offerId: d.offerId }); return t("Mise en ligne annulée"); })} className="font-medium underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring/40">
              {t("Annuler")}
            </button>
          </p>
        )}
        {channels.map((channel) => {
          const listing = d.listings.find((l) => l.channel === channel.id);
          return (
            <div key={channel.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2" data-testid={`stock-channel-${channel.id}`}>
              <span className="text-sm font-medium">{channel.label}</span>
              {(listing ? listing.simulated : channel.mode === "SIMULATION") && <span className="text-xs text-muted-foreground">{t("simulation")}</span>}
              {listing ? (
                <>
                  <span className="tabular text-xs text-muted-foreground">
                    {listing.status === "ACTIVE" ? t("en ligne") : listing.status === "PAUSED" ? t("en pause") : t("erreur")} · {listing.quantitySent} × {formatEuros(listing.priceCents)}
                  </span>
                  <span className="ml-auto flex gap-1">
                    {listing.simulated && listing.status === "ACTIVE" && (
                      <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t("Simuler un achat")} title={t("Simuler un achat")} onClick={() => run(async () => t("Commande {id} reçue", { id: (await api.simulateOrder(listing.id)).externalId }))}><ShoppingCart /></Button>
                    )}
                    {d.available > 0 && (
                      <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t("Mettre à jour l'annonce {channel}", { channel: channel.label })} title={t("Mettre à jour")} onClick={() => run(async () => { await api.publishListing(d.offerId, channel.id); return t("Annonce mise à jour"); })}><RefreshCw /></Button>
                    )}
                    <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t("Retirer l'annonce {channel}", { channel: channel.label })} title={t("Retirer")} onClick={() => run(async () => { await api.endListing(listing.id); return t("Annonce retirée"); })}><X /></Button>
                  </span>
                </>
              ) : (
                <Button size="sm" variant="outline" className="ml-auto" disabled={busy || d.missing.length > 0 || d.available === 0} onClick={() => run(async () => { await composeMissingVisuals([d.offerId]); await api.publishListing(d.offerId, channel.id); return t("Publiée sur {channel}", { channel: channel.label }); })}>
                  <Megaphone /> {t("Publier")}
                </Button>
              )}
            </div>
          );
        })}
      </Section>

      <Section title={d.positions.length > 1 ? t("{n} positions", { n: formatNumber(d.positions.length) }) : t("Position")}>
        <ul className="grid gap-1">
          {d.positions.map((p) => (
            <li key={p.id} className="flex items-center gap-3 text-[13px]">
              <Link href={`/inventaire/${p.unitSku}`} className="font-mono text-xs font-medium underline-offset-2 outline-none hover:underline focus-visible:underline">{p.unitSku}</Link>
              <Code className="text-xs text-muted-foreground">{p.locationCode}</Code>
              <span className="tabular ml-auto">× {p.onHand}</span>
              {p.lifecycle === "DRAFT" && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await api.activate(p.id); return t("Position validée"); })}>{t("Valider")}</Button>
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
