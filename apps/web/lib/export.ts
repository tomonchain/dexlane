import { api } from "./api";
import { variantLabel } from "./format";
import type { StockRow, StockStatus } from "./types";

export const STATUS_LABEL: Record<StockStatus, string> = { TO_PRICE: "À tarifer", READY: "Prête", LISTED: "En ligne", DRAFT: "Brouillon" };

/** Export de la sélection en CSV, pour un tableur ou un autre outil. */
export function exportStockCsv(rows: StockRow[], name = "stock") {
  const cell = (v: string | number | null) => {
    const text = v === null ? "" : String(v);
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const euros = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2).replace(".", ","));
  const lines = [
    ["Référence", "Carte", "Série", "Numéro", "Variante", "État", "Langue", "Quantité", "Emplacements", "Coût moyen", "Prix", "Prix suggéré", "Statut"],
    ...rows.map((r) => [r.offerSku, r.name, r.setName ?? r.setId, r.localNumber, variantLabel(r), r.condition, r.language.toUpperCase(), r.onHand, r.locations.join(" "),
      euros(r.averageCostCents), euros(r.targetPriceCents), euros(r.suggestedPriceCents), STATUS_LABEL[r.status] ?? r.status]),
  ];
  const blob = new Blob(["\uFEFF" + lines.map((l) => l.map(cell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: `dexlane-${name}-${new Date().toISOString().slice(0, 10)}.csv` });
  link.click();
  URL.revokeObjectURL(url);
}


/** Tout le stock, page par page, pour l'export complet. */
export async function fetchAllStock(): Promise<StockRow[]> {
  const rows: StockRow[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await api.stock({ limit: 200, offset, sort: "name" });
    rows.push(...page.items);
    if (page.items.length < 200 || rows.length >= page.total) return rows;
  }
}
