"use client";

import { BookOpen, ChevronRight, CloudDownload, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Code, EmptyState, Loading, PageHeader, Spinner } from "@/components/ui/misc";
import { Pagination, SegmentedTabs, paginate } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { CATALOG_LANGUAGES, catalogMessage, fold, importedLabel } from "@/lib/catalog";
import { formatDateTime } from "@/lib/format";
import { useStored } from "@/lib/storage";
import type { CatalogSet, SetSyncReport } from "@/lib/types";

const PAGE_SIZE = 12;
type Tab = "imported" | "pending";
type Outcome = { kind: "success" | "warning" | "destructive"; text: string };

export default function CatalogPage() {
  const [language, setLanguage, ready] = useStored("dexlane.catalog.language", "fr");
  const [sets, setSets] = useState<CatalogSet[] | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  const load = useCallback(
    () => api.catalogSets(language).then((r) => setSets(r.sets)).catch((e) => setError(catalogMessage(e))),
    [language],
  );
  useEffect(() => {
    if (!ready) return;
    setSets(null);
    setTab(null);
    setOutcomes({});
    setError(null);
    void load();
  }, [ready, load]);

  const imported = useMemo(() => (sets ?? []).filter((s) => s.cardsSynced > 0), [sets]);
  const pending = useMemo(() => (sets ?? []).filter((s) => s.cardsSynced === 0), [sets]);
  // Onglet d'arrivée : les séries importées s'il y en a, sinon celles qui restent à importer.
  const currentTab: Tab = tab ?? (imported.length > 0 ? "imported" : "pending");

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      await api.refreshCatalogSets(language);
      await load();
    } catch (e) {
      setError(catalogMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function sync(set: CatalogSet) {
    setSyncing(set.id);
    setOutcomes(({ [set.id]: _, ...rest }) => rest);
    try {
      const report: SetSyncReport = await api.syncCatalogSet(set.id, language);
      const outcome: Outcome = report.errorCount
        ? { kind: "warning", text: `${importedLabel(report.cards)}, ${report.errorCount} en échec : relancez pour les compléter.` }
        : { kind: "success", text: `${importedLabel(report.cards)} (variantes : ${report.variants}, cotations : ${report.pricesInserted}).` };
      setOutcomes((o) => ({ ...o, [set.id]: outcome }));
      // La série change d'onglet : on la suit pour que le résultat reste sous les yeux.
      if (report.cards > 0) {
        setTab("imported");
        setPage(1);
        setFilter("");
      }
    } catch (e) {
      setOutcomes((o) => ({ ...o, [set.id]: { kind: "destructive", text: catalogMessage(e) } }));
    } finally {
      setSyncing(null);
      void load();
    }
  }

  const wanted = fold(filter.trim());
  const inTab = currentTab === "imported" ? imported : pending;
  const matching = useMemo(
    () => {
      const list = inTab.filter((s) => !wanted || fold(s.name).includes(wanted) || s.id.includes(wanted));
      // Une série qu'on vient d'importer remonte en tête de son onglet.
      return [...list].sort((a, b) => Number(!!outcomes[b.id]) - Number(!!outcomes[a.id]));
    },
    [inTab, wanted, outcomes],
  );
  const view = paginate(matching, page, PAGE_SIZE);

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Catalogue"
        description="Le scan et la recherche ne trouvent que les cartes des séries importées. Réimporter une série met à jour ses cartes et ajoute les cotations du jour."
        actions={
          <Button variant="outline" onClick={refresh} disabled={refreshing || syncing !== null}>
            {refreshing ? <Spinner /> : <RefreshCw />} {sets?.length ? "Actualiser la liste" : "Charger la liste"}
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Field label="Langue des cartes">
          <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {CATALOG_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </Select>
        </Field>
        <Field label="Filtrer les séries">
          <span className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              placeholder="Nom ou identifiant (151, swsh3…)"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
              autoCorrect="off"
              className="pl-9"
            />
          </span>
        </Field>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {!sets && !error && <Loading />}
      {sets?.length === 0 && !refreshing && (
        <EmptyState icon={<BookOpen />} title="Aucune série connue pour cette langue" action={<Button size="sm" onClick={refresh}><CloudDownload /> Charger la liste</Button>}>
          Chargez la liste des séries, puis importez celles que vous possédez.
        </EmptyState>
      )}

      {sets && sets.length > 0 && (
        <>
          <SegmentedTabs
            label="Séries"
            value={currentTab}
            onChange={(next) => {
              setTab(next);
              setPage(1);
            }}
            tabs={[
              { value: "imported", label: "Importées", count: imported.length },
              { value: "pending", label: "Non importées", count: pending.length },
            ]}
          />

          {view.items.length > 0 ? (
            <Card className="divide-y overflow-hidden" role="tabpanel">
              {view.items.map((s) => {
                const total = s.cardCountTotal ?? s.cardCountOfficial;
                const outcome = outcomes[s.id];
                const busy = syncing === s.id;
                const isImported = s.cardsSynced > 0;
                const meta = (
                  <>
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{s.name}</span>
                      {isImported && <Badge variant="success">{s.cardsSynced} carte{s.cardsSynced > 1 ? "s" : ""}</Badge>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      <Code>{s.id}</Code>
                      {total ? ` · ${total} cartes` : ""}
                      {s.releaseDate ? ` · ${s.releaseDate.slice(0, 4)}` : ""}
                      {isImported && s.cardsSyncedAt ? ` · importée le ${formatDateTime(s.cardsSyncedAt)}` : ""}
                    </span>
                  </>
                );
                return (
                  <div key={s.id} className="grid gap-2.5 px-4 py-3 sm:px-5" data-testid={`set-${s.id}`}>
                    <div className="flex items-center gap-3">
                      {isImported ? (
                        <Link href={`/catalogue/${encodeURIComponent(s.id)}?langue=${language}`} className="group flex min-w-0 flex-1 items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30" aria-label={`Voir la série ${s.name}`}>
                          <span className="min-w-0 flex-1 group-hover:[&>span:first-child>span:first-child]:underline">{meta}</span>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1">{meta}</span>
                      )}
                      <Button variant={isImported ? "outline" : "default"} size="sm" onClick={() => sync(s)} disabled={syncing !== null || refreshing}>
                        {busy ? <><Spinner className={isImported ? undefined : "text-primary-foreground"} /> Import…</> : isImported ? "Mettre à jour" : "Importer"}
                      </Button>
                    </div>
                    {busy && (
                      <p className="text-xs text-muted-foreground" role="status">
                        Téléchargement des cartes, jusqu'à quelques minutes pour une grande série. Gardez cette page ouverte.
                      </p>
                    )}
                    {!busy && outcome && <Alert variant={outcome.kind}>{outcome.text}</Alert>}
                  </div>
                );
              })}
            </Card>
          ) : (
            <EmptyState icon={wanted ? <Search /> : <BookOpen />} title={wanted ? "Aucune série ne correspond à ce filtre" : currentTab === "imported" ? "Aucune série importée" : "Toutes les séries sont importées"}>
              {!wanted && currentTab === "imported" ? "Ouvrez l'onglet « Non importées » et importez les séries que vous possédez." : undefined}
            </EmptyState>
          )}

          <Pagination page={view.page} pageCount={view.pageCount} onChange={setPage} />
        </>
      )}
    </div>
  );
}
