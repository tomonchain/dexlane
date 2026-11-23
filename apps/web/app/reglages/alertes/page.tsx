"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertRules } from "@/components/alert-rules";
import { Alert } from "@/components/ui/alert";
import { BackLink, Loading, Page, PageHeader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { AlertSettings } from "@/lib/types";

/** Alertes de prix : quand une variation de cote mérite d'être signalée (stock et cartes suivies). */
export default function AlertSettingsPage() {
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    api.priceMoves(true).then((r) => setSettings(r.settings)).catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader
        back={<BackLink href="/reglages">{t("Réglages")}</BackLink>}
        title={t("Alertes de prix")}
        description={t("Quand la cote d'une carte bouge assez pour mériter votre attention : sur l'accueil, dans les statistiques et sur les cartes suivies des achats.")}
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!settings ? !error && <Loading /> : <AlertRules key={JSON.stringify(settings)} settings={settings} onSaved={load} />}
      <p className="text-sm text-muted-foreground">
        {t("Les cartes concernées sont listées dans")} <Link href="/statistiques?vue=cotes" className="font-medium text-foreground underline underline-offset-2">{t("Statistiques › Stock et cotes")}</Link>.
      </p>
    </Page>
  );
}
