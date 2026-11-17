"use client";

import { Check, MapPin, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import type { Location } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Code, Loading } from "./ui/misc";
import { Modal } from "./ui/modal";

/** Champ « emplacement » : affiche le code choisi et ouvre le sélecteur. */
export function LocationField({ value, onChange, label = "Emplacement" }: { value: string; onChange: (code: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-1.5">
      <span className="text-[13px] leading-none font-medium text-foreground/80" id="location-field-label">{label}</span>
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpen(true)}
        className="flex h-11 w-full items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-base shadow-xs transition-colors outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 md:h-10 md:text-sm"
      >
        <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        {value ? <Code className="flex-1 truncate">{value}</Code> : <span className="flex-1 text-muted-foreground/70">Choisir un emplacement…</span>}
        <span className="text-xs font-medium text-primary">Changer</span>
      </button>
      {open && (
        <LocationPicker
          value={value}
          onClose={() => setOpen(false)}
          onPick={(code) => {
            onChange(code);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

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
  const shown = useMemo(() => (locations ?? []).filter((l) => l.code.includes(wanted)), [locations, wanted]);
  const exists = (locations ?? []).some((l) => l.code === wanted);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const created = await api.createLocation(wanted);
      toast.success(`Emplacement ${created.code} créé`);
      onPick(created.code);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "INVALID_LOCATION_CODE"
        ? "Code invalide : lettres, chiffres et tirets, niveaux séparés par « / » (ex. BOX-03/ROW-12)."
        : (e as Error).message);
      setCreating(false);
    }
  }

  return (
    <Modal title="Emplacement" description="Choisissez où ranger, ou saisissez un nouveau code pour le créer." onClose={onClose}>
      <span className="relative block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          placeholder="BOX-03/ROW-12"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          aria-label="Filtrer les emplacements"
          className="pl-9 font-mono"
        />
      </span>
      {error && <Alert variant="destructive">{error}</Alert>}
      {wanted && !exists && locations && (
        <Button variant="outline" onClick={create} disabled={creating} className="justify-start">
          <Plus /> Créer l'emplacement <Code>{wanted}</Code>
        </Button>
      )}
      {!locations && !error && <Loading />}
      {locations?.length === 0 && !wanted && (
        <p className="text-sm text-muted-foreground">Aucun emplacement pour l'instant. Saisissez un code pour créer le premier.</p>
      )}
      {shown.length > 0 && (
        <div className="-mx-1 grid gap-0.5" role="radiogroup" aria-label="Emplacements">
          {shown.map((l) => {
            const selected = l.code === value;
            return (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={l.code}
                onClick={() => onPick(l.code)}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30",
                  selected && "bg-brand-soft",
                )}
                style={{ paddingLeft: `${0.75 + 0.9 * (l.code.split("/").length - 1)}rem` }}
              >
                <Code className="flex-1 truncate">{l.code}</Code>
                <span className="tabular text-xs text-muted-foreground">{l.cards} carte{l.cards > 1 ? "s" : ""}</span>
                <Check className={cn("size-4 text-primary", !selected && "invisible")} aria-hidden />
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
