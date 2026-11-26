"use client";

import { ArrowRight, Users } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Loading, Page, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { clearCache } from "@/lib/cache";
import { t } from "@/lib/i18n";

/**
 * Lien d'invitation reçu par e-mail. Sans session, l'application renvoie d'abord vers la connexion (puis ici) ; on
 * vérifie que l'adresse de la session est celle de l'invitation avant de rejoindre le compte.
 */
export default function JoinPage() {
  return (
    <Suspense>
      <Join />
    </Suspense>
  );
}

function Join() {
  const token = useSearchParams().get("token") ?? "";
  const [preview, setPreview] = useState<{ email: string; invitedBy: string; matches: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return setError(t("Ce lien d'invitation est incomplet."));
    api.previewInvitation(token).then(setPreview).catch((e: Error) => setError(e.message));
  }, [token]);

  async function accept() {
    setBusy(true);
    try {
      await api.acceptInvitation(token);
      // Les données gardées sur l'appareil sont celles de l'ancien compte.
      clearCache();
      window.location.assign("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Page width="narrow" className="mx-auto w-full max-w-md pt-10">
      <Card>
        <CardContent className="grid gap-4">
          <Users className="size-8 text-brand" aria-hidden />
          <CardTitle>{t("Rejoindre une équipe")}</CardTitle>
          {error ? (
            <>
              <Alert variant="destructive">{error}</Alert>
              <Link href="/" className="text-sm font-medium underline underline-offset-2">{t("Retour à l'accueil")}</Link>
            </>
          ) : !preview ? <Loading /> : (
            <>
              <CardDescription>
                {t("{inviter} vous invite à rejoindre son compte Dexlane : son stock, ses annonces et ses ventes.", { inviter: preview.invitedBy })}
              </CardDescription>
              {preview.matches ? (
                <>
                  <p className="text-[13px] text-muted-foreground">{t("Les cartes de votre compte actuel ne vous suivront pas : vous travaillerez sur celles de l'équipe.")}</p>
                  <Button onClick={accept} disabled={busy} data-testid="join-accept">{busy ? <Spinner className="text-primary-foreground" /> : null} {t("Rejoindre le compte")} {!busy && <ArrowRight />}</Button>
                </>
              ) : (
                <Alert variant="warning">{t("Cette invitation est pour {email}. Déconnectez-vous, puis connectez-vous ou créez un compte avec cette adresse.", { email: preview.email })}</Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
