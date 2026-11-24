"use client";

import { Check, ClipboardCheck, ExternalLink, PackageOpen, PackagePlus, Pencil, Plus, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { LocationField } from "@/components/location-picker";
import { RecentMovements } from "@/components/stock-movements";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Code, EmptyState, Loading, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { SegmentedTabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useCachedState } from "@/lib/cache";
import { formatEuros, formatNumber, parseEuros } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import { eurosInput } from "@/lib/pricing";
import { SHIPPING_LABEL, SHIPPING_MODES } from "@/lib/sales";
import type { ShippingMode, Supply, SupplyInput, SupplyList, SupplyUsage } from "@/lib/types";
import { cn } from "@/lib/utils";

const POSTAL: ShippingMode[] = ["LETTER_UNTRACKED", "LETTER_TRACKED", "PARCEL_TRACKED"];
const USAGE_LABEL: Record<SupplyUsage, string> = {
  PER_CARD: "Par carte envoyée",
  PER_SHIPMENT: "Par envoi",
  MANUAL: "Comptée à la main",
};
type Preset = SupplyInput & { onHand: number };
const blank = (x: Partial<Preset>): Preset => ({
  name: "", usage: "PER_CARD", perUse: 1, modes: [...SHIPPING_MODES], onHand: 0, reorderPoint: 0, reorderQuantity: null,
  supplierUrl: null, reference: null, unitCostCents: null, locationCode: null, ...x,
});
/** Les fournitures habituelles d'un vendeur de cartes, proposées en un geste quand la liste est vide. */
const SUGGESTIONS: Preset[] = [
  blank({ name: "Sleeves", reorderPoint: 100, reorderQuantity: 500 }),
  blank({ name: "Top-loaders", reorderPoint: 50, reorderQuantity: 200 }),
  blank({ name: "Enveloppes", usage: "PER_SHIPMENT", modes: ["LETTER_UNTRACKED", "LETTER_TRACKED"], reorderPoint: 20, reorderQuantity: 100 }),
  blank({ name: "Enveloppes à bulles", usage: "PER_SHIPMENT", modes: ["PARCEL_TRACKED"], reorderPoint: 10, reorderQuantity: 50 }),
];

type Filter = "ALL" | "REORDER" | "ORDERED";

function usageText(s: Supply): string {
  if (s.usage === "MANUAL") return t("Comptée à la main");
  const all = s.modes.length === SHIPPING_MODES.length;
  const postalOnly = s.modes.length === POSTAL.length && POSTAL.every((m) => s.modes.includes(m));
  const where = all ? t("tous les envois") : postalOnly ? t("envois postaux") : s.modes.map((m) => t(SHIPPING_LABEL[m]).toLowerCase()).join(", ");
  return s.usage === "PER_CARD"
    ? tn(s.perUse, "{n} par carte · {where}", "{n} par carte · {where}", { where })
    : tn(s.perUse, "{n} par envoi · {where}", "{n} par envoi · {where}", { where });
}

function StatusBadge({ s }: { s: Supply }) {
  if (s.orderedAt) return <Badge variant="brand">{t("Commandé")}</Badge>;
  if (s.status === "OUT") return <Badge variant="destructive">{t("Épuisé")}</Badge>;
  if (s.status === "LOW") return <Badge variant="warning">{t("À commander")}</Badge>;
  return <Badge variant="outline">{t("En stock")}</Badge>;
}

/** Jauge : pleine à trois fois le seuil, pour voir venir la commande. */
function Gauge({ s, className }: { s: Supply; className?: string }) {
  const fill = s.reorderPoint > 0 ? Math.min(s.onHand / (s.reorderPoint * 3), 1) : s.onHand > 0 ? 1 : 0;
  return (
    <span className={cn("block h-1.5 overflow-hidden rounded-full bg-muted", className)} aria-hidden>
      <span className={cn("block h-full rounded-full", s.status === "OK" ? "bg-success" : s.status === "LOW" ? "bg-warning" : "bg-destructive")} style={{ width: `${fill * 100}%` }} />
    </span>
  );
}

type Dialog =
  | { kind: "edit"; supply: Supply | null; preset?: Preset }
  | { kind: "receive"; supply: Supply }
  | { kind: "count"; supply: Supply };

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

/**
 * Rubrique « Fournitures » du stock : sleeves, top-loaders, enveloppes… avec leur quantité, leur valeur et leur
 * emplacement ; décomptées à chaque envoi remis, et signalées quand il faut recommander.
 */
export function SuppliesView({ header }: { header: (meta: ReactNode, actions: ReactNode, badge: number) => ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const desktop = useIsDesktop();
  const [data, setData] = useCachedState<SupplyList>("supplies");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [selected, setSelectedState] = useState<string | null>(params.get("item"));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const load = () => api.supplies().then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setSelected = (id: string | null) => {
    setSelectedState(id);
    router.replace(id ? `/stock?section=supplies&item=${id}` : "/stock?section=supplies", { scroll: false });
  };

  async function run(key: string, action: () => Promise<unknown>, done?: string) {
    setBusy(key);
    try {
      await action();
      if (done) toast.success(done);
      await load();
      setVersion((v) => v + 1);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const supplies = data?.supplies ?? [];
  const needle = query.trim().toLowerCase();
  const rows = supplies
    .filter((s) => filter === "ALL" || (filter === "REORDER" ? s.status !== "OK" && !s.orderedAt : s.orderedAt))
    .filter((s) => !needle || [s.name, s.reference ?? "", s.locationCode ?? ""].some((x) => x.toLowerCase().includes(needle)));
  const current = supplies.find((s) => s.id === selected) ?? null;

  const inspector = current && (
    <SupplyInspector key={current.id} s={current} version={version} busy={busy === current.id}
      onClose={() => setSelected(null)}
      onReceive={() => setDialog({ kind: "receive", supply: current })}
      onCount={() => setDialog({ kind: "count", supply: current })}
      onEdit={() => setDialog({ kind: "edit", supply: current })}
      onOrdered={(ordered) => run(current.id, () => api.markSupplyOrdered(current.id, ordered), ordered ? t("Commande notée") : undefined)}
    />
  );

  return (
    <>
      {header(
        data && data.supplies.length > 0 && (
          <span className="tabular" data-testid="supplies-totals">
            {tn(data.totals.items, "{n} article", "{n} articles")} · {tn(data.totals.units, "{n} unité", "{n} unités")}
            {data.totals.valueCents > 0 && ` · ${formatEuros(data.totals.valueCents)}`}
          </span>
        ),
        <Button onClick={() => setDialog({ kind: "edit", supply: null })} data-testid="supply-add"><Plus /> {t("Ajouter une fourniture")}</Button>,
        data?.toReorder ?? 0,
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      {!data && !error && <Loading />}
      {data && supplies.length === 0 && (
        <EmptyState icon={<PackageOpen />} title={t("Aucune fourniture suivie")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((x) => (
                <Button key={x.name} variant="outline" size="sm" onClick={() => setDialog({ kind: "edit", supply: null, preset: x })}><Plus /> {t(x.name)}</Button>
              ))}
            </div>
          }>
          {t("Ajoutez ce que vous utilisez pour expédier ; chaque envoi remis en décompte automatiquement sa part.")}
        </EmptyState>
      )}
      {data && supplies.length > 0 && (
        <>
          {data.toReorder > 0 && (
            <Alert variant="warning" data-testid="supplies-to-reorder">
              {tn(data.toReorder, "{n} fourniture à commander.", "{n} fournitures à commander.")} {t("Une fois la commande passée, marquez-la « commandée » : l'alerte se tait jusqu'à la réception.")}
            </Alert>
          )}
          <div className="grid gap-3">
            <SegmentedTabs label={t("Statut")} value={filter} onChange={setFilter} tabs={[
              { value: "ALL", label: t("Tout"), count: supplies.length },
              { value: "REORDER", label: t("À commander"), count: data.toReorder },
              { value: "ORDERED", label: t("Commandées"), count: data.ordered },
            ]} />
            <div className="relative sm:max-w-md" role="search">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Nom, référence ou emplacement")} aria-label={t("Rechercher une fourniture")}
                className="h-9 w-full rounded-md border border-input bg-card pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15" />
            </div>
          </div>
          <div className={cn("grid items-start gap-4", current && desktop && "lg:grid-cols-[minmax(0,1fr)_25rem]")}>
            <div className="overflow-hidden rounded-lg border bg-card">
              <table className="w-full border-collapse text-left text-sm" data-testid="supplies">
                <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="h-9 px-3 font-medium">{t("Article")}</th>
                    <th className="px-3 text-right font-medium">{t("Qté")}</th>
                    <th className="hidden px-3 font-medium md:table-cell">{t("Emplacement")}</th>
                    <th className={cn("hidden px-3 text-right font-medium", current ? "2xl:table-cell" : "lg:table-cell")}>{t("Valeur")}</th>
                    <th className="hidden px-3 font-medium sm:table-cell">{t("Statut")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} tabIndex={0} aria-selected={s.id === selected} data-testid={`supply-${s.name}`}
                      onClick={() => setSelected(s.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(s.id); } }}
                      className={cn("cursor-pointer border-b outline-none transition-colors last:border-b-0 hover:bg-accent/50 focus-visible:bg-accent/70", s.id === selected && "bg-accent/70 hover:bg-accent/70")}>
                      <td className="px-3 py-2">
                        <span className="grid min-w-0">
                          <span className="truncate font-medium">{s.name}</span>
                          <span className="truncate text-xs text-muted-foreground">{s.reference ? `${s.reference} · ` : ""}{usageText(s)}</span>
                        </span>
                      </td>
                      <td className="px-3 text-right whitespace-nowrap">
                        <span className="tabular font-medium" data-testid="supply-on-hand">{formatNumber(s.onHand)}</span>
                        <Gauge s={s} className="mt-1 ml-auto w-14" />
                        <span className="text-[11px] text-muted-foreground sm:hidden">{s.orderedAt ? t("Commandé") : s.status === "OUT" ? t("Épuisé") : s.status === "LOW" ? t("À commander") : ""}</span>
                      </td>
                      <td className="hidden px-3 md:table-cell">{s.locationCode ? <Code className="text-xs">{s.locationCode}</Code> : <span className="text-muted-foreground">—</span>}</td>
                      <td className={cn("tabular hidden px-3 text-right text-muted-foreground", current ? "2xl:table-cell" : "lg:table-cell")}>{s.unitCostCents === null ? "—" : formatEuros(s.valueCents)}</td>
                      <td className="hidden px-3 sm:table-cell"><StatusBadge s={s} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("Aucune fourniture ne correspond.")}</p>}
            </div>
            {desktop ? inspector : current && <Modal title={t("Fourniture")} onClose={() => setSelected(null)}>{inspector}</Modal>}
          </div>
        </>
      )}

      {dialog?.kind === "edit" && (
        <SupplyForm supply={dialog.supply} preset={dialog.preset} onClose={() => setDialog(null)}
          onSaved={async (id) => { setDialog(null); await load(); setVersion((v) => v + 1); if (id) setSelected(id); else setSelected(null); }} />
      )}
      {dialog?.kind === "receive" && (
        <QuantityDialog
          title={t("Entrée : {name}", { name: dialog.supply.name })}
          description={t("Ajoutée au stock actuel ({n}).", { n: formatNumber(dialog.supply.onHand) })}
          label={t("Quantité reçue")} initial={dialog.supply.reorderQuantity ?? undefined} min={1} submit={t("Ajouter au stock")} withNote
          onClose={() => setDialog(null)}
          onSubmit={(n, note) => run("dialog", () => api.receiveSupply(dialog.supply.id, n, note), t("Entrée enregistrée")).then((ok) => ok && setDialog(null))}
          busy={busy === "dialog"}
        />
      )}
      {dialog?.kind === "count" && (
        <QuantityDialog
          title={t("Inventaire : {name}", { name: dialog.supply.name })}
          description={t("Le nombre compté remplace le stock calculé ; l'écart est gardé dans l'historique.")}
          label={t("Quantité comptée")} initial={dialog.supply.onHand} min={0} submit={t("Enregistrer")} withNote
          onClose={() => setDialog(null)}
          onSubmit={(n, note) => run("dialog", () => api.countSupply(dialog.supply.id, n, note), t("Stock corrigé")).then((ok) => ok && setDialog(null))}
          busy={busy === "dialog"}
        />
      )}
    </>
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

function SupplyInspector({ s, version, busy, onClose, onReceive, onCount, onEdit, onOrdered }: {
  s: Supply; version: number; busy: boolean;
  onClose: () => void; onReceive: () => void; onCount: () => void; onEdit: () => void; onOrdered: (ordered: boolean) => void;
}) {
  const alert = s.status !== "OK" && !s.orderedAt;
  return (
    <aside className="overflow-hidden rounded-lg border bg-card lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto" aria-label={t("Fourniture {name}", { name: s.name })} data-testid="supply-inspector">
      <div className="flex gap-3 p-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden><PackageOpen className="size-5" /></span>
        <div className="grid min-w-0 flex-1 content-start gap-1">
          <h2 className="text-base leading-snug font-semibold [overflow-wrap:anywhere]">{s.name}</h2>
          <p className="text-[13px] text-muted-foreground">{s.reference ? `${s.reference} · ` : ""}{usageText(s)}</p>
          <div className="mt-1"><StatusBadge s={s} /></div>
        </div>
        <button type="button" onClick={onClose} aria-label={t("Fermer la fiche")} className="hidden size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 lg:flex">
          <X className="size-4" />
        </button>
      </div>
      <div className="grid gap-2 border-t px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="tabular text-3xl leading-none font-semibold tracking-tight" data-testid="supply-inspector-on-hand">{formatNumber(s.onHand)}</span>
          <span className="text-right text-xs text-muted-foreground">
            {s.daysLeft !== null ? tn(s.daysLeft, "≈ {n} jour de stock", "≈ {n} jours de stock") : t("Pas encore de consommation")}
          </span>
        </div>
        <Gauge s={s} />
        <dl className="mt-1 grid grid-cols-3 gap-3">
          <Figure label={t("Seuil de commande")}>{formatNumber(s.reorderPoint)}</Figure>
          <Figure label={t("Prix d'achat unitaire")}>{s.unitCostCents === null ? "—" : formatEuros(s.unitCostCents)}</Figure>
          <Figure label={t("Valeur")}>{s.unitCostCents === null ? "—" : formatEuros(s.valueCents)}</Figure>
          <Figure label={t("Emplacement")}>{s.locationCode ? <Code className="text-xs">{s.locationCode}</Code> : "—"}</Figure>
          <Figure label={t("30 derniers jours")}>{t("{n} utilisés", { n: formatNumber(s.used30Days) })}</Figure>
          <Figure label={t("Commande habituelle")}>{s.reorderQuantity === null ? "—" : formatNumber(s.reorderQuantity)}</Figure>
        </dl>
      </div>
      <div className="flex flex-wrap gap-2 border-t px-4 py-3">
        <Button size="sm" variant={alert || s.orderedAt ? "default" : "outline"} onClick={onReceive}><PackagePlus /> {t("Entrée")}</Button>
        <Button size="sm" variant="outline" onClick={onCount}><ClipboardCheck /> {t("Inventaire")}</Button>
        {alert && <Button size="sm" variant="outline" disabled={busy} onClick={() => onOrdered(true)} data-testid="supply-ordered">{busy ? <Spinner /> : <ShoppingCart />} {t("Commandé")}</Button>}
        {s.orderedAt && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onOrdered(false)}>{t("Annuler la commande")}</Button>}
        {s.supplierUrl && <Button size="sm" variant="ghost" asChild><a href={s.supplierUrl} target="_blank" rel="noreferrer"><ExternalLink /> {t("Fournisseur")}</a></Button>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onEdit} aria-label={t("Modifier {name}", { name: s.name })}><Pencil /> <span className="max-sm:sr-only">{t("Modifier")}</span></Button>
      </div>
      <section className="grid gap-2 border-t px-4 py-3">
        <h3 className="text-xs font-medium text-muted-foreground">{t("Derniers mouvements")}</h3>
        <RecentMovements supplyId={s.id} version={version} />
      </section>
    </aside>
  );
}

function QuantityDialog({ title, description, label, initial, min, submit, withNote, onClose, onSubmit, busy }: {
  title: string; description: string; label: string; initial?: number; min: number; submit: string; withNote?: boolean;
  onClose: () => void; onSubmit: (n: number, note?: string) => void; busy: boolean;
}) {
  const [value, setValue] = useState(initial === undefined ? "" : String(initial));
  const [note, setNote] = useState("");
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= min;
  return (
    <Modal title={title} description={description} onClose={onClose}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(n, note.trim() || undefined); }}>
        <Field label={label}>
          <Input inputMode="numeric" autoFocus value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} data-testid="supply-quantity" />
        </Field>
        {withNote && <Field label={t("Note (facultative)")}><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t("Ex. commande n° 1234")} /></Field>}
        <Button type="submit" disabled={!valid || busy}>{busy ? <Spinner /> : <Check />} {submit}</Button>
      </form>
    </Modal>
  );
}

