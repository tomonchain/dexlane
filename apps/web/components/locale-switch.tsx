"use client";

import { LOCALES, getLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { switchLocale } from "./i18n-provider";

/** Choix de la langue avant connexion : le même réglage que dans Compte, enregistré sur cet appareil. */
export function LocaleSwitch({ className }: { className?: string }) {
  return (
    <div role="radiogroup" aria-label={t("Langue de l'interface")} className={cn("inline-flex items-center gap-1 text-[13px]", className)} data-testid="locale-switch">
      {LOCALES.map((l, i) => (
        <span key={l.value} className="inline-flex items-center gap-1">
          {i > 0 && <span aria-hidden className="text-muted-foreground/60">·</span>}
          <button
            type="button"
            role="radio"
            aria-checked={getLocale() === l.value}
            lang={l.value}
            onClick={() => getLocale() !== l.value && switchLocale(l.value)}
            className={cn(
              "rounded px-1 text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/30",
              getLocale() === l.value && "font-medium text-foreground",
            )}
          >
            {l.label}
          </button>
        </span>
      ))}
    </div>
  );
}
