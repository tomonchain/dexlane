"use client";

import { LogOut, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PasswordInput } from "@/components/password-input";
import { ThemeSwitch } from "@/components/theme";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/input";
import { BackLink, Page, PageHeader, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { authMessage } from "@/lib/auth-messages";

export default function AccountPage() {
  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader back={<BackLink href="/reglages">Réglages</BackLink>} title="Compte" description="Accès à l'application et préférences de cet appareil." />
      <ChangePassword />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="grid gap-1">
            <CardTitle>Apparence</CardTitle>
            <CardDescription>Thème clair, sombre, ou celui du système. Propre à cet appareil.</CardDescription>
          </div>
          <ThemeSwitch />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="grid gap-1">
            <CardTitle>Session</CardTitle>
            <CardDescription>Une session dure 30 jours sur cet appareil. Changer le mot de passe ferme toutes les autres.</CardDescription>
          </div>
          <Button variant="destructive" onClick={() => void api.logout().then(() => window.location.assign("/login"))}>
            <LogOut /> Se déconnecter
          </Button>
        </CardContent>
      </Card>
    </Page>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      toast.success("Mot de passe modifié. Les autres appareils sont déconnectés.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-primary" aria-hidden><ShieldCheck className="size-5" /></span>
            <div className="grid gap-1">
              <CardTitle>Mot de passe</CardTitle>
              <CardDescription>
                Il protège l'accès à l'application. En cas d'oubli, le jeton d'installation (DEXLANE_API_TOKEN) permet d'en définir un nouveau depuis l'écran de connexion.
              </CardDescription>
            </div>
          </div>
          <Field label="Mot de passe actuel">
            <PasswordInput value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nouveau mot de passe" hint="10 caractères minimum.">
              <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required />
            </Field>
            <Field label="Confirmer le nouveau">
              <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </Field>
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button type="submit" disabled={busy || !current || !next || !confirm} className="justify-self-start">
            {busy && <Spinner className="text-primary-foreground" />} Changer le mot de passe
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
