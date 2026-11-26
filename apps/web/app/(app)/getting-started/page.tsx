"use client";

import { useEffect, useState } from "react";
import { OnboardingChecklist, ProgressBar } from "@/components/insights/onboarding";
import { Alert } from "@/components/ui/alert";
import { SwitchRow } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { BackLink, Loading, Page, PageHeader } from "@/components/ui/misc";
import { insights, type OnboardingState } from "@/lib/insights";
import { t } from "@/lib/i18n";

/** Le parcours de démarrage, toujours accessible depuis le compte, même masqué de l'accueil. */
export default function GettingStartedPage() {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    insights.onboarding().then(setState).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader back={<BackLink href="/account">{t("Compte")}</BackLink>} title={t("Démarrage")}
        description={t("Sept étapes jusqu'à ta première vente. Elles se cochent toutes seules, d'après ce que tu fais dans Dexlane.")} />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!state && !error && <Loading />}
      {state && (
        <>
          <Card>
            <CardContent className="grid gap-3">
              <p className="text-sm font-semibold">{state.complete ? t("Ton compte est prêt") : t("Compte configuré à {x} %", { x: state.percent })}</p>
              <ProgressBar percent={state.percent} label={t("Compte configuré à {x} %", { x: state.percent })} />
            </CardContent>
          </Card>
          <OnboardingChecklist state={state} />
          {!state.complete && (
            <Card>
              <CardContent>
                <SwitchRow
                  label={t("Afficher sur l'accueil")}
                  description={t("Le bloc « Compte configuré à x % » en haut de l'accueil.")}
                  checked={!state.hidden}
                  onCheckedChange={(on) => {
                    setState({ ...state, hidden: !on });
                    insights.savePreferences({ onboardingHidden: !on }).catch((e: Error) => setError(e.message));
                  }}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}
