"use client";

import { Check } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ListSkeleton } from "@/components/skeletons";
import { SaveBar } from "@/components/ui/action-bar";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { BackLink, Page, PageHeader, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { formatEuros, parseEuros } from "@/lib/format";
import { t } from "@/lib/i18n";
import { eurosInput } from "@/lib/pricing";
import { SHIPPING_LABEL } from "@/lib/sales";
import type { ShippingCosts } from "@/lib/types";

type PostalMode = keyof ShippingCosts["postage"];
const POSTAL: PostalMode[] = ["LETTER_UNTRACKED", "LETTER_TRACKED", "PARCEL_TRACKED"];
const SUPPLIES: [keyof ShippingCosts["supplies"], string, string][] = [
  ["sleeveCents", "Sleeve (€)", "Par carte"],
  ["toploaderCents", "Top-loader (€)", "Par carte"],
  ["envelopeCents", "Enveloppe (€)", "Par envoi postal"],
];

/** Frais d'envoi : ce qu'un envoi coûte, pour que la marge soit la vraie. */
export default function ShippingCostsPage() {
  type Form = { postage: Record<PostalMode, string>; supplies: Record<keyof ShippingCosts["supplies"], string> };
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.shippingCosts()
      .then((c) => {
        const loaded: Form = {
          postage: Object.fromEntries(POSTAL.map((m) => [m, c.postage[m] === null ? "" : eurosInput(c.postage[m]!)])) as Record<PostalMode, string>,
          supplies: Object.fromEntries(SUPPLIES.map(([k]) => [k, eurosInput(c.supplies[k])])) as Record<keyof ShippingCosts["supplies"], string>,
        };
        setForm(loaded);
        setSaved(loaded);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const parsed = form && {
    postage: Object.fromEntries(POSTAL.map((m) => [m, form.postage[m].trim() === "" ? null : parseEuros(form.postage[m])])) as Record<PostalMode, number | null>,
    supplies: Object.fromEntries(SUPPLIES.map(([k]) => [k, parseEuros(form.supplies[k])])) as Record<keyof ShippingCosts["supplies"], number | null>,
  };
  const invalid = (raw: string, value: number | null) => raw.trim() !== "" && value === null;
  const valid = parsed !== null && POSTAL.every((m) => !invalid(form!.postage[m], parsed.postage[m])) && SUPPLIES.every(([k]) => parsed.supplies[k] !== null);
  const perCard = parsed && (parsed.supplies.sleeveCents ?? 0) + (parsed.supplies.toploaderCents ?? 0);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!parsed || !valid) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveShippingCosts({ postage: parsed.postage, supplies: parsed.supplies as ShippingCosts["supplies"] });
      toast.success(t("Frais d'envoi enregistrés"));
      setSaved(form);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader
        back={<BackLink href="/reglages">{t("Réglages")}</BackLink>}
        title={t("Frais d'envoi")}
        description={t("Ce qu'un envoi vous coûte. La marge d'une vente déduit l'affranchissement et les fournitures ; ils sont figés à la remise, changer ces tarifs ne réécrit pas les ventes passées.")}
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!form ? !error && <ListSkeleton count={3} label={t("Chargement des frais d'envoi")} /> : (
        <form onSubmit={save} className="grid gap-4">
          <Card>
            <CardContent className="grid gap-4">
              <div className="grid gap-1">
                <CardTitle>{t("Affranchissement habituel")}</CardTitle>
                <CardDescription>{t("Prérempli à la remise, modifiable vente par vente. Laissez vide un mode que vous n'utilisez pas.")}</CardDescription>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {POSTAL.map((m) => (
                  <Field key={m} label={t("{mode} (€)", { mode: t(SHIPPING_LABEL[m]) })}>
                    <Input inputMode="decimal" value={form.postage[m]} placeholder="—" aria-invalid={invalid(form.postage[m], parsed!.postage[m])}
                      onChange={(e) => setForm({ ...form, postage: { ...form.postage, [m]: e.target.value } })} className="tabular" />
                  </Field>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="grid gap-4">
              <div className="grid gap-1">
                <CardTitle>{t("Fournitures")}</CardTitle>
                <CardDescription>{t("Sleeve et top-loader pour chaque carte vendue, une enveloppe par envoi postal (pas pour une remise en main propre).")}</CardDescription>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {SUPPLIES.map(([k, label, hint]) => (
                  <Field key={k} label={t(label)} hint={t(hint)}>
                    <Input inputMode="decimal" value={form.supplies[k]} aria-invalid={parsed!.supplies[k] === null}
                      onChange={(e) => setForm({ ...form, supplies: { ...form.supplies, [k]: e.target.value } })} className="tabular" />
                  </Field>
                ))}
              </div>
              {perCard !== null && <p className="text-xs text-muted-foreground" data-testid="supplies-per-card">{t("Soit {amount} de fournitures par carte, plus l'enveloppe par envoi.", { amount: formatEuros(perCard) })}</p>}
            </CardContent>
          </Card>
          {JSON.stringify(form) !== JSON.stringify(saved) && (
            <SaveBar submit message={t("Frais d'envoi modifiés")} saveLabel={t("Enregistrer les frais")} saving={saving} disabled={!valid} onDiscard={() => setForm(saved)} />
          )}
        </form>
      )}
    </Page>
  );
}
