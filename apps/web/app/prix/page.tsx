"use client";

import { Check, CircleCheckBig, Pencil, RefreshCw, Search, Tags } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CardThumb } from "@/components/card-chooser";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Code, EmptyState, Loading, PageHeader, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { StrategyPicker } from "@/components/strategy-picker";
import { Pagination, SegmentedTabs } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { formatEuros, parseEuros, variantLabel } from "@/lib/format";
import { CATEGORY_LABEL, CATEGORY_VARIANT, DECIDABLE_CATEGORIES, age, eurosInput, quoteLabel, reasonLabel, roundPrice, tierOf, type Category } from "@/lib/pricing";
import { CONDITIONS, type OfferPricing, type PricingSettings } from "@/lib/types";

const PAGE_SIZE = 25;
type Tab = "REVIEW" | "ALL" | "RULES";
const message = (e: unknown) =>
  e instanceof ApiError && e.code === "FLOOR_ABOVE_TARGET" ? "Le plancher ne peut pas dépasser le prix cible."
  : e instanceof ApiError && e.code === "INVALID_PRICING_SETTINGS" ? "Règles incohérentes : les seuils doivent être croissants (vrac ≤ lot ≤ unité ≤ premium) et le pas d'arrondi d'au moins 0,01 €."
  : (e as Error).message;

