"use client";

import { LifeBuoy, Send, Zap } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { BackLink, Loading, Page, PageHeader, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SupportRequest } from "@/lib/types";

const STATUS: Record<SupportRequest["status"], string> = { OPEN: "en attente", ANSWERED: "répondu", CLOSED: "clos" };

/** Réglages › Support : une question, un bug, une idée. Sur le forfait Boutique, la demande passe en priorité. */
export default function SupportPage() {
  const [data, setData] = useState<{ requests: SupportRequest[]; priority: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.supportRequests().then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const sent = await api.contactSupport(subject.trim(), message.trim());
      toast.success(sent.priority ? t("Demande envoyée, en priorité") : t("Demande envoyée"));
      setSubject("");
      setMessage("");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader
        back={<BackLink href="/settings">Réglages</BackLink>}
        title={t("Support")}
        description={t("Une question, un bug, une idée ? C'est le fondateur qui répond, par e-mail à l'adresse de votre compte.")}
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!data ? !error && <Loading /> : (
        <>
          <Card>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{t("Écrire au support")}</CardTitle>
                {data.priority
                  ? <Badge variant="brand" data-testid="support-priority"><Zap /> {t("Support prioritaire")}</Badge>
                  : <Badge variant="outline">{t("Support standard")}</Badge>}
              </div>
              <CardDescription>
                {data.priority
                  ? t("Forfait Boutique : vos demandes arrivent marquées prioritaires et sont traitées en premier.")
                  : t("Réponse par e-mail dès que possible. Le forfait Boutique comprend le support prioritaire : ses demandes passent en premier.")}
              </CardDescription>
              <form className="grid gap-3" onSubmit={submit}>
                <Field label={t("Sujet")}>
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} minLength={3} maxLength={150} required data-testid="support-subject" />
                </Field>
                <Field label={t("Message")} hint={t("Ce que vous faisiez, ce qui s'est passé, et sur quelle carte ou quelle vente si besoin.")}>
                  <Textarea value={message} onChange={(e) => setMessage(e.target.value)} minLength={10} maxLength={5000} rows={6} required data-testid="support-message" />
                </Field>
                <Button type="submit" className="justify-self-start" disabled={busy || subject.trim().length < 3 || message.trim().length < 10}>
                  {busy ? <Spinner /> : <Send />} {t("Envoyer")}
                </Button>
              </form>
            </CardContent>
          </Card>
          {data.requests.length > 0 && (
            <Card>
              <CardContent className="grid gap-3">
                <CardTitle>{t("Vos demandes")}</CardTitle>
                <ul className="divide-y rounded-lg border">
                  {data.requests.map((r) => (
                    <li key={r.id} className="flex items-start gap-3 px-3 py-2.5">
                      <LifeBuoy className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate text-sm font-medium">{r.subject}</span>
                        <span className="line-clamp-2 text-[13px] text-muted-foreground">{r.message}</span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Badge variant={r.status === "OPEN" ? "warning" : "success"}>{t(STATUS[r.status])}</Badge>
                        {r.priority && <Badge variant="brand"><Zap /> {t("prioritaire")}</Badge>}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}
