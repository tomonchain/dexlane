"use client";

import { ChevronRight, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/misc";
import { exportStockCsv, fetchAllStock } from "@/lib/export";
import { t, tn } from "@/lib/i18n";

/** Ligne des réglages qui télécharge tout le stock en CSV (tableur, comptabilité, sauvegarde). */
export function ExportStockRow() {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const rows = await fetchAllStock();
      exportStockCsv(rows);
      toast.success(tn(rows.length, "{n} ligne exportée", "{n} lignes exportées"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={run} disabled={busy} className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent disabled:opacity-60">
      <Download className="size-4 text-muted-foreground" aria-hidden />
      <span className="grid flex-1">
        <span className="text-sm font-medium">{t("Exporter le stock")}</span>
        <span className="text-[13px] text-muted-foreground">{t("Toutes les cartes en CSV : tableur, comptabilité, sauvegarde")}</span>
      </span>
      {busy ? <Spinner /> : <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
    </button>
  );
}
