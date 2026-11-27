"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { BackLink, Loading, Page, PageHeader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { INTAKE, type IntakeMode } from "@/lib/intake";
import { cn } from "@/lib/utils";

/** Saisie des cartes : le matériel utilisé pour faire entrer les cartes, choisi d'abord dans l'assistant de démarrage. */
export default function IntakeSettingsPage() {
  const [mode, setMode] = useState<IntakeMode | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.appSettings().then((s) => setMode(s.intakeMode)).catch((e: Error) => setError(e.message));
  }, []);

  async function choose(next: IntakeMode) {
    const before = mode;
    setMode(next);
    try {
      await api.saveAppSettings({ intakeMode: next });
      toast.success(t("Saisie : {mode}", { mode: t(INTAKE.find((o) => o.value === next)!.label).toLowerCase() }));
    } catch (e) {
      setMode(before);
      setError((e as Error).message);
    }
  }

  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader
        back={<BackLink href="/settings">{t("Réglages")}</BackLink>}
        title={t("Saisie des cartes")}
        description={t("Ta façon habituelle de faire entrer les cartes. Le menu « Ajouter des cartes » la propose en premier ; les autres restent disponibles.")}
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      {mode === undefined ? !error && <Loading /> : (
        <div role="radiogroup" aria-label={t("Mode de saisie")} className="grid gap-2">
          {INTAKE.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={mode === option.value}
              onClick={() => mode !== option.value && void choose(option.value)}
              className={cn(
                "flex items-center gap-4 rounded-lg border bg-card p-4 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/30",
                mode === option.value && "border-foreground ring-1 ring-foreground hover:bg-card",
              )}
            >
              <option.icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="grid gap-0.5">
                <span className="text-sm font-semibold">{t(option.label)}</span>
                <span className="text-[13px] text-muted-foreground">{t(option.hint)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Page>
  );
}
