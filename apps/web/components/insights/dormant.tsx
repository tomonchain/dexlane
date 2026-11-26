"use client";

import { Moon, PackagePlus, Percent, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CardThumb } from "@/components/card-chooser";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Code, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { formatNumber, parseEuros } from "@/lib/format";
import { formatAmount, insights, type DormantCard, type RepriceLine } from "@/lib/insights";
import { t, tn } from "@/lib/i18n";

const price = (c: Pick<DormantCard, "currency" | "priceCents">) => formatAmount({ currency: c.currency, cents: c.priceCents });

/**
 * Cartes dormantes (#83) : en ligne depuis plus de 90 jours, encore en stock, jamais vendues depuis leur mise en ligne.
 * Les actions portent sur la sélection et ne sont jamais automatiques : la baisse de prix montre un aperçu avant / après
 * puis demande une confirmation explicite.
 */
export function DormantCards() {
  const [data, setData] = useState<{ cards: DormantCard[]; afterDays: number; canBundle: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<"reprice" | "lot" | "withdraw" | null>(null);

  const load = () => insights.dormant().then((d) => {
    setData(d);
    setSelected((s) => new Set([...s].filter((id) => d.cards.some((c) => c.offerId === id))));
  }).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  // Arrivée depuis le rappel de l'accueil (/stats#dormantes) : le bloc se charge après la page, on y descend ensuite.
  useEffect(() => {
    if (data && window.location.hash === "#dormantes") document.getElementById("dormantes")?.scrollIntoView({ block: "start" });
  }, [data]);

  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!data) return null;
  const cards = data.cards;
  const chosen = cards.filter((c) => selected.has(c.offerId));
  const allChecked = cards.length > 0 && chosen.length === cards.length;
  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const done = (message: string) => {
    toast.success(message);
    setAction(null);
    setSelected(new Set());
    void load();
  };

  return (
    <Card id="dormantes" data-testid="dormant-cards">
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"><Moon className="size-4 text-muted-foreground" aria-hidden /> {t("Cartes dormantes")}</h2>
            <p className="text-[13px] text-muted-foreground">
              {t("En ligne depuis plus de {days} jours, encore en stock, sans aucune vente depuis leur mise en ligne.", { days: data.afterDays })}
            </p>
          </div>
          {cards.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={chosen.length === 0} onClick={() => setAction("reprice")}><Percent /> {t("Baisser le prix")}</Button>
              {data.canBundle && <Button size="sm" variant="outline" disabled={chosen.filter((c) => c.kind === "CARD").length === 0} onClick={() => setAction("lot")}><PackagePlus /> {t("Regrouper en lot")}</Button>}
              <Button size="sm" variant="destructive" disabled={chosen.length === 0} onClick={() => setAction("withdraw")}><Store /> {t("Retirer de la vente")}</Button>
            </div>
          )}
        </div>

        {cards.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{t("Aucune carte dormante : tout ce qui est en ligne s'est vendu ou y est depuis moins longtemps.")}</p>
        ) : (
          <div className="grid text-sm">
            <div className="hidden grid-cols-[1.5rem_minmax(0,1fr)_6rem_6rem_minmax(6rem,10rem)] items-center gap-3 border-b pb-2 text-xs font-medium text-muted-foreground sm:grid">
              <input type="checkbox" checked={allChecked} onChange={(e) => setSelected(new Set(e.target.checked ? cards.map((c) => c.offerId) : []))} aria-label={t("Tout sélectionner")} className="size-4 cursor-pointer accent-foreground" />
              <span>{t("Carte")}</span><span className="text-right">{t("Prix actuel")}</span><span className="text-right">{t("En ligne")}</span><span>{t("Emplacement")}</span>
            </div>
            <ul className="divide-y">
              {cards.map((c) => (
                <li key={c.offerId} className="tabular grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[1.5rem_minmax(0,1fr)_6rem_6rem_minmax(6rem,10rem)]" data-testid="dormant-row">
                  <input type="checkbox" checked={selected.has(c.offerId)} onChange={() => toggle(c.offerId)} aria-label={t("Sélectionner {name}", { name: c.name })} className="size-4 cursor-pointer accent-foreground" />
                  <span className="flex min-w-0 items-center gap-2.5">
                    <CardThumb imageUrl={c.imageUrl} size="sm" className="w-7 rounded-[3px]" />
                    <span className="grid min-w-0">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{[c.setName, c.localNumber, c.condition, tn(c.available, "{n} exemplaire", "{n} exemplaires")].filter(Boolean).join(" · ")}</span>
                    </span>
                  </span>
                  <span className="text-right font-medium">{price(c)}</span>
                  <span className="col-start-2 text-xs text-muted-foreground sm:col-start-auto sm:text-right sm:text-sm sm:text-foreground">{tn(c.daysOnline, "{n} jour", "{n} jours")}</span>
                  <span className="col-start-3 row-start-2 flex flex-wrap justify-end gap-1 sm:col-start-auto sm:row-start-auto sm:justify-start">
                    {c.locations.map((code) => <Code key={code} className="text-xs">{code}</Code>)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      {action === "reprice" && <RepriceModal cards={chosen} onClose={() => setAction(null)} onDone={(n) => done(tn(n, "Prix baissé sur {n} carte", "Prix baissé sur {n} cartes"))} />}
      {action === "lot" && <LotModal cards={chosen.filter((c) => c.kind === "CARD")} onClose={() => setAction(null)} onDone={() => done(t("Lot créé : il est dans Lots de vente, prêt à mettre en ligne."))} />}
      {action === "withdraw" && <WithdrawModal cards={chosen} onClose={() => setAction(null)} onDone={(n) => done(tn(n, "{n} carte retirée de la vente", "{n} cartes retirées de la vente"))} />}
    </Card>
  );
}

function RepriceModal({ cards, onClose, onDone }: { cards: DormantCard[]; onClose: () => void; onDone: (n: number) => void }) {
  const [percent, setPercent] = useState("10");
  const [preview, setPreview] = useState<RepriceLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = Number(percent);
  const valid = Number.isInteger(value) && value >= 1 && value <= 90;
  const ids = cards.map((c) => c.offerId);
  const currencyOf = (id: string) => cards.find((c) => c.offerId === id)?.currency ?? "EUR";

  async function run(step: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("Baisser le prix")} description={tn(cards.length, "{n} carte sélectionnée", "{n} cartes sélectionnées")} onClose={onClose}>
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) void run(async () => setPreview((await insights.previewReprice(ids, value)).lines)); }}>
        <Field label={t("Baisse, en %")} className="w-32">
          <Input inputMode="numeric" value={percent} onChange={(e) => { setPercent(e.target.value); setPreview(null); }} aria-invalid={!valid} />
        </Field>
        <Button type="submit" variant="outline" disabled={!valid || busy}>{t("Voir l'aperçu")}</Button>
      </form>
      {preview && (
        <div className="grid gap-2" data-testid="reprice-preview">
          <p className="text-xs text-muted-foreground">{t("Avant et après, carte par carte. Rien ne change tant que vous n'avez pas confirmé.")}</p>
          <ul className="divide-y rounded-lg border text-sm">
            {preview.map((l) => (
              <li key={l.offerId} className="tabular flex items-center justify-between gap-3 px-3 py-2">
                <span className="truncate">{l.name}</span>
                <span className="whitespace-nowrap">
                  <span className="text-muted-foreground line-through">{formatAmount({ currency: currencyOf(l.offerId), cents: l.beforeCents })}</span>{" → "}
                  <span className="font-semibold">{formatAmount({ currency: currencyOf(l.offerId), cents: l.afterCents })}</span>
                  {l.atFloor && <span className="ml-1.5 text-xs text-warning">{t("prix plancher")}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t("Annuler")}</Button>
        <Button disabled={!preview || busy} onClick={() => void run(async () => onDone((await insights.reprice(ids, value)).repriced))} data-testid="reprice-confirm">
          {busy && <Spinner className="text-primary-foreground" />} {t("Confirmer la baisse")}
        </Button>
      </div>
    </Modal>
  );
}

function LotModal({ cards, onClose, onDone }: { cards: DormantCard[]; onClose: () => void; onDone: () => void }) {
  const total = cards.reduce((n, c) => n + c.priceCents * c.available, 0);
  const units = cards.reduce((n, c) => n + c.available, 0);
  const [title, setTitle] = useState(t("Lot de {n} cartes Pokémon", { n: units }));
  const [priceText, setPriceText] = useState(String(Math.round((total * 0.7) / 100)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = parseEuros(priceText);
  return (
    <Modal title={t("Regrouper en lot")} description={t("{cards} en une seule annonce. Leurs annonces à l'unité passent à zéro.", { cards: tn(units, "{n} carte", "{n} cartes") })} onClose={onClose}>
      <Field label={t("Titre du lot")}><Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label={t("Prix du lot, en euros")} hint={t("Prix actuels additionnés : {total}", { total: formatAmount({ currency: "EUR", cents: total }) })}>
        <Input inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)} aria-invalid={cents === null} />
      </Field>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t("Annuler")}</Button>
        <Button disabled={busy || !title.trim() || cents === null || units < 2} onClick={() => {
          setBusy(true);
          insights.bundle(cards.map((c) => c.offerId), title, cents!).then(onDone).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
        }}>{busy && <Spinner className="text-primary-foreground" />} {t("Créer le lot")}</Button>
      </div>
    </Modal>
  );
}

function WithdrawModal({ cards, onClose, onDone }: { cards: DormantCard[]; onClose: () => void; onDone: (n: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listings = cards.reduce((n, c) => n + c.listingIds.length, 0);
  return (
    <Modal title={t("Retirer de la vente")} onClose={onClose}>
      <p className="text-sm">{t("Les annonces de {cards} seront terminées sur les canaux ({listings}). Les cartes restent dans votre stock.", { cards: tn(cards.length, "{n} carte", "{n} cartes"), listings: tn(listings, "{n} annonce", "{n} annonces") })}</p>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t("Annuler")}</Button>
        <Button variant="destructive" disabled={busy} onClick={() => {
          setBusy(true);
          insights.withdraw(cards.map((c) => c.offerId)).then((r) => onDone(r.cards)).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
        }}>{busy && <Spinner />} {t("Retirer {n}", { n: formatNumber(cards.length) })}</Button>
      </div>
    </Modal>
  );
}
