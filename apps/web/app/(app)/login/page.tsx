"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { AuthLayout } from "@/components/marketing/auth-layout";
import { LocaleSwitch } from "@/components/locale-switch";
import { PasswordInput } from "@/components/password-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Loading, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { SIGNUP_OPEN } from "@/config/site";
import { authMessage } from "@/lib/auth-messages";
import { clearCache } from "@/lib/cache";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Mode = "loading" | "login" | "reset";

const LINK = "text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:underline";

const COPY: Record<Exclude<Mode, "loading">, { title: string; description: string; submit: string }> = {
  login: { title: "Connexion", description: "Saisis ton adresse e-mail et ton mot de passe.", submit: "Se connecter" },
  reset: {
    title: "Compte d'installation",
    description: "Le jeton d'installation (DEXLANE_API_TOKEN) permet de choisir l'adresse e-mail et le mot de passe du propriétaire de l'installation. Ses autres appareils seront déconnectés.",
    submit: "Définir le nouveau mot de passe",
  },
};

function enter() {
  // Les données gardées sur l'appareil sont celles du compte précédent : elles ne doivent pas s'afficher dans celui-ci.
  clearCache();
  const next = new URLSearchParams(window.location.search).get("next");
  // Redirection interne uniquement : jamais vers une URL fournie de l'extérieur.
  window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authStatus()
      .then((s) => {
        // Aucun compte encore : l'assistant de démarrage s'en charge.
        if (!s.passwordSet) window.location.replace("/welcome");
        else setMode("login");
      })
      .catch((e) => {
        setError(authMessage(e));
        setMode("login");
      });
  }, []);

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
    setPassword("");
    setConfirm("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode !== "login" && password !== confirm) {
      setError(t("Les deux mots de passe ne correspondent pas."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await (mode === "login" ? api.login(email.trim(), password) : api.setupOwner(token, email.trim(), password));
      enter();
    } catch (err) {
      setError(authMessage(err));
      setBusy(false);
    }
  }

  const choosing = mode === "reset";
  const ready = email.trim() !== "" && (mode === "login" ? password !== "" : token.trim() !== "" && password !== "" && confirm !== "");

  return (
    <AuthLayout tagline={t("Du classeur à l'annonce eBay, en quelques secondes.")} footer={<LocaleSwitch />}>
        {mode === "loading" ? (
          <div className="flex justify-center py-10"><Loading /></div>
        ) : (
          <form onSubmit={submit} className="grid gap-5">
            <div className="mb-2 grid gap-2.5">
              <h1 className="text-[2rem] leading-[1.06] font-[450] tracking-[-0.035em] text-balance sm:text-[2.25rem]">{t(COPY[mode].title)}</h1>
              <p className="text-[15px] leading-relaxed text-muted-foreground">{t(COPY[mode].description)}</p>
            </div>
            {choosing && (
              <Field label={t("Jeton d'installation")}>
                <PasswordInput value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" className="font-mono" required autoFocus />
              </Field>
            )}
            <Field label={t("Adresse e-mail")}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required autoFocus={!choosing} />
            </Field>
            <Field label={choosing ? t("Nouveau mot de passe") : t("Mot de passe")} hint={choosing ? t("10 caractères minimum.") : undefined}>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={choosing ? "new-password" : "current-password"}
                minLength={choosing ? 10 : undefined}
                required
              />
            </Field>
            {choosing && (
              <Field label={t("Confirmer le mot de passe")}>
                <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
              </Field>
            )}
            {error && <Alert variant="destructive">{error}</Alert>}
            <Button type="submit" size="lg" disabled={busy || !ready}>
              {busy ? <><Spinner className="text-primary-foreground" /> {t("Vérification…")}</> : <>{t(COPY[mode].submit)} <ArrowRight /></>}
            </Button>
            {mode === "login" && (
              <div className="grid gap-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <Link href="/forgot-password" className={LINK}>{t("Mot de passe oublié ?")}</Link>
                  <Link href="/signup" className={cn(LINK, "font-medium text-foreground")}>{SIGNUP_OPEN ? t("Créer un compte") : t("Rejoindre la liste d'attente")}</Link>
                </div>
                <button type="button" onClick={() => switchTo("reset")} className={cn(LINK, "justify-self-start border-t pt-4 text-[13px]")}>
                  {t("Réinitialiser avec le jeton d'installation")}
                </button>
              </div>
            )}
            {mode === "reset" && (
              <button type="button" onClick={() => switchTo("login")} className={cn(LINK, "justify-self-start text-sm")}>{t("Retour à la connexion")}</button>
            )}
          </form>
        )}
    </AuthLayout>
  );
}
