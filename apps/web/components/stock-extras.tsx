"use client";

import { Award, Check, Package, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LockedFeature, hasFeature } from "@/components/plan";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { api } from "@/lib/api";
import { formatEuros, formatNumber, parseEuros } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import { eurosInput } from "@/lib/pricing";
import type { AccountSummary, StockDetail, StockRow, StockSuggestions } from "@/lib/types";

/*
 * Ce que le stock ajoute à une carte au-delà du prix : sa gradation, les suggestions de titre et de prix (forfaits Pro
 * et Boutique), et la création d'un lot depuis la sélection.
 */

export const GRADERS = ["PSA", "BGS", "CGC", "SGC", "PCA", "CCC", "TAG", "ACE", "Autre"];
export const GRADES = ["10", "9.5", "9", "8.5", "8", "7.5", "7", "6.5", "6", "5.5", "5", "4.5", "4", "3.5", "3", "2.5", "2", "1.5", "1", "Authentic"];

/** Carte gradée : société, note, certificat. Seul un exemplaire unique peut être gradé. */
export function GradingEditor({ detail, onSaved }: { detail: StockDetail; onSaved: (d: StockDetail) => void }) {
  const [editing, setEditing] = useState(false);
  const [grader, setGrader] = useState(detail.grader ?? "PSA");
  const [grade, setGrade] = useState(detail.grade ?? "10");
  const [cert, setCert] = useState(detail.certNumber ?? "");
  const [busy, setBusy] = useState(false);

  async function save(grading: { grader: string; grade: string; certNumber: string | null } | null) {
    setBusy(true);
    try {
      onSaved(await api.setGrading(detail.offerId, grading));
      setEditing(false);
      toast.success(grading ? t("Gradation enregistrée") : t("Carte non gradée"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!detail.isUnique) {
    return <p className="text-[13px] text-muted-foreground">{t("Une carte gradée est un exemplaire unique : entrez-la comme telle pour noter sa gradation.")}</p>;
  }
  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-sm" data-testid="stock-grading">
        <Award className="size-4 text-muted-foreground" aria-hidden />
        <span className="flex-1">
          {detail.grader
            ? <><strong className="font-semibold">{[detail.grader, detail.grade].join(" ")}</strong>{detail.certNumber && <span className="text-muted-foreground"> · {t("certificat {n}", { n: detail.certNumber })}</span>}</>
            : <span className="text-muted-foreground">{t("Non gradée")}</span>}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{detail.grader ? t("Modifier") : t("Noter une gradation")}</Button>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("Société")}>
          <Select value={grader} onChange={(e) => setGrader(e.target.value)} data-testid="grading-grader">
            {GRADERS.map((g) => <option key={g} value={g}>{g === "Autre" ? t("Autre") : g}</option>)}
          </Select>
        </Field>
        <Field label={t("Note")}>
          <Select value={grade} onChange={(e) => setGrade(e.target.value)} data-testid="grading-grade">
            {GRADES.map((g) => <option key={g} value={g}>{g === "Authentic" ? t("Authentique") : g}</option>)}
          </Select>
        </Field>
      </div>
      <Field label={t("Numéro de certificat")} hint={t("Facultatif ; il figure dans l'annonce.")}>
        <Input value={cert} onChange={(e) => setCert(e.target.value)} maxLength={30} className="font-mono" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => save({ grader, grade, certNumber: cert.trim() || null })}>{busy ? <Spinner /> : <Check />} {t("Enregistrer")}</Button>
        {detail.grader && <Button size="sm" variant="outline" disabled={busy} onClick={() => save(null)}>{t("Retirer la gradation")}</Button>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>{t("Annuler")}</Button>
      </div>
    </div>
  );
}

/** Suggestions de titre et de prix (forfaits Pro et Boutique) ; ailleurs, ce que le forfait supérieur apporterait. */
export function SuggestionsPanel({ detail, account, onChanged }: { detail: StockDetail; account: AccountSummary | null; onChanged: (d?: StockDetail) => void }) {
  const allowed = hasFeature(account, "suggestions");
  const [data, setData] = useState<StockSuggestions | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!allowed) return;
    api.suggestions(detail.offerId).then(setData).catch(() => setData(null));
  }, [allowed, detail.offerId, detail.text.title, detail.targetPriceCents]);

  if (!account) return null;
  if (!allowed) return <LockedFeature feature="suggestions" account={account}>{t("Un titre que les acheteurs trouvent, et le prix que le marché soutient, pour chaque carte.")}</LockedFeature>;
  if (!data) return null;

  async function apply(key: string, action: () => Promise<StockDetail | void>, done: string) {
    setBusy(key);
    try {
      onChanged((await action()) ?? undefined);
      toast.success(done);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const titleDiffers = data.title.suggested !== data.title.current;
  const priceDiffers = data.price.suggestedCents !== null && data.price.suggestedCents !== data.price.currentCents;
  return (
    <div className="grid gap-2 rounded-md border bg-brand-soft/30 px-3 py-2.5 text-[13px]" data-testid="stock-suggestions">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Sparkles className="size-3.5 text-brand" aria-hidden /> {t("Suggestions")}</p>
      <div className="grid gap-1">
        <p className="[overflow-wrap:anywhere]"><span className="text-muted-foreground">{t("Titre :")}</span> {data.title.suggested}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {titleDiffers && (
            <button type="button" disabled={busy !== null} className="font-medium underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => apply("title", () => api.setTitle(detail.offerId, data.title.suggested), t("Titre appliqué"))}>
              {busy === "title" ? <Spinner /> : t("Utiliser ce titre")}
            </button>
          )}
          {data.title.custom && (
            <button type="button" disabled={busy !== null} className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground"
              onClick={() => apply("reset", () => api.setTitle(detail.offerId, null), t("Retour au modèle de titre"))}>
              <RotateCcw className="size-3" aria-hidden /> {t("Revenir au modèle")}
            </button>
          )}
          {!titleDiffers && !data.title.custom && <span className="text-muted-foreground">{t("C'est déjà le titre de l'annonce.")}</span>}
        </div>
      </div>
      {data.price.suggestedCents !== null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span><span className="text-muted-foreground">{t("Prix :")}</span> <span className="tabular font-medium">{formatEuros(data.price.suggestedCents)}</span>
            {data.price.sales && <span className="text-muted-foreground"> · {t("d'après les ventes réussies")}</span>}</span>
          {priceDiffers && (
            <button type="button" disabled={busy !== null} className="font-medium underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => apply("price", async () => { await api.setOfferPrice(detail.offerId, { targetPriceCents: data.price.suggestedCents! }); }, t("Prix appliqué"))}>
              {busy === "price" ? <Spinner /> : t("Appliquer ce prix")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Crée un lot avec les cartes cochées : un titre, un prix, et autant d'exemplaires de chacune que voulu. */
export function CreateLotModal({ rows, onClose, onCreated }: { rows: StockRow[]; onClose: () => void; onCreated: () => void }) {
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(rows.map((r) => [r.offerId, r.available > 0 ? 1 : 0])));
  const cards = rows.reduce((n, r) => n + (qty[r.offerId] ?? 0), 0);
  const value = rows.reduce((n, r) => n + (qty[r.offerId] ?? 0) * (r.targetPriceCents ?? r.suggestedPriceCents ?? 0), 0);
  const [title, setTitle] = useState(() => t("Lot de {n} cartes Pokémon", { n: formatNumber(cards) }));
  const [price, setPrice] = useState(() => eurosInput(Math.round((value * 0.8) / 50) * 50));
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const cents = parseEuros(price);

  async function create() {
    if (cents === null) return;
    setBusy(true);
    try {
      const lot = await api.createSaleLot({
        title: title.trim(), description: description.trim() || null, priceCents: cents,
        items: rows.filter((r) => (qty[r.offerId] ?? 0) > 0).map((r) => ({ offerId: r.offerId, qty: qty[r.offerId]! })),
      });
      toast.success(t("Lot créé : {title}", { title: lot.title }), { action: { label: t("Voir les lots"), onClick: () => window.location.assign("/lots") } });
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={t("Créer un lot")} description={t("Ces cartes quittent le stock à l'unité et partent ensemble, en une seule annonce. Un lot pas encore vendu peut être défait.")} onClose={onClose}>
      <div className="grid gap-4">
        <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-md border p-1">
          {rows.map((r) => (
            <li key={r.offerId} className="flex items-center gap-2 px-2 py-1 text-[13px]">
              <span className="min-w-0 flex-1 truncate"><span className="font-medium">{r.name}</span> <span className="text-muted-foreground">· {r.setCode} {r.localNumber} · {r.condition}</span></span>
              <Input
                type="number" min={0} max={r.available} value={qty[r.offerId] ?? 0} aria-label={t("Exemplaires de {name}", { name: r.name })}
                onChange={(e) => setQty((q) => ({ ...q, [r.offerId]: Math.max(0, Math.min(r.available, Number(e.target.value) || 0)) }))}
                className="tabular h-8 w-16 text-right"
              />
              <span className="tabular w-10 text-xs text-muted-foreground">/ {r.available}</span>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-muted-foreground">
          {tn(cards, "{n} carte", "{n} cartes")} · {t("valeur à l'unité {value}", { value: formatEuros(value) })}
        </p>
        <Field label={t("Titre de l'annonce")} hint={t("{n} / 80 caractères", { n: formatNumber(title.length) })}>
          <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} data-testid="lot-title" />
        </Field>
        <Field label={t("Prix du lot (€)")}>
          <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={cents === null} className="tabular" data-testid="lot-price" />
        </Field>
        <Field label={t("Texte en tête de description")} hint={t("La liste des cartes suit toujours.")}>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </Field>
        <Button onClick={create} disabled={busy || cards < 2 || !title.trim() || cents === null} data-testid="lot-create">
          {busy ? <Spinner /> : <Package />} {t("Créer ce lot")}
        </Button>
        {cards < 2 && <p className="text-[13px] text-muted-foreground">{t("Un lot regroupe au moins deux cartes.")}</p>}
        <Link href="/lots" className="justify-self-start text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground">{t("Voir les lots existants")}</Link>
      </div>
    </Modal>
  );
}
