"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fold } from "@/lib/catalog";
import type { CatalogSet } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Input } from "./ui/input";
import { Code } from "./ui/misc";

const MAX_OPTIONS = 8;

/**
 * Choix d'une série importée, par nom ou identifiant, avec suggestions au fil de la frappe.
 * Ne propose que les séries importées : ce sont les seules dont les cartes sont trouvables.
 * `onChange` reçoit l'identifiant de la série choisie, ou "" tant que la saisie ne désigne aucune série.
 */
export function SetCombobox({ language, value, onChange }: { language: string; value: string; onChange: (setId: string) => void }) {
  const listId = useId();
  const [sets, setSets] = useState<CatalogSet[] | null>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let current = true;
    api.catalogSets(language)
      .then((r) => current && setSets(r.sets.filter((s) => s.cardsSynced > 0)))
      .catch(() => current && setSets([]));
    return () => {
      current = false;
    };
  }, [language]);
  useEffect(() => () => clearTimeout(blurTimer.current), []);

  const query = fold(text.trim());
  const options = useMemo(
    () => (sets ?? []).filter((s) => !query || fold(s.name).includes(query) || s.id.includes(query)).slice(0, MAX_OPTIONS),
    [sets, query],
  );

  function pick(set: CatalogSet) {
    setText(`${set.name} · ${set.id}`);
    onChange(set.id);
    setOpen(false);
  }

  function type(next: string) {
    setText(next);
    setActive(0);
    setOpen(true);
    // Un identifiant exact saisi à la main vaut sélection ; un fragment de nom ne filtre rien tant qu'on n'a pas choisi.
    const exact = (sets ?? []).find((s) => s.id === next.trim().toLowerCase());
    onChange(exact ? exact.id : "");
  }

  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${options[active].id}` : undefined}
        value={text}
        onChange={(e) => type(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120); // laisse passer le clic sur une suggestion
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && open && options[active]) {
            e.preventDefault();
            pick(options[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Nom ou identifiant"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        className="pr-9"
      />
      <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      {open && sets && (
        <div id={listId} role="listbox" aria-label="Séries importées" className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg">
          {options.map((s, i) => (
            <button
              key={s.id}
              id={`${listId}-${s.id}`}
              type="button"
              role="option"
              aria-selected={s.id === value}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
              onMouseEnter={() => setActive(i)}
              className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-none", i === active && "bg-accent")}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block truncate text-xs text-muted-foreground"><Code>{s.id}</Code> · {s.cardsSynced} carte{s.cardsSynced > 1 ? "s" : ""}</span>
              </span>
              <Check className={cn("size-4 text-primary", s.id !== value && "invisible")} aria-hidden />
            </button>
          ))}
          {options.length === 0 && (
            <p className="px-2.5 py-3 text-sm text-muted-foreground">
              {sets.length === 0 ? "Aucune série importée pour cette langue." : "Aucune série importée ne correspond."}{" "}
              <Link href="/catalogue" className="font-medium text-primary underline-offset-2 hover:underline" onMouseDown={(e) => e.preventDefault()}>Ouvrir le catalogue</Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
