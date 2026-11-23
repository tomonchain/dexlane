"use client";

import { Boxes, ChevronRight, CircleDollarSign, FileClock, PackageSearch, Search, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CardThumb } from "@/components/card-chooser";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Code, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { LIFECYCLE, formatEuros, formatNumber, positionSubtitle, positionTitle } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import type { InventoryPage, InventorySummary, Position } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ListSkeleton } from "@/components/skeletons";

const PAGE = 50;
const COLUMNS = "md:grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,11rem)_7rem_5.5rem_4rem_1rem]";

function Stat({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; tone?: "warning" }) {
  return (
    <Card className="grid gap-2 p-4">
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <span className="text-[13px] font-medium">{label}</span>
        <span className={cn("[&_svg]:size-4", tone === "warning" && "text-warning")}>{icon}</span>
      </div>
      <div className="tabular text-2xl leading-none font-semibold tracking-tight">{value}</div>
      <div className="min-h-4 text-xs text-muted-foreground">{hint}</div>
    </Card>
  );
}

function StatusBadge({ p }: { p: Position }) {
  if (p.lifecycle === "DRAFT") return <Badge variant="warning">{t(LIFECYCLE.DRAFT!)}</Badge>;
  if (p.lifecycle === "ARCHIVED") return <Badge variant="outline">{t(LIFECYCLE.ARCHIVED!)}</Badge>;
  if (p.reserved > 0) return <Badge variant="brand">{tn(p.reserved, "{n} réservée", "{n} réservées")}</Badge>;
  return <Badge variant="success">{t(LIFECYCLE.ACTIVE!)}</Badge>;
}

