"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProgressDetails } from "@/components/insights/progress";
import { Alert } from "@/components/ui/alert";
import { BackLink, EmptyState, Loading, Page, PageHeader } from "@/components/ui/misc";
import { insights, type ProgressView } from "@/lib/insights";
import { t } from "@/lib/i18n";

/** Progression du compte (#86) : niveau, succès, avantages. Privée : pas de profil public, pas de classement. */
export default function ProgressPage() {
  const [view, setView] = useState<ProgressView | { hidden: true } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    insights.progress().then(setView).catch((e: Error) => setError(e.message));
    // Ouvrir la page, c'est avoir vu ce qui s'est débloqué : plus de notification pour ces succès.
    insights.seen({ achievements: true, retroMessage: true }).catch(() => undefined);
  }, []);

  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader back={<BackLink href="/account">{t("Compte")}</BackLink>} title={t("Progression")}
        description={t("Le niveau de la boutique et les succès obtenus. Visibles par toi seul : pas de profil public, pas de classement.")} />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!view && !error && <Loading />}
      {view?.hidden && (
        <EmptyState title={t("Niveau et succès masqués")}>
          {t("Tu as choisi de ne pas les afficher.")} <Link href="/account" className="font-medium text-foreground underline underline-offset-2">{t("Les réafficher dans Compte")}</Link>
        </EmptyState>
      )}
      {view && !view.hidden && <ProgressDetails view={view} />}
    </Page>
  );
}
