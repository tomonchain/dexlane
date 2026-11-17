"use client";

import { ArrowRight, Eye, EyeOff, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Logo } from "@/components/app-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { ApiError, api } from "@/lib/api";

export default function LoginPage() {
  const [token, setToken] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(token);
      const next = new URLSearchParams(window.location.search).get("next");
      // Redirection interne uniquement : jamais vers une URL fournie de l'extérieur.
      window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (err) {
      const e = err as ApiError;
      setError(
        e.code === "UNAUTHORIZED" ? "Jeton refusé."
        : e.code === "API_UNREACHABLE" ? "L'API dexlane ne répond pas. Vérifiez qu'elle est démarrée."
        : e.message,
      );
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-[28rem] max-w-3xl rounded-full bg-primary/15 blur-3xl"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo className="scale-110" />
        </div>
        <form onSubmit={submit} className="grid gap-5 rounded-2xl border bg-card p-6 shadow-xl shadow-black/5">
          <div className="grid gap-1.5">
            <h1 className="text-xl font-semibold tracking-tight">Connexion</h1>
            <p className="text-sm text-muted-foreground">
              Saisissez le jeton propriétaire. Il reste dans un cookie de session sur cet appareil.
            </p>
          </div>
          <Field label="Jeton">
            <span className="relative block">
              <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="px-9 font-mono"
                required
                autoFocus
              />
              <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? "Masquer le jeton" : "Afficher le jeton"}
                className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
            </span>
          </Field>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button type="submit" size="lg" disabled={busy || !token.trim()}>
            {busy ? <><Spinner className="text-primary-foreground" /> Vérification…</> : <>Se connecter <ArrowRight /></>}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-muted-foreground">Stock et négoce de cartes Pokémon</p>
      </div>
    </div>
  );
}
