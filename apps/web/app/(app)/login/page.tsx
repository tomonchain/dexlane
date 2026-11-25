"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Logo } from "@/components/app-shell";
import { LocaleSwitch } from "@/components/locale-switch";
import { PasswordInput } from "@/components/password-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Loading, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { authMessage } from "@/lib/auth-messages";
import { t } from "@/lib/i18n";

type Mode = "loading" | "login" | "setup" | "reset";

const COPY: Record<Exclude<Mode, "loading">, { title: string; description: string; submit: string }> = {
  login: { title: "Connexion", description: "Saisissez votre mot de passe.", submit: "Se connecter" },
  setup: {
    title: "Première connexion",
    description: "Choisissez votre mot de passe. Le jeton d'installation (DEXLANE_API_TOKEN) prouve que vous administrez le serveur ; il ne sera plus demandé ensuite.",
    submit: "Créer le mot de passe",
  },
  reset: {
    title: "Mot de passe oublié",
    description: "Le jeton d'installation (DEXLANE_API_TOKEN) permet d'en définir un nouveau. Les autres appareils seront déconnectés.",
    submit: "Définir le nouveau mot de passe",
  },
};

function enter() {
  const next = new URLSearchParams(window.location.search).get("next");
  // Redirection interne uniquement : jamais vers une URL fournie de l'extérieur.
  window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("loading");
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
      await (mode === "login" ? api.login(password) : api.setPassword(token, password));
      enter();
    } catch (err) {
      setError(authMessage(err));
      setBusy(false);
    }
  }

  const choosing = mode === "setup" || mode === "reset";
  const ready = mode === "login" ? password !== "" : token.trim() !== "" && password !== "" && confirm !== "";

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-[28rem] max-w-3xl rounded-full bg-primary/15 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo className="scale-110" />
        </div>
        {mode === "loading" ? (
          <div className="flex justify-center rounded-2xl border bg-card p-8 shadow-xl shadow-black/5"><Loading /></div>
        ) : (
          <form onSubmit={submit} className="grid gap-5 rounded-2xl border bg-card p-6 shadow-xl shadow-black/5">
            <div className="grid gap-1.5">
              <h1 className="text-xl font-semibold tracking-tight">{t(COPY[mode].title)}</h1>
              <p className="text-sm text-muted-foreground">{t(COPY[mode].description)}</p>
            </div>
            {choosing && (
              <Field label={t("Jeton d'installation")}>
                <PasswordInput value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" className="font-mono" required autoFocus />
              </Field>
            )}
            <Field label={choosing ? t("Nouveau mot de passe") : t("Mot de passe")} hint={choosing ? t("10 caractères minimum.") : undefined}>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={choosing ? "new-password" : "current-password"}
                minLength={choosing ? 10 : undefined}
                required
                autoFocus={!choosing}
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
              <Button variant="link" size="sm" onClick={() => switchTo("reset")} className="justify-self-center text-muted-foreground">{t("Mot de passe oublié ?")}</Button>
            )}
            {mode === "reset" && (
              <Button variant="link" size="sm" onClick={() => switchTo("login")} className="justify-self-center text-muted-foreground">{t("Retour à la connexion")}</Button>
            )}
          </form>
        )}
        <p className="mt-6 text-center text-xs text-muted-foreground">{t("Stock et négoce de cartes Pokémon")}</p>
        <div className="mt-3 flex justify-center">
          <LocaleSwitch />
        </div>
      </div>
    </div>
  );
}
