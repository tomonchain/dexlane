"use client";

import { Switch as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-transparent bg-input shadow-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-50 data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <Primitive.Thumb className="pointer-events-none block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[1.125rem]" />
    </Primitive.Root>
  );
}

/** Interrupteur avec libellé et précision, cliquable sur toute la ligne. */
export function SwitchRow({ label, description, checked, onCheckedChange, disabled }: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1">
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={label} />
    </label>
  );
}
