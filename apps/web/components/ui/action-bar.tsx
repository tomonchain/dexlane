import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Barre d'action collante, en bas de l'écran (au-dessus des onglets sur téléphone) : l'action principale de la page reste
 * à portée sans défiler, avec à gauche ce qu'il faut savoir avant de la lancer. Une seule par page.
 * `tone="unsaved"` : modifications non enregistrées, la barre se détache (formulaires de réglages).
 */
export function ActionBar({ message, children, tone = "default", className }: {
  message?: ReactNode;
  children: ReactNode;
  tone?: "default" | "unsaved";
  className?: string;
}) {
  return (
    <>
      {/* Réserve la hauteur de la barre : le bas de la page n'est jamais masqué. */}
      <div aria-hidden className="h-16 print:hidden" />
      <div className={cn("fixed inset-x-0 bottom-nav z-30 px-3 lg:bottom-0 lg:left-56 lg:px-8 lg:pb-4 print:hidden", className)} data-testid="action-bar">
        <div
          role="region"
          aria-label={t("Action principale")}
          className={cn(
            "mx-auto flex max-w-[92rem] items-center gap-3 rounded-lg border px-4 py-2.5 shadow-lg",
            tone === "unsaved" ? "border-foreground/80 bg-foreground text-background [&_[data-slot=message]]:text-background/80" : "bg-popover",
          )}
        >
          <div data-slot="message" className="min-w-0 flex-1 text-sm text-muted-foreground" role="status">{message}</div>
          <div className="flex shrink-0 items-center gap-2">{children}</div>
        </div>
      </div>
    </>
  );
}

/**
 * Barre d'enregistrement d'un formulaire de réglages : elle n'apparaît qu'en présence de modifications non enregistrées,
 * avec de quoi les annuler ou les enregistrer. `submit` : le bouton d'enregistrement soumet le formulaire qui l'entoure.
 */
export function SaveBar({ message, saveLabel, saving, disabled, onSave, onDiscard, submit = false }: {
  message?: ReactNode;
  saveLabel: string;
  saving: boolean;
  disabled?: boolean;
  onSave?: () => void;
  onDiscard: () => void;
  submit?: boolean;
}) {
  return (
    <ActionBar tone="unsaved" message={message ?? t("Modifications non enregistrées")}>
      <button
        type="button"
        onClick={onDiscard}
        disabled={saving}
        className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-background/90 outline-none hover:bg-background/10 focus-visible:ring-2 focus-visible:ring-background/40 disabled:opacity-50"
      >
        {t("Annuler")}
      </button>
      <button
        type={submit ? "submit" : "button"}
        onClick={submit ? undefined : onSave}
        disabled={saving || disabled}
        className="inline-flex h-9 items-center gap-2 rounded-md bg-background px-4 text-sm font-medium text-foreground outline-none hover:bg-background/90 focus-visible:ring-2 focus-visible:ring-background/40 disabled:opacity-50"
      >
        {saving && <span className="size-3.5 animate-spin rounded-full border-2 border-foreground/30 border-t-foreground" aria-hidden />}
        {saveLabel}
      </button>
    </ActionBar>
  );
}