function SupplyForm({ supply, preset, onClose, onSaved }: { supply: Supply | null; preset?: Preset; onClose: () => void; onSaved: (id: string | null) => void }) {
  const base: Preset = supply ? { ...supply } : preset ?? blank({});
  const [name, setName] = useState(preset ? t(base.name) : base.name);
  const [reference, setReference] = useState(base.reference ?? "");
  const [usage, setUsage] = useState<SupplyUsage>(base.usage);
  const [perUse, setPerUse] = useState(String(base.perUse));
  const [modes, setModes] = useState<ShippingMode[]>(base.modes);
  const [onHand, setOnHand] = useState(supply ? "" : String(base.onHand));
  const [unitCost, setUnitCost] = useState(base.unitCostCents === null ? "" : eurosInput(base.unitCostCents));
  const [location, setLocation] = useState(base.locationCode ?? "");
  const [reorderPoint, setReorderPoint] = useState(String(base.reorderPoint));
  const [reorderQuantity, setReorderQuantity] = useState(base.reorderQuantity === null ? "" : String(base.reorderQuantity));
  const [supplierUrl, setSupplierUrl] = useState(base.supplierUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cost = unitCost.trim() ? parseEuros(unitCost) : null;

  const changeUsage = (next: SupplyUsage) => {
    setUsage(next);
    // Une enveloppe ne sert pas à une remise en main propre : les envois postaux par défaut.
    if (next === "PER_SHIPMENT" && usage !== "PER_SHIPMENT") setModes(POSTAL);
    if (next === "PER_CARD" && usage !== "PER_CARD") setModes([...SHIPPING_MODES]);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (unitCost.trim() && cost === null) return setError(t("Prix unitaire invalide : saisissez un montant comme 0,05."));
    setBusy(true);
    setError(null);
    const input: SupplyInput = {
      name: name.trim(), usage, perUse: Number(perUse) || 1, modes: modes.length ? modes : [...SHIPPING_MODES],
      reorderPoint: Number(reorderPoint) || 0, reorderQuantity: reorderQuantity ? Number(reorderQuantity) : null, supplierUrl: supplierUrl.trim() || null,
      reference: reference.trim() || null, unitCostCents: cost, locationCode: location || null,
    };
    try {
      const saved = supply ? await api.updateSupply(supply.id, input) : await api.createSupply({ ...input, onHand: Number(onHand) || 0 });
      toast.success(supply ? t("Fourniture modifiée") : t("Fourniture ajoutée"));
      onSaved(saved.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!supply || !window.confirm(t("Retirer {name} de la liste ? Son historique est gardé.", { name: supply.name }))) return;
    setBusy(true);
    try {
      await api.archiveSupply(supply.id);
      toast.success(t("Fourniture retirée"));
      onSaved(null);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const digits = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value.replace(/\D/g, ""));
  return (
    <Modal title={supply ? t("Modifier la fourniture") : t("Nouvelle fourniture")} onClose={onClose}>
      <form className="grid gap-4" onSubmit={save} data-testid="supply-form">
        {error && <Alert variant="destructive">{error}</Alert>}
        <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
          <Field label={t("Nom")}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus={!preset} /></Field>
          <Field label={t("Référence")}><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} placeholder={t("Facultative")} /></Field>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
          <Field label={t("Décompte")}>
            <Select value={usage} onChange={(e) => changeUsage(e.target.value as SupplyUsage)}>
              {(Object.keys(USAGE_LABEL) as SupplyUsage[]).map((u) => <option key={u} value={u}>{t(USAGE_LABEL[u])}</option>)}
            </Select>
          </Field>
          {usage !== "MANUAL" && <Field label={t("Quantité")}><Input inputMode="numeric" value={perUse} onChange={digits(setPerUse)} /></Field>}
        </div>
        {usage !== "MANUAL" && (
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-[13px] leading-none font-medium text-foreground/80">{t("Pour les envois")}</legend>
            <div className="grid grid-cols-2 gap-2">
              {SHIPPING_MODES.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={modes.includes(m)}
                    onChange={(e) => setModes(e.target.checked ? [...modes, m] : modes.filter((x) => x !== m))} />
                  {t(SHIPPING_LABEL[m])}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="grid grid-cols-2 gap-3">
          {!supply && <Field label={t("En stock")}><Input inputMode="numeric" value={onHand} onChange={digits(setOnHand)} /></Field>}
          <Field label={t("Prix d'achat unitaire (€)")} hint={t("Compté dans la marge des ventes")}><Input inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0,05" aria-invalid={unitCost.trim() !== "" && cost === null} /></Field>
          <Field label={t("Seuil de commande")} hint={t("Alerte à ce niveau")}><Input inputMode="numeric" value={reorderPoint} onChange={digits(setReorderPoint)} /></Field>
          <Field label={t("Quantité commandée")} hint={t("Proposée à l'entrée")}><Input inputMode="numeric" value={reorderQuantity} onChange={digits(setReorderQuantity)} /></Field>
        </div>
        <div className="grid gap-1.5">
          <LocationField value={location} onChange={setLocation} />
          {location && <button type="button" onClick={() => setLocation("")} className="justify-self-start text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{t("Sans emplacement")}</button>}
        </div>
        <Field label={t("Lien du fournisseur")}><Input type="url" inputMode="url" placeholder="https://" value={supplierUrl} onChange={(e) => setSupplierUrl(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? <Spinner /> : <Check />} {supply ? t("Enregistrer") : t("Ajouter")}</Button>
          {supply && <Button type="button" variant="destructive" className="ml-auto" disabled={busy} onClick={remove}><Trash2 /> {t("Retirer")}</Button>}
        </div>
      </form>
    </Modal>
  );
}
