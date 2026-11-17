"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type Outcome = { kind: "ok" | "warn" | "error"; text: string };

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
    setOutcomes((o) => ({ ...o, [set.id]: { kind: "ok", text: "" } }));
    try {
      const report: SetSyncReport = await api.syncCatalogSet(set.id, language);
      setOutcomes((o) => ({
        ...o,
        [set.id]: report.errorCount
          ? { kind: "warn", text: `${imported(report.cards)}, ${report.errorCount} en échec : relancez pour les compléter.` }
          : { kind: "ok", text: `${imported(report.cards)} (variantes : ${report.variants}, cotations : ${report.pricesInserted}).` },
      }));
    } catch (e) {
      setOutcomes((o) => ({ ...o, [set.id]: { kind: "error", text: message(e) } }));
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
    <div className="stack">
      <div className="stack-sm">
        <h1>Catalogue</h1>
        <p className="muted">
          Le scan et la recherche ne trouvent que les cartes des séries synchronisées. Importez les séries que vous possédez ;
          relancer une synchronisation met à jour les cartes et ajoute les cotations du jour.
        </p>
      </div>

      <div className="grid-2">
        <label className="field">
          <span>Langue des cartes</span>
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <div className="field">
          <span className="label">Liste des séries</span>
          <button type="button" className="btn" onClick={refresh} disabled={refreshing || syncing !== null}>
            {refreshing ? "Chargement…" : sets?.length ? "Actualiser" : "Charger la liste"}
          </button>
        </div>
      </div>

      {error && <p className="banner error" role="alert">{error}</p>}
      {!sets && !error && <p className="row muted" role="status"><span className="spinner" /> Chargement…</p>}
      {sets?.length === 0 && !refreshing && (
        <p className="card muted center">Aucune série connue pour cette langue. Chargez la liste pour commencer.</p>
      )}

      {sets && sets.length > 0 && (
        <>
          <input
            className="input"
            type="search"
            placeholder="Filtrer par nom ou identifiant (151, swsh3…)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filtrer les séries"
            autoCorrect="off"
          />
          <p className="muted small" role="status">{syncedCount} série{syncedCount > 1 ? "s" : ""} synchronisée{syncedCount > 1 ? "s" : ""} sur {sets.length}</p>
          <div className="list">
            {shown.map((s) => {
              const total = s.cardCountTotal ?? s.cardCountOfficial;
              const outcome = outcomes[s.id];
              const busy = syncing === s.id;
              return (
                <div key={s.id} className="rowlink" style={{ flexWrap: "wrap" }} data-testid={`set-${s.id}`}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <strong className="truncate" style={{ display: "block" }}>{s.name}</strong>
                    <span className="muted small">
                      <span className="mono">{s.id}</span>
                      {total ? ` · ${total} cartes` : ""}
                      {s.releaseDate ? ` · ${s.releaseDate.slice(0, 4)}` : ""}
                    </span>
                    <span className="small" style={{ display: "block", marginTop: 4 }}>
                      {s.cardsSynced > 0
                        ? <span className="badge ok">{s.cardsSynced} carte{s.cardsSynced > 1 ? "s" : ""} · {s.cardsSyncedAt ? formatDateTime(s.cardsSyncedAt) : ""}</span>
                        : <span className="badge">Non synchronisée</span>}
                    </span>
                  </span>
                  <button type="button" className={s.cardsSynced > 0 ? "btn sm" : "btn sm primary"} onClick={() => sync(s)} disabled={syncing !== null || refreshing}>
                    {busy ? "Import en cours…" : s.cardsSynced > 0 ? "Mettre à jour" : "Synchroniser"}
                  </button>
                  {busy && (
                    <p className="row muted small" role="status" style={{ flexBasis: "100%" }}>
                      <span className="spinner" /> Téléchargement des cartes, jusqu'à quelques minutes pour une grande série. Gardez cette page ouverte.
                    </p>
                  )}
                  {!busy && outcome?.text && (
                    <p className={`banner ${outcome.kind}`} role="status" style={{ flexBasis: "100%" }}>{outcome.text}</p>
                  )}
                </div>
              );
            })}
          </div>
          {shown.length === 0 && <p className="card muted center">Aucune série ne correspond à ce filtre.</p>}
        </>
      )}
    </div>
  );
}