export default function PricingPage() {
  const [tab, setTab] = useState<Tab>("REVIEW");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: OfferPricing[]; total: number; reviewCount: number; allCount: number } | null>(null);
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<OfferPricing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    // Lien depuis une fiche de position : /prix?q=<SKU de l'offre>
    const preset = new URLSearchParams(window.location.search).get("q");
    if (preset) {
      setQ(preset);
      setTab("ALL");
    }
    api.pricingSettings().then(setSettings).catch((e: Error) => setError(e.message));
  }, []);

  const load = useCallback(() => {
    const id = ++request.current;
    api.pricedOffers({ status: tab === "ALL" ? "ALL" : "REVIEW", q: q.trim() || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then((r) => {
        if (id !== request.current) return;
        setData(r);
        setError(null);
      })
      .catch((e: Error) => id === request.current && setError(e.message));
  }, [tab, q, page]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  async function recompute() {
    setBusy("recompute");
    try {
      const { repriced } = await api.recomputePricing();
      toast.success(`${repriced} offre${repriced > 1 ? "s recalculées" : " recalculée"}`);
      load();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(null);
    }
  }

  async function accept(o: OfferPricing) {
    if (o.suggestedPriceCents === null || !settings) return;
    setBusy(o.offerId);
    try {
      await api.setOfferPrice(o.offerId, { targetPriceCents: o.suggestedPriceCents, category: tierOf(o.suggestedPriceCents, settings) });
      toast.success(`${o.card.name} : ${formatEuros(o.suggestedPriceCents)}`);
      load();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(null);
    }
  }

  const pageCount = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Prix"
        description="Chaque offre reçoit une estimation à partir des cotations importées. Vous décidez du prix ; il ne change jamais tout seul."
        actions={
          <Button variant="outline" onClick={recompute} disabled={busy !== null}>
            {busy === "recompute" ? <Spinner /> : <RefreshCw />} Recalculer
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          label="Prix"
          value={tab}
          onChange={(next) => {
            setTab(next);
            setPage(1);
          }}
          tabs={[
            { value: "REVIEW", label: "À revoir", count: data?.reviewCount },
            { value: "ALL", label: "Toutes", count: data?.allCount },
            { value: "RULES", label: "Règles" },
          ]}
        />
        {tab !== "RULES" && (
          <span className="relative block min-w-56 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" placeholder="Nom de carte ou SKU d'offre" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Rechercher une offre" autoCorrect="off" className="pl-9" />
          </span>
        )}
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      {tab === "RULES" ? (
        settings ? <Rules settings={settings} onSaved={(s) => { setSettings(s); load(); }} /> : <Loading />
      ) : !data ? (
        !error && <Loading />
      ) : data.items.length === 0 ? (
        <EmptyState icon={tab === "REVIEW" ? <CircleCheckBig /> : <Tags />} title={q.trim() ? "Aucune offre ne correspond" : tab === "REVIEW" ? "Rien à revoir" : "Aucune offre en stock"}>
          {q.trim() ? undefined : tab === "REVIEW" ? "Toutes les offres en stock ont un prix décidé et cohérent avec le marché." : "Les cartes entrées en stock apparaîtront ici avec leur estimation."}
        </EmptyState>
      ) : (
        <>
          <Card className="divide-y overflow-hidden">
            {data.items.map((o) => {
              const canAccept = o.suggestedPriceCents !== null && o.suggestedPriceCents !== o.targetPriceCents && !o.reasons.includes("NO_REFERENCE");
              return (
                <div key={o.offerId} className="grid gap-3 px-4 py-3.5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center" data-testid={`offer-${o.offerSku}`}>
                  <div className="flex min-w-0 items-start gap-3">
                    <CardThumb imageUrl={o.card.imageUrl} size="sm" />
                    <div className="grid min-w-0 gap-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-sm font-semibold">{o.card.name}</span>
                        <Badge variant={CATEGORY_VARIANT[o.category]}>{CATEGORY_LABEL[o.category]}</Badge>
                        <span className="tabular text-xs text-muted-foreground">× {o.onHand}</span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {o.card.setId} {o.card.localNumber} · {o.card.language.toUpperCase()} · {variantLabel({ ...o.card, stamp: "", subtype: "" })} · {o.condition}{o.isUnique ? " · unique" : ""}
                      </p>
                      {o.reasons.length > 0 && (
                        <ul className="grid gap-0.5 text-xs text-warning">
                          {o.reasons.map((r) => <li key={r}>• {reasonLabel(r)}</li>)}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 lg:justify-end">
                    <dl className="tabular flex gap-5 text-sm">
                      <div className="grid gap-0.5">
                        <dt className="text-[11px] text-muted-foreground">Prix cible</dt>
                        <dd className="font-semibold">{o.targetPriceCents === null ? "—" : formatEuros(o.targetPriceCents)}</dd>
                      </div>
                      <div className="grid gap-0.5">
                        <dt className="text-[11px] text-muted-foreground">Suggéré</dt>
                        <dd className={o.suggestedPriceCents !== null && o.suggestedPriceCents !== o.targetPriceCents ? "font-semibold text-primary" : "text-muted-foreground"}>
                          {o.suggestedPriceCents === null ? "—" : formatEuros(o.suggestedPriceCents)}
                        </dd>
                      </div>
                      <div className="grid gap-0.5">
                        <dt className="text-[11px] text-muted-foreground">{o.reference ? `${quoteLabel(o.reference.quoteType)} · ${age(o.reference.observedAt)}` : "Référence"}</dt>
                        <dd className="text-muted-foreground">{o.reference ? formatEuros(o.reference.amountCents) : "—"}</dd>
                      </div>
                    </dl>
                    <div className="flex gap-2">
                      {canAccept && (
                        <Button size="sm" onClick={() => accept(o)} disabled={busy !== null || !settings} aria-label={`Accepter ${formatEuros(o.suggestedPriceCents!)} pour ${o.card.name}`}>
                          {busy === o.offerId ? <Spinner className="text-primary-foreground" /> : <Check strokeWidth={2.5} />} Accepter
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setEditing(o)} disabled={busy !== null} aria-label={`Fixer le prix de ${o.card.name}`}>
                        <Pencil /> Fixer le prix
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>
          <Pagination page={page} pageCount={pageCount} onChange={setPage} />
        </>
      )}

      {editing && settings && (
        <PriceModal offer={editing} settings={settings} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function PriceModal({ offer, settings, onClose, onSaved }: { offer: OfferPricing; settings: PricingSettings; onClose: () => void; onSaved: () => void }) {
  const start = offer.targetPriceCents ?? offer.suggestedPriceCents;
  const [target, setTarget] = useState(start === null ? "" : eurosInput(start));
  const [floor, setFloor] = useState("");
  const [category, setCategory] = useState<Exclude<Category, "REVIEW">>(
    offer.category !== "REVIEW" ? offer.category : start !== null ? tierOf(start, settings) : "SINGLE",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetCents = parseEuros(target);
  const floorCents = floor.trim() === "" ? undefined : parseEuros(floor);
  const autoFloor = targetCents === null ? null
    : Math.min(targetCents, Math.max(
        roundPrice(Math.round((targetCents * settings.floorPercent) / 100), settings),
        offer.averageCostCents > 0 ? offer.averageCostCents + (category === "SINGLE" || category === "PREMIUM" ? settings.minMarginCents : 0) : 0,
      ));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (targetCents === null || floorCents === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.setOfferPrice(offer.offerId, { targetPriceCents: targetCents, floorPriceCents: floorCents, category });
      toast.success(`${offer.card.name} : ${formatEuros(targetCents)}`);
      onSaved();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Prix de ${offer.card.name}`} description={`${CONDITIONS.find((c) => c.code === offer.condition)?.label ?? offer.condition} · ${offer.onHand} en stock`} onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <dl className="tabular grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border text-sm">
          {[
            ["Suggéré", offer.suggestedPriceCents === null ? "—" : formatEuros(offer.suggestedPriceCents)],
            [offer.reference ? quoteLabel(offer.reference.quoteType) : "Référence", offer.reference ? formatEuros(offer.reference.amountCents) : "—"],
            ["Coût moyen", formatEuros(offer.averageCostCents)],
          ].map(([label, value]) => (
            <div key={label} className="grid gap-0.5 bg-card px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        {offer.reasons.length > 0 && (
          <Alert variant="warning"><ul className="grid gap-0.5">{offer.reasons.map((r) => <li key={r}>{reasonLabel(r)}</li>)}</ul></Alert>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prix cible (€)">
            <Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} onFocus={(e) => e.target.select()} aria-invalid={target !== "" && targetCents === null} required autoFocus className="tabular" />
          </Field>
          <Field label="Prix plancher (€)" hint={autoFloor !== null && floor.trim() === "" ? `Automatique : ${formatEuros(autoFloor)}` : undefined}>
            <Input inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="Automatique" aria-invalid={floorCents === null} className="tabular" />
          </Field>
        </div>
        <Field label="Catégorie de vente">
          <Select value={category} onChange={(e) => setCategory(e.target.value as Exclude<Category, "REVIEW">)}>
            {DECIDABLE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </Select>
        </Field>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" size="lg" disabled={busy || targetCents === null || floorCents === null}>Enregistrer le prix</Button>
        <p className="text-xs text-muted-foreground">Un prix fixé à la main n'est plus modifié par les règles ; un écart notable avec le marché le ramènera seulement dans « À revoir ».</p>
      </form>
    </Modal>
  );
}

function Rules({ settings, onSaved }: { settings: PricingSettings; onSaved: (s: PricingSettings) => void }) {
  const [strategy, setStrategy] = useState(settings.strategy);
  const [numbers, setNumbers] = useState({
    maxAgeDays: String(settings.maxAgeDays), floorPercent: String(settings.floorPercent), driftPercent: String(settings.driftPercent),
  });
  const [euros, setEuros] = useState({
    bulkBelowCents: eurosInput(settings.bulkBelowCents), lotBelowCents: eurosInput(settings.lotBelowCents),
    singleFromCents: eurosInput(settings.singleFromCents), premiumFromCents: eurosInput(settings.premiumFromCents),
    minMarginCents: eurosInput(settings.minMarginCents), roundFromCents: eurosInput(settings.roundFromCents),
    roundStepCents: eurosInput(settings.roundStepCents),
  });
  const [conditions, setConditions] = useState(Object.fromEntries(CONDITIONS.map((c) => [c.code, String(settings.conditionPercent[c.code])])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const int = (s: string) => (/^\d{1,5}$/.test(s.trim()) ? Number(s) : null);
  const parsed = {
    numbers: Object.fromEntries(Object.entries(numbers).map(([k, v]) => [k, int(v)])),
    euros: Object.fromEntries(Object.entries(euros).map(([k, v]) => [k, parseEuros(v)])),
    conditions: Object.fromEntries(Object.entries(conditions).map(([k, v]) => [k, int(v)])),
  };
  const valid = [...Object.values(parsed.numbers), ...Object.values(parsed.euros), ...Object.values(parsed.conditions)].every((v) => v !== null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.savePricingSettings({
        strategy, ...(parsed.numbers as Pick<PricingSettings, "maxAgeDays" | "floorPercent" | "driftPercent">),
        ...(parsed.euros as Pick<PricingSettings, "bulkBelowCents" | "lotBelowCents" | "singleFromCents" | "premiumFromCents" | "minMarginCents" | "roundFromCents" | "roundStepCents">),
        conditionPercent: parsed.conditions as PricingSettings["conditionPercent"],
      });
      toast.success(`Règles enregistrées, ${saved.repriced} offre${saved.repriced > 1 ? "s recalculées" : " recalculée"}`);
      onSaved(saved.settings);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const euro = (key: keyof typeof euros, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input inputMode="decimal" value={euros[key]} onChange={(e) => setEuros({ ...euros, [key]: e.target.value })} aria-invalid={parsed.euros[key] === null} className="tabular" />
    </Field>
  );
  const number = (key: keyof typeof numbers, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input inputMode="numeric" value={numbers[key]} onChange={(e) => setNumbers({ ...numbers, [key]: e.target.value })} aria-invalid={parsed.numbers[key] === null} className="tabular" />
    </Field>
  );

  return (
    <form className="grid gap-5 lg:grid-cols-2" onSubmit={submit}>
      <Card className="lg:col-span-2">
        <CardContent className="grid gap-4">
          <div className="grid gap-1">
            <CardTitle>Stratégie</CardTitle>
            <CardDescription>Où placer le prix dans la fourchette du marché : plus bas pour vendre vite, plus haut pour la marge.</CardDescription>
          </div>
          <StrategyPicker value={strategy} onChange={setStrategy} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-4">
          <div className="grid gap-1">
            <CardTitle>Ventes réussies</CardTitle>
            <CardDescription>Le prix part des ventes réalisées sur Cardmarket : celles du mois donnent la base, celles de la semaine la direction. Sans vente récente, la tendance des annonces sert de repère.</CardDescription>
          </div>
          {number("maxAgeDays", "Ancienneté maximale (jours)", "Au-delà, le relevé est jugé périmé et l'offre part en revue.")}
          <div className="grid gap-2">
            <span className="text-[13px] leading-none font-medium text-foreground/80">Part du prix des ventes selon l'état (%)</span>
            <div className="grid grid-cols-7 gap-1.5">
              {CONDITIONS.map((c) => (
                <label key={c.code} className="grid gap-1 text-center">
                  <span className="font-mono text-xs text-muted-foreground" title={c.label}>{c.code}</span>
                  <Input inputMode="numeric" value={conditions[c.code]} onChange={(e) => setConditions({ ...conditions, [c.code]: e.target.value })} aria-label={`Part pour ${c.label}`} aria-invalid={parsed.conditions[c.code] === null} className="tabular px-1 text-center" />
                </label>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">La source ne distingue pas les états : ce coefficient corrige la référence.</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4">
          <div className="grid gap-1">
            <CardTitle>Catégories et garde-fous</CardTitle>
            <CardDescription>Seuils sur le prix estimé. Entre « lot » et « à l'unité », l'offre part en revue : à vous de trancher.</CardDescription>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {euro("bulkBelowCents", "Vrac en dessous de (€)")}
            {euro("lotBelowCents", "Lot en dessous de (€)")}
            {euro("singleFromCents", "À l'unité à partir de (€)")}
            {euro("premiumFromCents", "Premium à partir de (€)")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {number("floorPercent", "Plancher (% du prix cible)")}
            {euro("minMarginCents", "Marge minimale à l'unité (€)", "Au-dessus du coût, pour les ventes à l'unité et premium.")}
          </div>
          {number("driftPercent", "Écart qui renvoie en revue (%)", "Entre un prix décidé et la suggestion du moment.")}
          <div className="grid grid-cols-2 gap-3">
            {euro("roundFromCents", "Arrondir à partir de (€)", "En dessous, les prix restent au centime.")}
            {euro("roundStepCents", "Pas d'arrondi (€)", "1,00 = à l'euro ; 5,00 = aux 5 euros.")}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:col-span-2">
        {error && <Alert variant="destructive">{error}</Alert>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || !valid}>{busy && <Spinner className="text-primary-foreground" />} Enregistrer les règles</Button>
          <span className="text-xs text-muted-foreground">Toutes les offres sont recalculées ; les prix déjà décidés ne changent pas.</span>
        </div>
      </div>
    </form>
  );
}
