"use client";

import { useState, type FormEvent } from "react";
import { ApiError, api } from "@/lib/api";

export default function LoginPage() {
  const [token, setToken] = useState("");
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
    <form className="card stack" onSubmit={submit} style={{ marginTop: "12vh" }}>
      <div className="stack-sm">
        <h1>Connexion</h1>
        <p className="muted">Saisissez le jeton propriétaire (<span className="mono">DEXLANE_API_TOKEN</span>). Il est conservé dans un cookie de session sur cet appareil.</p>
      </div>
      <label className="field">
        <span>Jeton</span>
        <input className="input" type="password" autoComplete="current-password" value={token} onChange={(e) => setToken(e.target.value)} required autoFocus />
      </label>
      {error && <p className="banner error" role="alert">{error}</p>}
      <button className="btn primary block" disabled={busy || !token.trim()}>{busy ? "Vérification…" : "Se connecter"}</button>
    </form>
  );
}