export default function InventoryPage() {
  const [q, setQ] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [kind, setKind] = useState("");
  const [location, setLocation] = useState("");
  const [page, setPage] = useState<InventoryPage | null>(null);
  const [items, setItems] = useState<Position[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);

  // Lien depuis l'écran Rangement : /inventaire?emplacement=BOX-03
  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get("emplacement");
    if (preset) setLocation(preset);
    api.inventorySummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  // Recherche différée : une requête par pause de frappe, la dernière réponse seule est affichée.
  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    const timer = setTimeout(() => {
      api.inventory({ q: q.trim(), lifecycle, kind, location: location.trim(), limit: PAGE })
        .then((r) => {
          if (id !== request.current) return;
          setPage(r);
          setItems(r.items);
          setError(null);
        })
        .catch((e: Error) => id === request.current && setError(e.message))
        .finally(() => id === request.current && setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, lifecycle, kind, location]);

  async function more() {
    const id = request.current;
    setLoading(true);
    try {
      const r = await api.inventory({ q: q.trim(), lifecycle, kind, location: location.trim(), limit: PAGE, offset: items.length });
      if (id === request.current) setItems((prev) => [...prev, ...r.items]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const filtered = q.trim() !== "" || lifecycle !== "" || kind !== "" || location.trim() !== "";

  return (
    <div className="grid gap-5">
      <PageHeader
        title={t("Inventaire")}
        description={t("Chaque ligne est une position physique : une carte (ou un lot) à un emplacement.")}
        actions={page && <span className="tabular text-sm text-muted-foreground" role="status">{tn(page.total, "{n} position", "{n} positions")}</span>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary ? (
          <>
            <Stat icon={<Boxes />} label={t("Cartes en stock")} value={formatNumber(summary.cards)} hint={summary.bulkCards > 0 ? t("dont {n} en vrac", { n: formatNumber(summary.bulkCards) }) : tn(summary.positions, "{n} position", "{n} positions")} />
            <Stat icon={<ShoppingBag />} label={t("Disponibles à la vente")} value={formatNumber(summary.sellable)} hint={summary.reserved > 0 ? t("{n} réservées", { n: formatNumber(summary.reserved) }) : t("hors vrac et brouillons")} />
            <Stat
              icon={<CircleDollarSign />}
              label={t("Valeur estimée")}
              value={formatEuros(summary.marketValueCents)}
              hint={`${t("coût d'achat {amount}", { amount: formatEuros(summary.costCents) })}${summary.unpricedCards > 0 ? ` · ${t("{n} sans prix", { n: formatNumber(summary.unpricedCards) })}` : ""}`}
            />
            <Stat
              icon={<FileClock />}
              label={t("Brouillons")}
              value={formatNumber(summary.drafts)}
              tone={summary.drafts > 0 ? "warning" : undefined}
              hint={summary.drafts > 0
                ? <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setLifecycle("DRAFT")}>{t("à valider")}</button>
                : t("rien à valider")}
            />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[6.5rem] rounded-xl" />)
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_10rem_12rem_13rem]">
        <span className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" placeholder={t("Nom de carte, SKU de position ou d'offre")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Rechercher")} autoCorrect="off" className="pl-9" />
        </span>
        <div className="grid grid-cols-2 gap-2 md:contents">
          <Select value={lifecycle} onChange={(e) => setLifecycle(e.target.value)} aria-label={t("Statut")}>
            <option value="">{t("En stock")}</option>
            <option value="ACTIVE">{t("Actives")}</option>
            <option value="DRAFT">{t("Brouillons")}</option>
            <option value="ARCHIVED">{t("Archivées")}</option>
            <option value="ALL">{t("Toutes")}</option>
          </Select>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t("Type")}>
            <option value="">{t("Tous les types")}</option>
            <option value="FUNGIBLE">{t("Interchangeables")}</option>
            <option value="UNIQUE">{t("Exemplaires uniques")}</option>
            <option value="BULK">{t("Vrac")}</option>
          </Select>
        </div>
        <Input placeholder={t("Emplacement (BOX-03…)")} value={location} onChange={(e) => setLocation(e.target.value)} aria-label={t("Emplacement")} autoCapitalize="characters" autoCorrect="off" className="font-mono" />
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      {!error && page && items.length === 0 && !loading && (
        <EmptyState
          icon={<PackageSearch />}
          title={filtered ? t("Aucune position ne correspond") : t("Le stock est vide")}
          action={!filtered && <Button asChild size="sm"><Link href="/ajouter">{t("Ajouter une première carte")}</Link></Button>}
        >
          {filtered ? t("Élargissez la recherche ou retirez un filtre.") : t("Les cartes entrées depuis le Scanner apparaîtront ici.")}
        </EmptyState>
      )}

      {items.length > 0 && (
        <Card className="overflow-hidden">
          <div className={cn("hidden gap-4 border-b bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid", COLUMNS)}>
            <span>{t("Carte")}</span><span>{t("Position")}</span><span>{t("Emplacement")}</span><span>{t("Statut")}</span><span className="text-right">{t("Prix cible")}</span><span className="text-right">{t("Stock")}</span><span />
          </div>
          <div className="divide-y">
            {items.map((p) => (
              <Link key={p.id} href={`/inventaire/${p.unitSku}`} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent", COLUMNS)}>
                <span className="flex min-w-0 items-center gap-3">
                  {p.card ? <CardThumb imageUrl={p.card.imageUrl} size="sm" /> : (
                    <span className="flex aspect-[63/88] w-11 shrink-0 items-center justify-center rounded-[5px] bg-muted text-muted-foreground ring-1 ring-border" aria-hidden><Boxes className="size-4" /></span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{positionTitle(p)}</span>
                    <span className="block truncate text-[13px] text-muted-foreground">{positionSubtitle(p)}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:hidden">
                      <Code>{p.unitSku}</Code><Code className="text-foreground/80">{p.locationCode}</Code><StatusBadge p={p} />
                    </span>
                  </span>
                </span>
                <Code className="hidden text-[13px] text-muted-foreground md:block">{p.unitSku}</Code>
                <Code className="hidden truncate text-[13px] md:block">{p.locationCode}</Code>
                <span className="hidden md:block"><StatusBadge p={p} /></span>
                <span className="tabular hidden text-right text-sm text-muted-foreground md:block">{p.offer?.targetPriceCents != null ? formatEuros(p.offer.targetPriceCents) : "—"}</span>
                <span className="tabular text-right text-base font-semibold md:text-sm" title={t("En stock")}>{formatNumber(p.onHand)}</span>
                <ChevronRight className="hidden size-4 text-muted-foreground md:block" aria-hidden />
              </Link>
            ))}
          </div>
        </Card>
      )}

      {loading && <ListSkeleton count={6} thumb label={t("Chargement de l'inventaire")} />}
      {page && items.length < page.total && !loading && (
        <Button variant="outline" onClick={more} className="justify-self-center">{t("Afficher la suite ({n} restantes)", { n: page.total - items.length })}</Button>
      )}
    </div>
  );
}
