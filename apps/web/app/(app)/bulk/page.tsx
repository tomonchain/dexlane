"use client";

import { ArrowRight, Check, Layers } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LocationField } from "@/components/location-picker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Eyebrow } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Code, PageHeader, Spinner } from "@/components/ui/misc";
import { Choice, ChoiceGroup } from "@/components/ui/toggle-group";
import { ApiError, api, createKeyring } from "@/lib/api";
import { formatEuros, parseEuros } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useStored } from "@/lib/storage";
import type { AcquisitionLot, ReceivedBulkLot } from "@/lib/types";

const TYPES = ["communes", "peu communes", "rares", "holos", "reverses", "dresseurs", "énergies", "mélange"];
const LANGUAGES: [string, string][] = [["", "Mélangées / inconnue"], ["fr", "Français"], ["en", "Anglais"], ["de", "Allemand"], ["it", "Italien"], ["es", "Espagnol"], ["ja", "Japonais"]];

export default function BulkPage() {
  const [locationCode, setLocationCode] = useStored("dexlane.bulk.location", "");
  const [cardType, setCardType] = useState("communes");
  const [scope, setScope] = useState("");
  const [scopeKind, setScopeKind] = useState<"setId" | "era">("era");
  const [language, setLanguage] = useState("fr");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("0");
  const [lotId, setLotId] = useState("");
  const [lots, setLots] = useState<AcquisitionLot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ReceivedBulkLot | null>(null);
  const keyring = useRef(createKeyring());

  useEffect(() => {
    api.lots().then((r) => setLots(r.lots)).catch(() => setLots([]));
  }, []);

  const count = /^\d{1,7}$/.test(quantity.trim()) ? Number(quantity) : 0;
  const totalCents = parseEuros(cost);
  const ready = count > 0 && totalCents !== null && locationCode !== "";
  const unitPreview = ready ? formatEuros(Math.round(totalCents! / count)) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    const payload = {
      descriptor: { cardType, [scopeKind]: scope.trim() || undefined, language: language || undefined },
      quantity: count,
      locationCode,
      totalCostCents: totalCents!,
      acquisitionLotId: lotId || undefined,
    };
    try {
      setDone(await api.receiveBulk(payload, keyring.current.keyFor(payload)));
      keyring.current.reset();
      setQuantity("");
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "LOCATION_NOT_FOUND" ? t("Cet emplacement n'existe pas.") : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid max-w-3xl gap-5" onSubmit={submit}>
      <PageHeader title={t("Lot de vrac")} description={t("Un lot compté ou pesé entre en une seule position, sans scanner chaque carte.")} />

      {done && (
        <Card className="overflow-hidden border-success/25" aria-live="polite">
          <div className="flex items-center gap-2 border-b border-success/15 bg-success-soft px-4 py-2.5 text-sm font-medium text-success sm:px-5">
            <Check className="size-4" strokeWidth={2.5} aria-hidden /> {t("Lot enregistré.")}
          </div>
          <CardContent className="grid gap-3">
            <div className="grid gap-1">
              <Eyebrow>{t("Code de la position")}</Eyebrow>
              <p className="font-mono text-3xl font-semibold tracking-tight">{done.stockItem.unitSku}</p>
            </div>
            <p className="text-sm"><strong className="font-semibold">{done.descriptor.label}</strong> × {done.stockItem.onHand}, {t("rangé en")} <Code>{done.locationCode}</Code></p>
            <p className="text-sm text-muted-foreground">{t("Coût unitaire retenu : {cost} (arrondi au centime).", { cost: formatEuros(done.stockItem.unitCostCents) })}</p>
            <Button variant="link" size="sm" asChild className="justify-self-start">
              <Link href={`/inventory/${done.stockItem.unitSku}`}>{t("Voir la fiche")} <ArrowRight /></Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="grid gap-4">
          <h2 className="text-[15px] font-semibold tracking-tight">{t("Contenu")}</h2>
          <ChoiceGroup value={cardType} onValueChange={setCardType} aria-label={t("Type de cartes")}>
            {TYPES.map((type) => <Choice key={type} value={type} className="capitalize">{t(type)}</Choice>)}
          </ChoiceGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Regroupement")}>
              <Select value={scopeKind} onChange={(e) => setScopeKind(e.target.value as "setId" | "era")}>
                <option value="era">{t("Époque")}</option>
                <option value="setId">{t("Série (identifiant)")}</option>
              </Select>
            </Field>
            <Field label={scopeKind === "era" ? t("Époque (facultatif)") : t("Série (facultatif)")}>
              <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder={scopeKind === "era" ? t("Écarlate et Violet") : "sv01"} autoCorrect="off" />
            </Field>
          </div>
          <Field label={t("Langue")}>
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{t(label)}</option>)}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4">
          <h2 className="text-[15px] font-semibold tracking-tight">{t("Quantité et coût")}</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Nombre de cartes")}>
              <Input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="1000" required className="tabular" />
            </Field>
            <Field label={t("Coût total du lot (€)")} hint={unitPreview ? t("soit {price} par carte", { price: unitPreview }) : undefined}>
              <Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} onFocus={(e) => e.target.select()} aria-invalid={totalCents === null} className="tabular" />
            </Field>
          </div>
          <Field label={t("Lot d'acquisition")}>
            <Select value={lotId} onChange={(e) => setLotId(e.target.value)}>
              <option value="">{t("Aucun")}</option>
              {lots.map((l) => <option key={l.id} value={l.id}>{l.purchaseDate} · {l.sourceType}{l.sellerRef ? ` · ${l.sellerRef}` : ""}</option>)}
            </Select>
          </Field>
          <LocationField value={locationCode} onChange={setLocationCode} />
        </CardContent>
      </Card>

      {error && <Alert variant="destructive">{error}</Alert>}
      <Button type="submit" size="xl" disabled={busy || !ready}>
        {busy ? <><Spinner className="text-primary-foreground" /> {t("Enregistrement…")}</> : <><Layers /> {t("Enregistrer le lot")}</>}
      </Button>
    </form>
  );
}
