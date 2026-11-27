"use client";

import { Crown, Mail, Send, Trash2, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { LockedFeature, hasFeature, useAccount } from "@/components/plan";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { BackLink, Loading, Page, PageHeader, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { TeamView } from "@/lib/types";

/** Réglages › Équipe : plusieurs personnes sur le même stock (forfait Boutique). */
export default function TeamPage() {
  const { account } = useAccount();
  const [team, setTeam] = useState<TeamView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api.team().then(setTeam).catch((e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  async function run(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await action();
      toast.success(done);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function invite(e: FormEvent) {
    e.preventDefault();
    const to = email.trim();
    void run("invite", async () => {
      await api.invite(to);
      setEmail("");
    }, t("Invitation envoyée à {email}", { email: to }));
  }

  const allowed = hasFeature(account, "team");
  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader
        back={<BackLink href="/settings">Réglages</BackLink>}
        title={t("Équipe")}
        description={t("Invite les personnes qui travaillent avec toi : elles se connectent avec leur propre adresse et voient le même stock, les mêmes annonces et les mêmes ventes.")}
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!team || !account ? !error && <Loading /> : (
        <>
          <Card>
            <CardContent className="grid gap-3">
              <CardTitle>{t("Membres")}</CardTitle>
              <ul className="divide-y rounded-lg border" data-testid="team-members">
                {team.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                    {m.isOwner ? <Crown className="size-4 shrink-0 text-brand" aria-hidden /> : <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate text-sm font-medium">{m.email}{m.isYou && <span className="font-normal text-muted-foreground"> · {t("toi")}</span>}</span>
                      <span className="text-xs text-muted-foreground">{m.isOwner ? t("Propriétaire du compte") : t("Membre depuis le {date}", { date: formatDateTime(m.createdAt) })}</span>
                    </span>
                    {team.canManage && !m.isOwner && (
                      <Button
                        variant="ghost" size="sm" disabled={busy !== null} aria-label={t("Retirer {email}", { email: m.email })}
                        onClick={() => window.confirm(t("Retirer {email} de l'équipe ? Ses sessions seront fermées ; il gardera son identifiant, sur un compte vide.", { email: m.email }))
                          && void run(m.id, () => api.removeMember(m.id), t("{email} ne fait plus partie de l'équipe", { email: m.email }))}
                      >
                        {busy === m.id ? <Spinner /> : <Trash2 />} <span className="max-sm:sr-only">{t("Retirer")}</span>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-4">
              <CardTitle>{t("Inviter quelqu'un")}</CardTitle>
              {!allowed ? (
                <LockedFeature feature="team" account={account}>{t("Le forfait Boutique permet de travailler à plusieurs sur le même compte.")}</LockedFeature>
              ) : !team.canManage ? (
                <CardDescription>{t("Seul le propriétaire du compte invite et retire des membres.")}</CardDescription>
              ) : (
                <>
                  <CardDescription>{t("Un lien valable 7 jours part par e-mail. La personne crée son compte (ou se connecte) avec cette adresse, puis rejoint le vôtre.")}</CardDescription>
                  <form className="flex flex-wrap items-end gap-2" onSubmit={invite}>
                    <Field label={t("Adresse e-mail")} className="min-w-56 flex-1">
                      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" data-testid="invite-email" />
                    </Field>
                    <Button type="submit" disabled={!email.trim() || busy !== null}>{busy === "invite" ? <Spinner /> : <Send />} {t("Inviter")}</Button>
                  </form>
                </>
              )}
              {team.invitations.length > 0 && (
                <ul className="divide-y rounded-lg border" data-testid="team-invitations">
                  {team.invitations.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                      <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate text-sm">{i.email}</span>
                        <span className="text-xs text-muted-foreground">{t("Invitation valable jusqu'au {date}", { date: formatDateTime(i.expiresAt) })}</span>
                      </span>
                      <Badge variant="outline">{t("en attente")}</Badge>
                      {team.canManage && (
                        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => run(i.id, () => api.revokeInvitation(i.id), t("Invitation annulée"))}>
                          {t("Annuler")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </Page>
  );
}
