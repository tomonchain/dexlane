"use client";

import { CatalogImport } from "@/components/catalog-import";
import { SetLogo } from "@/components/set-logo";
import { BookOpen, ChevronRight, CloudDownload, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Code, EmptyState, PageHeader, Spinner } from "@/components/ui/misc";
import { Pagination, SegmentedTabs, paginate } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { CATALOG_LANGUAGES, catalogMessage, fold, importedLabel } from "@/lib/catalog";
import { formatDateTime } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import { useStored } from "@/lib/storage";
import type { CatalogSet, SetSyncReport } from "@/lib/types";
import { ListSkeleton } from "@/components/skeletons";
import { useCachedState } from "@/lib/cache";

const PAGE_SIZE = 12;
const NO_BLOCK = "__none__";
type Tab = "imported" | "pending";
type Outcome = { kind: "success" | "warning" | "destructive"; text: string };

export default function CatalogPage() {
  const [language, setLanguage, ready] = useStored("dexlane.catalog.language", "fr");
  const [sets, setSets] = useCachedState<CatalogSet[]>(`catalog:sets:${language}`, { keepPrevious: true });
  const [tab, setTab] = useState<Tab | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const [block, setBlock] = useState("");
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
    setTab(null);
    setBlock("");
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
        ? { kind: "warning", text: t("{imported}, {n} en échec : relance pour les compléter.", { imported: importedLabel(report.cards), n: report.errorCount }) }
        : { kind: "success", text: t("{imported} (variantes : {variants}, cotations : {prices}).", { imported: importedLabel(report.cards), variants: report.variants, prices: report.pricesInserted }) };
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

  // Blocs connus (« Soleil et Lune », « Épée et Bouclier »…), du plus récent au plus ancien.
  const blocks = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; position: number; count: number }>();
    for (const s of sets ?? []) {
      if (!s.serieId) continue;
      const known = byId.get(s.serieId);
      if (known) known.count++;
      else byId.set(s.serieId, { id: s.serieId, name: s.serieName ?? s.serieId, position: s.seriePosition ?? 0, count: 1 });
    }
    return [...byId.values()].sort((a, b) => b.position - a.position || a.name.localeCompare(b.name));
  }, [sets]);
  const unassigned = (sets ?? []).some((s) => !s.serieId);

  const wanted = fold(filter.trim());
  const inTab = currentTab === "imported" ? imported : pending;
  const matching = useMemo(
    () => {
      const list = inTab.filter(
        (s) => (!block || (block === NO_BLOCK ? !s.serieId : s.serieId === block)) && (!wanted || fold(s.name).includes(wanted) || s.id.includes(wanted)),
      );
      // Par bloc (le plus récent d'abord), puis par date de sortie. Une série qu'on vient d'importer remonte en tête de son bloc.
      return [...list].sort((a, b) =>
        (b.seriePosition ?? -1) - (a.seriePosition ?? -1)
        || Number(!!outcomes[b.id]) - Number(!!outcomes[a.id])
        || (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "")
        || a.name.localeCompare(b.name));
    },
    [inTab, wanted, block, outcomes],
  );
  const view = paginate(matching, page, PAGE_SIZE);

  return (
    <div className="grid gap-5">
      <PageHeader
        title={t("Catalogue")}
        description={t("Le scan et la recherche trouvent les cartes des séries importées ; le catalogue français s'importe en entier, peu à peu. Réimporter une série met à jour ses cartes et ajoute les cotations du jour.")}
        actions={
          <Button variant="outline" onClick={refresh} disabled={refreshing || syncing !== null}>
            {refreshing ? <Spinner /> : <RefreshCw />} {sets?.length ? t("Actualiser la liste") : t("Charger la liste")}
          </Button>
        }
      />

      {ready && <CatalogImport language={language} onProgress={() => void load()} />}

      <div className="grid gap-3 sm:grid-cols-[11rem_14rem_minmax(0,1fr)]">
        <Field label={t("Langue des cartes")}>
          <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {CATALOG_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{t(label)}</option>)}
          </Select>
        </Field>
        <Field label={t("Bloc")}>
          <Select
            value={block}
            onChange={(e) => {
              setBlock(e.target.value);
              setPage(1);
            }}
            disabled={blocks.length === 0}
          >
            <option value="">{blocks.length === 0 ? t("Actualise la liste") : t("Tous les blocs")}</option>
            {blocks.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.count})</option>)}
            {blocks.length > 0 && unassigned && <option value={NO_BLOCK}>{t("Sans bloc")}</option>}
          </Select>
        </Field>
        <Field label={t("Filtrer les séries")}>
          <span className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              placeholder={t("Nom ou identifiant (151, swsh3…)")}
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
      {!sets && !error && <ListSkeleton count={6} label={t("Chargement des séries")} />}
      {sets?.length === 0 && !refreshing && (
        <EmptyState icon={<BookOpen />} title={t("Aucune série connue pour cette langue")} action={<Button size="sm" onClick={refresh}><CloudDownload /> {t("Charger la liste")}</Button>}>
          {t("Charge la liste des séries, puis importe celles que tu possèdes.")}
        </EmptyState>
      )}

      {sets && sets.length > 0 && (
        <>
          <SegmentedTabs
            label={t("Séries")}
            value={currentTab}
            onChange={(next) => {
              setTab(next);
              setPage(1);
            }}
            tabs={[
              { value: "imported", label: t("Importées"), count: imported.length },
              { value: "pending", label: t("Non importées"), count: pending.length },
            ]}
          />

          {view.items.length > 0 ? (
            <Card className="divide-y overflow-hidden" role="tabpanel">
              {view.items.map((s, index) => {
                const previous = view.items[index - 1];
                const newBlock = blocks.length > 0 && (index === 0 || previous?.serieId !== s.serieId);
                const total = s.cardCountTotal ?? s.cardCountOfficial;
                const outcome = outcomes[s.id];
                const busy = syncing === s.id;
                const isImported = s.cardsSynced > 0;
                const meta = (
                  <>
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{s.name}</span>
                      <Code className="shrink-0 text-[11px] font-semibold text-muted-foreground">{s.code}</Code>
                      {isImported && <Badge variant="success">{tn(s.cardsSynced, "{n} carte", "{n} cartes")}</Badge>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      <Code>{s.id}</Code>
                      {total ? ` · ${t("{n} cartes", { n: total })}` : ""}
                      {s.releaseDate ? ` · ${s.releaseDate.slice(0, 4)}` : ""}
                      {isImported && s.cardsSyncedAt ? ` · ${t("importée le {date}", { date: formatDateTime(s.cardsSyncedAt) })}` : ""}
                    </span>
                  </>
                );
                return (
                  <Fragment key={s.id}>
                  {newBlock && (
                    <h2 className="bg-muted/50 px-4 py-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase sm:px-5">
                      {s.serieName ?? t("Sans bloc")}
                    </h2>
                  )}
                  <div className="grid gap-2.5 px-4 py-3 sm:px-5" data-testid={`set-${s.id}`}>
                    <div className="flex items-center gap-3">
                      <SetLogo url={s.logoUrl} name={s.name} className="h-9 w-14 sm:w-20" />
                      {isImported ? (
                        <Link href={`/catalog/${encodeURIComponent(s.id)}?language=${language}`} className="group flex min-w-0 flex-1 items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30" aria-label={t("Voir la série {name}", { name: s.name })}>
                          <span className="min-w-0 flex-1 group-hover:[&>span:first-child>span:first-child]:underline">{meta}</span>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1">{meta}</span>
                      )}
                      <Button variant={isImported ? "outline" : "default"} size="sm" onClick={() => sync(s)} disabled={syncing !== null || refreshing}>
                        {busy ? <><Spinner className={isImported ? undefined : "text-primary-foreground"} /> {t("Import…")}</> : isImported ? t("Mettre à jour") : t("Importer")}
                      </Button>
                    </div>
                    {busy && (
                      <p className="text-xs text-muted-foreground" role="status">
                        {t("Téléchargement des cartes, jusqu'à quelques minutes pour une grande série. Garde cette page ouverte.")}
                      </p>
                    )}
                    {!busy && outcome && <Alert variant={outcome.kind}>{outcome.text}</Alert>}
                  </div>
                  </Fragment>
                );
              })}
            </Card>
          ) : (
            <EmptyState icon={wanted ? <Search /> : <BookOpen />} title={wanted || block ? t("Aucune série ne correspond à ce filtre") : currentTab === "imported" ? t("Aucune série importée") : t("Toutes les séries sont importées")}>
              {!wanted && !block && currentTab === "imported" ? t("Ouvre l'onglet « Non importées » et importe les séries que tu possèdes.") : undefined}
            </EmptyState>
          )}

          <Pagination page={view.page} pageCount={view.pageCount} onChange={setPage} />
        </>
      )}
    </div>
  );
}
