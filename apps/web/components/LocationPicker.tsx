"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { Location } from "@/lib/types";
import { Sheet } from "./Sheet";

/** Choix d'un emplacement existant, ou création explicite d'un nouveau code. */
export function LocationPicker({ value, onPick, onClose }: { value: string; onPick: (code: string) => void; onClose: () => void }) {
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.locations().then((r) => setLocations(r.locations)).catch((e: Error) => setError(e.message));
  }, []);

  const wanted = filter.trim().toUpperCase().replace(/\s*\/\s*/g, "/");
  const shown = useMemo(
    () => (locations ?? []).filter((l) => l.code.includes(wanted)),
    [locations, wanted],
  );
  const exists = (locations ?? []).some((l) => l.code === wanted);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      onPick((await api.createLocation(wanted)).code);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "INVALID_LOCATION_CODE"
        ? "Code invalide : lettres, chiffres et tirets, niveaux séparés par « / » (ex. BOX-03/ROW-12)."
        : (e as Error).message);
      setCreating(false);
    }
  }

  return (
    <Sheet title="Emplacement" onClose={onClose}>
      <input
        className="input"
        placeholder="Filtrer ou saisir un code (BOX-03/ROW-12)"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoCapitalize="characters"
        autoCorrect="off"
        aria-label="Filtrer les emplacements"
      />
      {error && <p className="banner error" role="alert">{error}</p>}
      {wanted && !exists && locations && (
        <button type="button" className="btn" onClick={create} disabled={creating}>
          Créer l'emplacement <span className="mono">{wanted}</span>
        </button>
      )}
      {!locations && !error && <p className="muted">Chargement…</p>}
      {locations?.length === 0 && !wanted && <p className="muted">Aucun emplacement. Saisissez un code pour créer le premier.</p>}
      <div className="list" role="radiogroup" aria-label="Emplacements">
        {shown.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={l.code === value} className="choice" onClick={() => onPick(l.code)}>
            <span className="grow mono">{l.code}</span>
            <span className="muted small">{l.cards} carte{l.cards > 1 ? "s" : ""}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
