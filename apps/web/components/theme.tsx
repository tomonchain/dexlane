"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}

const OPTIONS = [
  { value: "light", label: "Clair", icon: Sun },
  { value: "dark", label: "Sombre", icon: Moon },
  { value: "system", label: "Système", icon: Monitor },
] as const;

/** Sélecteur de thème à trois positions. Rendu neutre avant montage : le thème n'est connu que côté navigateur. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div role="radiogroup" aria-label={t("Thème")} className={cn("inline-flex rounded-lg border bg-muted/60 p-0.5", className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={t("Thème {name}", { name: t(label).toLowerCase() })}
            title={t(label)}
            onClick={() => setTheme(value)}
            className={cn(
              "flex h-7 flex-1 items-center justify-center rounded-md px-2.5 text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              active && "bg-card text-foreground shadow-xs",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
