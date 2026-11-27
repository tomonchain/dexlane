"use client";

import { ImageOff, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useCardImage } from "@/lib/card-image";
import type { Candidate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/input";
import { Spinner } from "./ui/misc";
import { SetCombobox } from "./set-combobox";

const SIZES = { sm: "w-11 rounded-[5px]", md: "w-14 rounded-md", lg: "w-24 rounded-lg" };

/** Visuel de catalogue au format carte ; repli neutre si l'image manque ou ne charge pas. */
export function CardThumb({ imageUrl, size = "md", className }: { imageUrl: string | null; size?: keyof typeof SIZES; className?: string }) {
  const { src, onError } = useCardImage(imageUrl);
  const box = cn("aspect-[63/88] shrink-0 bg-muted ring-1 ring-border", SIZES[size], className);
  if (!src) {
    return (
      <div className={cn(box, "flex items-center justify-center text-muted-foreground/50")} aria-hidden>
        <ImageOff className={size === "lg" ? "size-6" : "size-4"} />
      </div>
    );
  }
  return <img className={cn(box, "object-cover")} src={src} alt="" loading="lazy" onError={onError} />;
}

function Score({ value }: { value: number }) {
  const percent = Math.round(value * 100);
  const tone = percent >= 95 ? "text-success" : percent >= 75 ? "text-warning" : "text-muted-foreground";
  return (
    <span className="grid justify-items-end gap-1" title={t("Score de correspondance")}>
      <span className={cn("tabular text-sm font-semibold", tone)}>{percent} %</span>
      <span className="h-1 w-12 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className="block h-full rounded-full bg-current opacity-80" style={{ width: `${percent}%`, color: "inherit" }} />
      </span>
    </span>
  );
}

/** Liste de cartes du catalogue ; une seule sélectionnable. */
export function CandidateList({ candidates, selectedId, onSelect }: {
  candidates: Candidate[];
  selectedId: string | null;
  onSelect: (c: Candidate) => void;
}) {
  return (
    <div className="grid gap-2" role="radiogroup" aria-label={t("Cartes proposées")}>
      {candidates.map((c) => {
        const selected = c.catalogCardId === selectedId;
        return (
          <button
            key={c.catalogCardId}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(c)}
            className={cn(
              "flex items-center gap-3 rounded-xl border bg-card p-2.5 text-left shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30",
              selected && "border-primary bg-brand-soft ring-1 ring-primary hover:bg-brand-soft",
            )}
          >
            <CardThumb imageUrl={c.imageUrl} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">{c.name}</span>
              <span className="block truncate text-sm text-muted-foreground">
                {c.setName ?? c.setId} · {t("n° {number}", { number: c.localNumber })}{c.rarity ? ` · ${c.rarity}` : ""}
              </span>
            </span>
            <span className={selected ? "text-primary" : undefined}><Score value={c.score} /></span>
          </button>
        );
      })}
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
      if (candidates.length === 0) setMessage(t("Aucune carte trouvée. Vérifie la langue, ou synchronise la série de cette carte depuis l'onglet Catalogue."));
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const empty = !name.trim() && !number.trim() && !set.trim();
  return (
    <form className="grid gap-3 rounded-xl border border-dashed bg-muted/30 p-3" onSubmit={search}>
      <Field label={t("Nom")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoCorrect="off" enterKeyHint="search" placeholder={t("Dracaufeu")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Numéro")}>
          <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="136/189" autoCorrect="off" enterKeyHint="search" />
        </Field>
        <Field label={t("Série")}>
          <SetCombobox language={language} value={set} onChange={setSet} />
        </Field>
      </div>
      <Button type="submit" variant="outline" disabled={busy || empty}>
        {busy ? <Spinner /> : <Search />} {t("Rechercher dans le catalogue")}
      </Button>
      {message && <Alert variant="warning">{message}</Alert>}
    </form>
  );
}
