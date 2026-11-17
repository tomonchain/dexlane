"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { cardImage } from "@/lib/format";
import type { Candidate } from "@/lib/types";

export function CardThumb({ imageUrl, large }: { imageUrl: string | null; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  const src = cardImage(imageUrl);
  const className = large ? "thumb lg" : "thumb";
  if (!src || broken) return <div className={`${className} placeholder`} aria-hidden="true">?</div>;
  return <img className={className} src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

/** Liste de cartes du catalogue ; une seule sélectionnable. */
export function CandidateList({ candidates, selectedId, onSelect }: {
  candidates: Candidate[];
  selectedId: string | null;
  onSelect: (c: Candidate) => void;
}) {
  return (
    <div className="list" role="radiogroup" aria-label="Cartes proposées">
      {candidates.map((c) => (
        <button
          key={c.catalogCardId}
          type="button"
          role="radio"
          aria-checked={c.catalogCardId === selectedId}
          className="choice"
          onClick={() => onSelect(c)}
        >
          <CardThumb imageUrl={c.imageUrl} />
          <span className="grow">
            <strong>{c.name}</strong>
            <span className="muted small" style={{ display: "block" }}>
              {c.setName ?? c.setId} · n° {c.localNumber}{c.rarity ? ` · ${c.rarity}` : ""}
            </span>
          </span>
          <span className="score" title="Score de correspondance">{Math.round(c.score * 100)} %</span>
        </button>
      ))}
    </div>
  );
}

/** Recherche manuelle dans le catalogue : nom, numéro ou série. */
export function ManualSearch({ language, initial, onResults }: {
  language: string;
  initial?: { name?: string; number?: string };
  onResults: (candidates: Candidate[]) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [number, setNumber] = useState(initial?.number ?? "");
  const [set, setSet] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { candidates } = await api.searchCatalog({ language, name: name.trim(), number: number.trim(), set: set.trim() });
      onResults(candidates);
      if (candidates.length === 0) setMessage("Aucune carte trouvée. Vérifiez la langue et la série, ou synchronisez la série dans le catalogue.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const empty = !name.trim() && !number.trim() && !set.trim();
  return (
    <form className="stack-sm" onSubmit={search}>
      <label className="field">
        <span>Nom</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoCorrect="off" enterKeyHint="search" />
      </label>
      <div className="grid-2">
        <label className="field">
          <span>Numéro</span>
          <input className="input" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="136/189" autoCorrect="off" enterKeyHint="search" />
        </label>
        <label className="field">
          <span>Série (identifiant)</span>
          <input className="input" value={set} onChange={(e) => setSet(e.target.value)} placeholder="swsh3" autoCapitalize="none" autoCorrect="off" enterKeyHint="search" />
        </label>
      </div>
      <button className="btn" disabled={busy || empty}>{busy ? "Recherche…" : "Rechercher dans le catalogue"}</button>
      {message && <p className="banner warn" role="status">{message}</p>}
    </form>
  );
}
