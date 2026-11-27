"use client";

import { Plus, Search, ShoppingBag, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CardThumb } from "@/components/card-chooser";
import { Stepper } from "@/components/stepper";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { BackLink, EmptyState, PageHeader, Spinner } from "@/components/ui/misc";
import { Choice, ChoiceGroup } from "@/components/ui/toggle-group";
import { api, createKeyring } from "@/lib/api";
import { formatEuros, parseEuros, variantLabel } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import { eurosInput } from "@/lib/pricing";
import { SHIPPING_LABEL, SHIPPING_MODES, salesMessage } from "@/lib/sales";
import type { SellableOffer, ShippingMode } from "@/lib/types";
import { ActionBar } from "@/components/ui/action-bar";

interface Line {
  offer: SellableOffer;
  qty: number;
  price: string;
}

const describe = (o: SellableOffer) =>
  `${o.card.setId} ${o.card.localNumber} · ${o.card.language.toUpperCase()} · ${variantLabel({ ...o.card, stamp: "", subtype: "" })} · ${o.condition}`;

export default function NewSalePage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [offers, setOffers] = useState<SellableOffer[] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [mode, setMode] = useState<ShippingMode>("LETTER_UNTRACKED");
  const [shipping, setShipping] = useState("0");
  const [buyer, setBuyer] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyring = useRef(createKeyring());

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      api.sellableOffers(q.trim() || undefined)
        .then((r) => current && setOffers(r.offers))
        .catch(() => current && setOffers([]));
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [q]);

  const chosen = new Set(lines.map((l) => l.offer.offerId));
  const update = (offerId: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.offer.offerId === offerId ? { ...l, ...patch } : l)));

  const priced = lines.map((l) => ({ ...l, cents: parseEuros(l.price) }));
  const shippingCents = parseEuros(shipping);
  const itemsCents = priced.reduce((sum, l) => sum + (l.cents ?? 0) * l.qty, 0);
  const ready = lines.length > 0 && priced.every((l) => l.cents !== null) && shippingCents !== null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    const payload = {
      lines: priced.map((l) => ({ offerId: l.offer.offerId, qty: l.qty, unitPriceCents: l.cents! })),
      shippingMode: mode,
      shippingChargedCents: shippingCents || undefined,
      buyerName: buyer.trim() || undefined,
      addressLines: mode === "HAND_DELIVERY" ? undefined : address.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6),
      note: note.trim() || undefined,
    };
    try {
      const order = await api.createSale(payload, keyring.current.keyFor(payload));
      router.push(`/sales/${order.id}`);
    } catch (err) {
      setError(salesMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <PageHeader back={<BackLink href="/sales">{t("Ventes")}</BackLink>} title={t("Nouvelle vente")} description={t("Les cartes sont réservées dès l'enregistrement : elles ne peuvent plus être vendues deux fois.")} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-5">
          <Card>
            <CardContent className="grid gap-3">
              <h2 className="text-[15px] font-semibold tracking-tight">{t("Ajouter des cartes")}</h2>
              <span className="relative block">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input type="search" placeholder={t("Nom de carte ou SKU d'offre")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Rechercher une carte en stock")} autoCorrect="off" className="pl-9" />
              </span>
              {offers && offers.length === 0 && (
                <p className="text-sm text-muted-foreground">{q.trim() ? t("Aucune carte disponible ne correspond.") : t("Aucune carte disponible à la vente pour l'instant.")}</p>
              )}
              {offers && offers.length > 0 && (
                <ul className="-mx-1 grid max-h-80 gap-0.5 overflow-y-auto" aria-label={t("Cartes disponibles")}>
                  {offers.map((o) => (
                    <li key={o.offerId} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                      <CardThumb imageUrl={o.card.imageUrl} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{o.card.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{describe(o)}</span>
                        <span className="tabular block text-xs text-muted-foreground">
                          {tn(o.availableToSell, "{n} disponible", "{n} disponibles")}{o.targetPriceCents !== null ? ` · ${formatEuros(o.targetPriceCents)}` : ` · ${t("sans prix")}`}
                        </span>
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={chosen.has(o.offerId)}
                        aria-label={t("Ajouter {name} {condition}", { name: o.card.name, condition: o.condition })}
                        onClick={() => setLines((ls) => [...ls, { offer: o, qty: 1, price: o.targetPriceCents !== null ? eurosInput(o.targetPriceCents) : "" }])}
                      >
                        <Plus /> {chosen.has(o.offerId) ? t("Ajoutée") : t("Ajouter")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-3">
              <h2 className="text-[15px] font-semibold tracking-tight">{t("Cartes vendues")}</h2>
              {lines.length === 0 ? (
                <EmptyState icon={<ShoppingBag />} title={t("Aucune carte dans cette vente")}>{t("Ajoute les cartes vendues depuis la recherche ci-dessus.")}</EmptyState>
              ) : (
                <ul className="grid divide-y" aria-label={t("Cartes vendues")}>
                  {priced.map((l) => {
                    const belowFloor = l.cents !== null && l.offer.floorPriceCents !== null && l.cents < l.offer.floorPriceCents;
                    return (
                      <li key={l.offer.offerId} className="grid gap-2.5 py-3 first:pt-0 last:pb-0" data-testid={`line-${l.offer.offerSku}`}>
                        <div className="flex items-start gap-3">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{l.offer.card.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">{describe(l.offer)}</span>
                          </span>
                          <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.offer.offerId !== l.offer.offerId))} aria-label={t("Retirer {name}", { name: l.offer.card.name })} className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/40">
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                          <Stepper value={l.qty} onChange={(qty) => update(l.offer.offerId, { qty })} max={l.offer.availableToSell} label={t("Quantité de {name}", { name: l.offer.card.name })} />
                          <Field label={t("Prix unitaire (€)")} className="w-32">
                            <Input inputMode="decimal" value={l.price} onChange={(e) => update(l.offer.offerId, { price: e.target.value })} onFocus={(e) => e.target.select()} aria-invalid={l.cents === null} className="tabular" />
                          </Field>
                          <span className="tabular ml-auto pb-2.5 text-sm font-semibold">{l.cents === null ? "—" : formatEuros(l.cents * l.qty)}</span>
                        </div>
                        {belowFloor && <p className="text-xs text-warning">{t("Sous le prix plancher de cette offre ({price}).", { price: formatEuros(l.offer.floorPriceCents!) })}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5 lg:sticky lg:top-6">
          <Card>
            <CardContent className="grid gap-4">
              <h2 className="text-[15px] font-semibold tracking-tight">{t("Mode de remise")}</h2>
              <ChoiceGroup value={mode} onValueChange={setMode} aria-label={t("Mode de remise")} className="grid grid-cols-2 gap-2">
                {SHIPPING_MODES.map((m) => <Choice key={m} value={m} className="h-auto min-h-11 px-2 py-2 text-center text-[13px] leading-tight">{t(SHIPPING_LABEL[m])}</Choice>)}
              </ChoiceGroup>
              <Field label={t("Frais de port facturés (€)")} hint={t("Ajoutés au total encaissé.")}>
                <Input inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} onFocus={(e) => e.target.select()} aria-invalid={shippingCents === null} className="tabular" />
              </Field>
              <Field label={t("Acheteur (facultatif)")}>
                <Input value={buyer} onChange={(e) => setBuyer(e.target.value)} maxLength={120} placeholder={t("Nom ou pseudo")} />
              </Field>
              {mode !== "HAND_DELIVERY" && (
                <Field label={t("Adresse de livraison (facultatif)")} hint={t("Imprimée sur le bon de livraison.")}>
                  <Textarea value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} placeholder={"12 rue des Lilas\n69003 Lyon"} className="min-h-16" />
                </Field>
              )}
              <Field label={t("Note (facultatif)")}>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t("Salon, groupe, conditions…")} className="min-h-16" />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-3">
              <dl className="tabular grid gap-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">{t("Cartes")}</dt><dd>{formatEuros(itemsCents)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">{t("Port facturé")}</dt><dd>{formatEuros(shippingCents ?? 0)}</dd></div>
                <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>{t("Total encaissé")}</dt><dd data-testid="sale-total">{formatEuros(itemsCents + (shippingCents ?? 0))}</dd></div>
              </dl>
              {error && <Alert variant="destructive">{error}</Alert>}
            </CardContent>
          </Card>
        </div>
      </div>
      <ActionBar message={lines.length === 0 ? t("Ajoute au moins une carte.") : <span className="tabular">{tn(lines.length, "{n} ligne", "{n} lignes")} · <strong className="font-semibold text-foreground">{formatEuros(itemsCents + (shippingCents ?? 0))}</strong> {t("encaissés")}</span>}>
        <Button type="submit" disabled={busy || !ready}>
          {busy ? <><Spinner className="text-primary-foreground" /> {t("Enregistrement…")}</> : t("Enregistrer la vente")}
        </Button>
      </ActionBar>
    </form>
  );
}
