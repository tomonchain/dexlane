"use client";

import { Check, ClipboardCheck, ExternalLink, PackageOpen, PackagePlus, Pencil, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Loading, Page, PageHeader, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { api } from "@/lib/api";
import { useCachedState } from "@/lib/cache";
import { formatNumber } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import { SHIPPING_LABEL, SHIPPING_MODES } from "@/lib/sales";
import type { ShippingMode, Supply, SupplyInput, SupplyUsage } from "@/lib/types";
import { cn } from "@/lib/utils";

const POSTAL: ShippingMode[] = ["LETTER_UNTRACKED", "LETTER_TRACKED", "PARCEL_TRACKED"];
const USAGE_LABEL: Record<SupplyUsage, string> = {
  PER_CARD: "Par carte envoyée",
  PER_SHIPMENT: "Par envoi",
  MANUAL: "Comptée à la main",
};
/** Les fournitures habituelles d'un vendeur de cartes, proposées en un geste quand la liste est vide. */
const SUGGESTIONS: (SupplyInput & { onHand: number })[] = [
  { name: "Sleeves", usage: "PER_CARD", perUse: 1, modes: [...SHIPPING_MODES], onHand: 0, reorderPoint: 100, reorderQuantity: 500, supplierUrl: null },
  { name: "Top-loaders", usage: "PER_CARD", perUse: 1, modes: [...SHIPPING_MODES], onHand: 0, reorderPoint: 50, reorderQuantity: 200, supplierUrl: null },
  { name: "Enveloppes", usage: "PER_SHIPMENT", perUse: 1, modes: ["LETTER_UNTRACKED", "LETTER_TRACKED"], onHand: 0, reorderPoint: 20, reorderQuantity: 100, supplierUrl: null },
  { name: "Enveloppes à bulles", usage: "PER_SHIPMENT", perUse: 1, modes: ["PARCEL_TRACKED"], onHand: 0, reorderPoint: 10, reorderQuantity: 50, supplierUrl: null },
];

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
  return null;
}

type Dialog =
  | { kind: "edit"; supply: Supply | null; preset?: SupplyInput & { onHand: number } }
  | { kind: "receive"; supply: Supply }
  | { kind: "count"; supply: Supply };

/** Fournitures d'expédition : le stock de sleeves, top-loaders, enveloppes, décompté à chaque envoi, et quand recommander. */
export default function SuppliesPage() {
  const [data, setData] = useCachedState<{ supplies: Supply[]; toReorder: number }>("supplies");
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api.supplies().then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(key: string, action: () => Promise<unknown>, done?: string) {
    setBusy(key);
    try {
      await action();
      if (done) toast.success(done);
      await load();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page>
      <PageHeader
        title={t("Fournitures")}
        description={t("Sleeves, top-loaders, enveloppes : décomptées à chaque envoi remis, avec une alerte quand il faut recommander.")}
        actions={<Button onClick={() => setDialog({ kind: "edit", supply: null })} data-testid="supply-add"><Plus /> {t("Ajouter une fourniture")}</Button>}
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!data && !error && <Loading />}
      {data && data.toReorder > 0 && (
        <Alert variant="warning" data-testid="supplies-to-reorder">
          {tn(data.toReorder, "{n} fourniture à commander.", "{n} fournitures à commander.")} {t("Une fois la commande passée, marquez-la « commandée » : l'alerte se tait jusqu'à la réception.")}
        </Alert>
      )}
      {data && data.supplies.length === 0 && (
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
      {data && data.supplies.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="supplies">
          {data.supplies.map((s) => {
            const alert = s.status !== "OK" && !s.orderedAt;
            // Jauge : pleine à trois fois le seuil, pour voir venir la commande.
            const fill = s.reorderPoint > 0 ? Math.min(s.onHand / (s.reorderPoint * 3), 1) : s.onHand > 0 ? 1 : 0;
            return (
              <li key={s.id}>
                <Card className={cn("h-full", alert && "border-warning/40")} data-testid={`supply-${s.name}`}>
                  <CardContent className="grid h-full content-start gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="grid min-w-0 gap-0.5">
                        <h2 className="truncate text-[15px] font-semibold tracking-tight">{s.name}</h2>
                        <p className="text-xs text-muted-foreground">{usageText(s)}</p>
                      </div>
                      <StatusBadge s={s} />
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="tabular text-3xl leading-none font-semibold tracking-tight" data-testid="supply-on-hand">{formatNumber(s.onHand)}</span>
                      <span className="text-right text-xs text-muted-foreground">
                        {s.daysLeft !== null ? tn(s.daysLeft, "≈ {n} jour de stock", "≈ {n} jours de stock") : t("Pas encore de consommation")}
                      </span>
                    </div>
                    <div className="grid gap-1">
                      <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <span className={cn("block h-full rounded-full", s.status === "OK" ? "bg-success" : s.status === "LOW" ? "bg-warning" : "bg-destructive")} style={{ width: `${fill * 100}%` }} />
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("Seuil de commande : {n}", { n: formatNumber(s.reorderPoint) })}
                        {s.used30Days > 0 && ` · ${t("{n} utilisés en 30 jours", { n: formatNumber(s.used30Days) })}`}
                      </span>
                    </div>
                    <div className="mt-auto flex flex-wrap gap-2 pt-1">
                      <Button size="sm" variant={alert || s.orderedAt ? "default" : "outline"} onClick={() => setDialog({ kind: "receive", supply: s })}><PackagePlus /> {t("Réception")}</Button>
                      <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "count", supply: s })}><ClipboardCheck /> {t("Compter")}</Button>
                      {alert && (
                        <Button size="sm" variant="outline" disabled={busy === s.id} data-testid="supply-ordered"
                          onClick={() => run(s.id, () => api.markSupplyOrdered(s.id, true), t("Commande notée"))}>
                          {busy === s.id ? <Spinner /> : <ShoppingCart />} {t("Commandé")}
                        </Button>
                      )}
                      {s.orderedAt && (
                        <Button size="sm" variant="ghost" disabled={busy === s.id} onClick={() => run(s.id, () => api.markSupplyOrdered(s.id, false))}>{t("Annuler la commande")}</Button>
                      )}
                      {s.supplierUrl && (
                        <Button size="sm" variant="ghost" asChild>
                          <a href={s.supplierUrl} target="_blank" rel="noreferrer"><ExternalLink /> {t("Fournisseur")}</a>
                        </Button>
                      )}
                      <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label={t("Modifier {name}", { name: s.name })} onClick={() => setDialog({ kind: "edit", supply: s })}><Pencil /></Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {dialog?.kind === "edit" && (
        <SupplyForm supply={dialog.supply} preset={dialog.preset} onClose={() => setDialog(null)}
          onSaved={async () => { setDialog(null); await load(); }} />
      )}
      {dialog?.kind === "receive" && (
        <QuantityDialog
          title={t("Réception : {name}", { name: dialog.supply.name })}
          description={t("Ajoutée au stock actuel ({n}).", { n: formatNumber(dialog.supply.onHand) })}
          label={t("Quantité reçue")} initial={dialog.supply.reorderQuantity ?? undefined} min={1} submit={t("Ajouter au stock")}
          onClose={() => setDialog(null)}
          onSubmit={(n) => run("dialog", () => api.receiveSupply(dialog.supply.id, n), t("Réception enregistrée")).then((ok) => ok && setDialog(null))}
          busy={busy === "dialog"}
        />
      )}
      {dialog?.kind === "count" && (
        <QuantityDialog
          title={t("Compter : {name}", { name: dialog.supply.name })}
          description={t("Le nombre compté remplace le stock calculé ; l'écart est gardé dans l'historique.")}
          label={t("Quantité en stock")} initial={dialog.supply.onHand} min={0} submit={t("Enregistrer")}
          onClose={() => setDialog(null)}
          onSubmit={(n) => run("dialog", () => api.countSupply(dialog.supply.id, n), t("Stock corrigé")).then((ok) => ok && setDialog(null))}
          busy={busy === "dialog"}
        />
      )}
    </Page>
  );
}

function QuantityDialog({ title, description, label, initial, min, submit, onClose, onSubmit, busy }: {
  title: string; description: string; label: string; initial?: number; min: number; submit: string;
  onClose: () => void; onSubmit: (n: number) => void; busy: boolean;
}) {
  const [value, setValue] = useState(initial === undefined ? "" : String(initial));
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= min;
  return (
    <Modal title={title} description={description} onClose={onClose}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(n); }}>
        <Field label={label}>
          <Input inputMode="numeric" autoFocus value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} data-testid="supply-quantity" />
        </Field>
        <Button type="submit" disabled={!valid || busy}>{busy ? <Spinner /> : <Check />} {submit}</Button>
      </form>
    </Modal>
  );
}

