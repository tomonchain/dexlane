"use client";

import { DownloadCloud, Pause } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import type { CatalogImportStatus } from "@/lib/types";

/**
 * Où en est le catalogue complet d'une langue : chaque nuit, les séries manquantes s'importent d'elles-mêmes (les plus
 * récentes d'abord). « Tout importer maintenant » enchaîne les lots tant que la page reste ouverte.
 */
export function CatalogImport({ language, onProgress }: { language: string; onProgress: () => void }) {
  const [status, setStatus] = useState<CatalogImportStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    api.catalogImport(language).then(setStatus).catch(() => setStatus(null));
    return () => { stop.current = true; };
  }, [language]);

  async function run() {
    setRunning(true);
    setError(null);
    stop.current = false;
    try {
      while (!stop.current) {
        const r = await api.importNextSets(language, 50);
        setStatus(r.status);
        if (r.imported.length > 0) {
          setLast(r.imported.map((x) => x.name).join(", "));
          onProgress();
        }
        if (r.imported.length === 0 || (r.status.listComplete && r.status.remaining === 0)) break;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  if (!status || language !== "fr") return null;
  const done = status.listComplete && status.remaining === 0;
  const percent = status.total > 0 ? Math.round((status.imported / status.total) * 100) : 0;

  return (
    <Card data-testid="catalog-import">
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-0.5">
            <p className="text-sm font-semibold">
              {done ? t("Catalogue français complet") : t("Catalogue français : {imported} séries sur {total}", { imported: formatNumber(status.imported), total: formatNumber(status.total) })}
            </p>
            <p className="text-xs text-muted-foreground">
              {tn(status.cards, "{n} carte importée", "{n} cartes importées")}
              {!done && ` · ${t("le reste s'importe chaque nuit, les séries récentes d'abord")}`}
              {status.skipped > 0 && ` · ${tn(status.skipped, "{n} série sans carte, retentée la semaine prochaine", "{n} séries sans carte, retentées la semaine prochaine")}`}
            </p>
          </div>
          {!done && (running ? (
            <Button variant="outline" size="sm" onClick={() => { stop.current = true; }}><Pause /> {t("Arrêter")}</Button>
          ) : (
            <Button size="sm" onClick={run}><DownloadCloud /> {t("Tout importer maintenant")}</Button>
          ))}
        </div>
        {status.total > 0 && (
          <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className="block h-full rounded-full bg-success transition-[width]" style={{ width: `${percent}%` }} />
          </span>
        )}
        {running && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Spinner className="size-3" /> {t("Import en cours, série par série ; garde cette page ouverte.")}{last && ` ${t("Dernières : {names}.", { names: last })}`}
          </p>
        )}
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}
