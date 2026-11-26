import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const field =
  "w-full min-w-0 rounded-lg border border-input bg-card text-base shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm";

export function Input({ className, type, ...props }: ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(field, "h-11 px-3 md:h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(field, "min-h-24 px-3 py-2.5", className)} {...props} />;
}

/** Liste déroulante native (meilleure ergonomie sur téléphone), habillée comme les autres champs. */
export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <span className="relative block">
      <select data-slot="select" className={cn(field, "h-11 appearance-none truncate pr-9 pl-3 md:h-10", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </span>
  );
}

/** Champ étiqueté : le libellé enveloppe le contrôle, donc pas d'identifiant à relier. */
export function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-[13px] leading-none font-medium text-foreground/80">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