function SupplyForm({ supply, preset, onClose, onSaved }: { supply: Supply | null; preset?: SupplyInput & { onHand: number }; onClose: () => void; onSaved: () => void }) {
  const base = supply ?? preset ?? { name: "", usage: "PER_CARD" as SupplyUsage, perUse: 1, modes: [...SHIPPING_MODES], onHand: 0, reorderPoint: 0, reorderQuantity: null, supplierUrl: null };
  const [name, setName] = useState(preset ? t(base.name) : base.name);
  const [usage, setUsage] = useState<SupplyUsage>(base.usage);
  const [perUse, setPerUse] = useState(String(base.perUse));
  const [modes, setModes] = useState<ShippingMode[]>(base.modes);
  const [onHand, setOnHand] = useState(supply ? "" : String(base.onHand));
  const [reorderPoint, setReorderPoint] = useState(String(base.reorderPoint));
  const [reorderQuantity, setReorderQuantity] = useState(base.reorderQuantity === null ? "" : String(base.reorderQuantity));
  const [supplierUrl, setSupplierUrl] = useState(base.supplierUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeUsage = (next: SupplyUsage) => {
    setUsage(next);
    // Une enveloppe ne sert pas à une remise en main propre : les envois postaux par défaut.
    if (next === "PER_SHIPMENT" && usage !== "PER_SHIPMENT") setModes(POSTAL);
    if (next === "PER_CARD" && usage !== "PER_CARD") setModes([...SHIPPING_MODES]);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const input: SupplyInput = {
      name: name.trim(), usage, perUse: Number(perUse) || 1, modes: modes.length ? modes : [...SHIPPING_MODES],
      reorderPoint: Number(reorderPoint) || 0, reorderQuantity: reorderQuantity ? Number(reorderQuantity) : null, supplierUrl: supplierUrl.trim() || null,
    };
    try {
      if (supply) await api.updateSupply(supply.id, input);
      else await api.createSupply({ ...input, onHand: Number(onHand) || 0 });
      toast.success(supply ? t("Fourniture modifiée") : t("Fourniture ajoutée"));
      onSaved();
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
      onSaved();
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
        <Field label={t("Nom")}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus={!preset} /></Field>
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
          <Field label={t("Seuil de commande")} hint={t("Alerte à ce niveau")}><Input inputMode="numeric" value={reorderPoint} onChange={digits(setReorderPoint)} /></Field>
          <Field label={t("Quantité commandée")} hint={t("Proposée à la réception")}><Input inputMode="numeric" value={reorderQuantity} onChange={digits(setReorderQuantity)} /></Field>
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
