"use client";

import { BookOpen, CloudDownload, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Code, EmptyState, Loading, PageHeader, Spinner } from "@/components/ui/misc";
import { ApiError, api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useStored } from "@/lib/storage";
import type { CatalogSet, SetSyncReport } from "@/lib/types";

const LANGUAGES: [string, string][] = [
  ["fr", "Français"], ["en", "Anglais"], ["de", "Allemand"], ["it", "Italien"], ["es", "Espagnol"], ["pt", "Portugais"], ["ja", "Japonais"],
];
const ERRORS: Record<string, string> = {
  CATALOG_SOURCE_UNAVAILABLE: "La source du catalogue (TCGdex) ne répond pas. Réessayez dans un moment.",
  CATALOG_SET_NOT_FOUND: "Cette série n'existe pas dans cette langue.",
  NETWORK: "Connexion interrompue. La synchronisation a pu continuer côté serveur : rechargez la liste, puis relancez si besoin.",
};
const message = (e: unknown) => (e instanceof ApiError ? (ERRORS[e.code] ?? e.message) : (e as Error).message);
const imported = (n: number) => `${n} carte${n > 1 ? "s importées" : " importée"}`;

type Outcome = { kind: "success" | "warning" | "destructive"; text: string };

export default function CatalogPage() {
  const [language, setLanguage, ready] = useStored("dexlane.catalog.language", "fr");
  const [sets, setSets] = useState<CatalogSet[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  const load = useCallback(
    () => api.catalogSets(language).then((r) => setSets(r.sets)).catch((e) => setError(message(e))),
    [language],
  );
  useEffect(() => {
    if (!ready) return;
    setSets(null);
    setOutcomes({});
    setError(null);
    void load();
  }, [ready, load]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      await api.refreshCatalogSets(language);
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function sync(set: CatalogSet) {
    setSyncing(set.id);
    setOutcomes(({ [set.id]: _, ...rest }) => rest);
    try {
      const report: SetSyncReport = await api.syncCatalogSet(set.id, language);
      setOutcomes((o) => ({
        ...o,
        [set.id]: report.errorCount
          ? { kind: "warning", text: `${imported(report.cards)}, ${report.errorCount} en échec : relancez pour les compléter.` }
          : { kind: "success", text: `${imported(report.cards)} (variantes : ${report.variants}, cotations : ${report.pricesInserted}).` },
      }));
    } catch (e) {
      setOutcomes((o) => ({ ...o, [set.id]: { kind: "destructive", text: message(e) } }));
    } finally {
      setSyncing(null);
      void load();
    }
  }

  const wanted = filter.trim().toLowerCase();
  const shown = useMemo(
    () => (sets ?? []).filter((s) => !wanted || s.name.toLowerCase().includes(wanted) || s.id.includes(wanted)),
    [sets, wanted],
  );
  const syncedCount = (sets ?? []).filter((s) => s.cardsSynced > 0).length;

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Catalogue"
        description="Le scan et la recherche ne trouvent que les cartes des séries synchronisées. Relancer une synchronisation met à jour les cartes et ajoute les cotations du jour."
        actions={
          <Button variant="outline" onClick={refresh} disabled={refreshing || syncing !== null}>
            {refreshing ? <Spinner /> : <RefreshCw />} {sets?.length ? "Actualiser" : "Charger la liste"}
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Field label="Langue des cartes">
          <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </Select>
        </Field>
        <Field label="Filtrer les séries">
          <span className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" placeholder="Nom ou identifiant (151, swsh3…)" value={filter} onChange={(e) => setFilter(e.target.value)} autoCorrect="off" className="pl-9" />
          </span>
        </Field>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {!sets && !error && <Loading />}
      {sets?.length === 0 && !refreshing && (
        <EmptyState icon={<BookOpen />} title="Aucune série connue pour cette langue" action={<Button size="sm" onClick={refresh}><CloudDownload /> Charger la liste</Button>}>
          Chargez la liste des séries, puis synchronisez celles que vous possédez.
        </EmptyState>
      )}

      {sets && sets.length > 0 && (
        <>
          <p className="tabular text-sm text-muted-foreground" role="status">
            {syncedCount} série{syncedCount > 1 ? "s" : ""} synchronisée{syncedCount > 1 ? "s" : ""} sur {sets.length}
          </p>
          <Card className="divide-y overflow-hidden">
            {shown.map((s) => {
              const total = s.cardCountTotal ?? s.cardCountOfficial;
              const outcome = outcomes[s.id];
              const busy = syncing === s.id;
              const synced = s.cardsSynced > 0;
              return (
                <div key={s.id} className="grid gap-2.5 px-4 py-3 sm:px-5" data-testid={`set-${s.id}`}>
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{s.name}</span>
                        {synced
                          ? <Badge variant="success">{s.cardsSynced} carte{s.cardsSynced > 1 ? "s" : ""}</Badge>
                          : <Badge variant="outline">Non synchronisée</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        <Code>{s.id}</Code>
                        {total ? ` · ${total} cartes` : ""}
                        {s.releaseDate ? ` · ${s.releaseDate.slice(0, 4)}` : ""}
                        {synced && s.cardsSyncedAt ? ` · synchronisée le ${formatDateTime(s.cardsSyncedAt)}` : ""}
                      </span>
                    </span>
                    <Button variant={synced ? "outline" : "default"} size="sm" onClick={() => sync(s)} disabled={syncing !== null || refreshing}>
                      {busy ? <><Spinner className={synced ? undefined : "text-primary-foreground"} /> Import…</> : synced ? "Mettre à jour" : "Synchroniser"}
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
          {shown.length === 0 && <EmptyState icon={<Search />} title="Aucune série ne correspond à ce filtre" />}
        </>
      )}
    </div>
  );
}
