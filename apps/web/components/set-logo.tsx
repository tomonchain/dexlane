"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const LOCALIZED = /(assets\.tcgdex\.net\/)(?!en\/)[a-z-]+\//;

/**
 * Logo d'une série (TCGdex). Comme pour les cartes, le logo d'une langue peut manquer : le logo anglais prend le
 * relais, et à défaut rien ne s'affiche (l'emplacement garde sa taille pour que les lignes restent alignées).
 */
export function SetLogo({ url, name, className, symbol = false }: { url: string | null; name: string; className?: string; symbol?: boolean }) {
  const [step, setStep] = useState(0);
  const english = url && LOCALIZED.test(url) ? url.replace(LOCALIZED, "$1en/") : null;
  const base = step === 0 ? url : step === 1 ? english : null;
  return (
    <span className={cn("flex shrink-0 items-center justify-center", className)} aria-hidden={!base}>
      {base && (
        <img
          src={`${base}.webp`}
          alt={symbol ? "" : name}
          loading="lazy"
          onError={() => setStep(step === 0 && english ? 1 : 2)}
          className="max-h-full max-w-full object-contain"
          data-testid={symbol ? "set-symbol" : "set-logo"}
        />
      )}
    </span>
  );
}
