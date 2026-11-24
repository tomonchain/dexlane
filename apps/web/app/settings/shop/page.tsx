"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { SaveBar } from "@/components/ui/action-bar";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { BackLink, Loading, Page, PageHeader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { reviewMessage } from "@/lib/sales";
import type { AppSettings } from "@/lib/types";

type Form = Pick<AppSettings, "seller" | "slipPaper" | "reviewMessage">;
const PAPERS: { value: AppSettings["slipPaper"]; label: string }[] = [
  { value: "ROLL_80", label: "Rouleau thermique 80 mm" },
  { value: "ROLL_58", label: "Rouleau thermique 58 mm" },
  { value: "LABEL_100X150", label: "Étiquette 100 × 150 mm" },
  { value: "A4", label: "Feuille A4" },
];

/** Boutique et documents : ce qui s'imprime sur les bons de livraison et les reçus, et sur quel papier. */
export default function ShopSettingsPage() {
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.appSettings()
      .then((s) => {
        const f = { seller: s.seller, slipPaper: s.slipPaper, reviewMessage: s.reviewMessage ?? "" };
        setSaved(f);
        setForm(f);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const s = await api.saveAppSettings({ seller: form.seller, slipPaper: form.slipPaper, reviewMessage: form.reviewMessage });
      const f = { seller: s.seller, slipPaper: s.slipPaper, reviewMessage: s.reviewMessage ?? "" };
      setSaved(f);
      setForm(f);
      toast.success(t("Boutique enregistrée"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const seller = (key: keyof Form["seller"], value: string) => form && setForm({ ...form, seller: { ...form.seller, [key]: value } });
  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader
        back={<BackLink href="/settings">{t("Réglages")}</BackLink>}
        title={t("Boutique et documents")}
        description={t("En tête des bons de livraison et des reçus imprimés chaque jour, et le format de votre imprimante.")}
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!form ? !error && <Loading /> : (
        <form onSubmit={save} className="grid gap-4">
          <Card>
            <CardContent className="grid gap-4">
              <div className="grid gap-1">
                <CardTitle>{t("Votre boutique")}</CardTitle>
                <CardDescription>{t("Imprimé en haut de chaque bon de livraison et de chaque reçu.")}</CardDescription>
              </div>
              <Field label={t("Nom de la boutique")}>
                <Input value={form.seller.name} onChange={(e) => seller("name", e.target.value)} maxLength={80} placeholder={t("Ma boutique de cartes")} />
              </Field>
              <Field label={t("Adresse")} hint={t("Une ligne par élément : rue, code postal et ville, pays.")}>
                <Textarea value={form.seller.address} onChange={(e) => seller("address", e.target.value)} maxLength={300} className="min-h-20" />
              </Field>
              <Field label={t("Mention du reçu")} hint={t("SIRET, régime de TVA… Imprimée en bas de chaque reçu.")}>
                <Textarea value={form.seller.legal} onChange={(e) => seller("legal", e.target.value)} maxLength={300} className="min-h-16" placeholder={t("SIRET 000 000 000 00000 · TVA non applicable, art. 293 B du CGI")} />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="grid gap-4">
              <div className="grid gap-1">
                <CardTitle>{t("Imprimante")}</CardTitle>
                <CardDescription>{t("Le papier des bons et des reçus ; modifiable aussi au moment d'imprimer.")}</CardDescription>
              </div>
              <Field label={t("Papier")}>
                <Select value={form.slipPaper} onChange={(e) => setForm({ ...form, slipPaper: e.target.value as Form["slipPaper"] })}>
                  {PAPERS.map((p) => <option key={p.value} value={p.value}>{t(p.label)}</option>)}
                </Select>
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="grid gap-4">
              <div className="grid gap-1">
                <CardTitle>{t("Demande d'avis")}</CardTitle>
                <CardDescription>{t("Proposé dans chaque vente 24 h après la livraison, à copier dans la messagerie du canal ou un e-mail. {acheteur} et {boutique} sont remplacés.")}</CardDescription>
              </div>
              <Field label={t("Message")} hint={t("Laissez vide pour le message par défaut.")}>
                <Textarea value={form.reviewMessage} onChange={(e) => setForm({ ...form, reviewMessage: e.target.value })} maxLength={1000} className="min-h-32"
                  placeholder={reviewMessage("", "{acheteur}", "{boutique}")} data-testid="review-template" />
              </Field>
            </CardContent>
          </Card>
          {JSON.stringify(form) !== JSON.stringify(saved) && (
            <SaveBar submit message={t("Boutique modifiée")} saveLabel={t("Enregistrer")} saving={saving} onDiscard={() => setForm(saved)} />
          )}
        </form>
      )}
    </Page>
  );
}
