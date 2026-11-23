"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { parseEuros } from "@/lib/format";
import { t } from "@/lib/i18n";
import { eurosInput } from "@/lib/pricing";
import type { AlertSettings } from "@/lib/types";

/** Seuils des alertes de cote : sur combien de jours comparer, à partir de quel pourcentage et de quel montant. */
export function AlertRules({ settings, onSaved }: { settings: AlertSettings; onSaved: () => void }) {
  const [windowDays, setWindowDays] = useState(String(settings.windowDays));
  const [threshold, setThreshold] = useState(String(settings.percent));
  const [minimum, setMinimum] = useState(eurosInput(settings.minChangeCents));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next: AlertSettings | null = (() => {
    const days = Number(windowDays), pct = Number(threshold.replace(",", ".")), min = parseEuros(minimum);
    return Number.isInteger(days) && days >= 1 && days <= 90 && pct >= 1 && pct <= 500 && min !== null ? { windowDays: days, percent: pct, minChangeCents: min } : null;
  })();
  const dirty = !next || next.windowDays !== settings.windowDays || next.percent !== settings.percent || next.minChangeCents !== settings.minChangeCents;

  async function save() {
    if (!next) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveAlertSettings(next);
      toast.success(t("Seuils d'alerte enregistrés"));
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[repeat(3,minmax(0,10rem))_auto]">
          <Field label={t("Comparer sur (jours)")}><Input inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} className="tabular" /></Field>
          <Field label={t("Alerter à partir de (%)")}><Input inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="tabular" /></Field>
          <Field label={t("Variation minimale (€)")}><Input inputMode="decimal" value={minimum} onChange={(e) => setMinimum(e.target.value)} className="tabular" /></Field>
          <Button variant="outline" onClick={save} disabled={saving || !dirty || !next} className="col-span-2 justify-self-start sm:col-span-1">
            {saving ? <Spinner /> : <Check />} {t("Enregistrer les seuils")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("Une carte est signalée quand sa cote a bougé d'au moins ce pourcentage")} <em>{t("et")}</em> {t("de ce montant sur la période. De 1 à 90 jours, de 1 à 500 %.")}
        </p>
        {error && <Alert variant="destructive">{error}</Alert>}
      </CardContent>
    </Card>
  );
}
