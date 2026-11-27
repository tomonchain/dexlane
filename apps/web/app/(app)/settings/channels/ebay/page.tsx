"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ebayMessage } from "@/components/ebay-setup";
import { Alert } from "@/components/ui/alert";
import { BackLink, Loading, Page, PageHeader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";

/**
 * Retour de l'autorisation eBay (adresse d'acceptation et de refus du RuName) : eBay renvoie ici avec un code à usage
 * unique, valable cinq minutes, qu'on échange aussitôt contre les jetons du compte.
 */
export default function EbayConsentReturnPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setError(params.get("error") === "access_denied" || !code
        ? t("L'autorisation a été refusée sur eBay : le compte n'est pas connecté.")
        : t("Retour d'eBay incomplet : recommence la connexion."));
      return;
    }
    api.ebayCompleteConsent({ state, code })
      .then((c) => {
        toast.success(c.account?.username ? t("Compte eBay connecté : {name}", { name: c.account.username }) : t("Compte eBay connecté"));
        router.replace("/settings/channels");
      })
      .catch((e: unknown) => setError(ebayMessage(e)));
  }, [router]);

  return (
    <Page className="mx-auto w-full max-w-2xl">
      <PageHeader back={<BackLink href="/settings/channels">{t("Canaux de vente")}</BackLink>} title={t("Connexion à eBay")} />
      {error ? (
        <div className="grid gap-3">
          <Alert variant="destructive">{error}</Alert>
          <Link href="/settings/channels" className="text-sm font-medium text-primary underline-offset-2 hover:underline">{t("Revenir aux canaux de vente")}</Link>
        </div>
      ) : <Loading>{t("Connexion du compte eBay…")}</Loading>}
    </Page>
  );
}
