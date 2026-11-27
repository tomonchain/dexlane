"use client";

import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BackLink, EmptyState, Loading, Page, PageHeader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { dateFormat } from "@/lib/format";
import { t, tn } from "@/lib/i18n";

interface Entry { id: string; email: string; plan: string | null; signupCode: string | null; volume: string | null; createdAt: string }

const VOLUME: Record<string, string> = { lt50: "Moins de 50", "50-200": "50 à 200", "200-1000": "200 à 1 000", gt1000: "Plus de 1 000" };
const day = () => dateFormat({ day: "numeric", month: "short", year: "numeric" });

/** La liste d'attente des inscriptions, pour les administrateurs de l'installation (#103). */
export default function WaitlistPage() {
  const [data, setData] = useState<{ mode: string; entries: Entry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.raw<{ mode: string; entries: Entry[] }>("GET", "/admin/waitlist").then(setData).catch((e: Error) => setError(e.message));
  }, []);

  const copy = () => {
    if (!data) return;
    void navigator.clipboard.writeText(data.entries.map((e) => e.email).join("\n")).then(() => toast.success(t("Adresses copiées")));
  };

  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader back={<BackLink href="/settings">{t("Réglages")}</BackLink>} title={t("Liste d'attente")}
        description={data?.mode === "open"
          ? t("Les inscriptions sont ouvertes (DEXLANE_SIGNUP=open) : la liste d'attente ne se remplit plus.")
          : t("Les inscriptions sont fermées tant que les e-mails et le paiement ne sont pas branchés. Pour les ouvrir : DEXLANE_SIGNUP=open.")}
        actions={data && data.entries.length > 0 && <Button variant="outline" size="sm" onClick={copy}><Copy /> {t("Copier les adresses")}</Button>} />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!data && !error && <Loading />}
      {data?.entries.length === 0 && <EmptyState title={t("Personne pour l'instant")} />}
      {data && data.entries.length > 0 && (
        <>
          <p className="px-1 text-sm text-muted-foreground">{tn(data.entries.length, "{n} vendeur en attente", "{n} vendeurs en attente")}</p>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card text-sm" data-testid="waitlist">
            {data.entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="font-medium break-all">{e.email}</span>
                <span className="text-xs text-muted-foreground">
                  {[e.plan && t("forfait {plan}", { plan: e.plan }), e.signupCode && t("code {code}", { code: e.signupCode }), e.volume && (VOLUME[e.volume] ? t(VOLUME[e.volume]!) : e.volume), day().format(new Date(e.createdAt))].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}
