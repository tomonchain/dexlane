"use client";

import { ToggleGroup as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Choix unique parmi quelques options visibles (rôle radio). Une option choisie ne se désélectionne pas. */
export function ChoiceGroup<T extends string>({
  value, onValueChange, className, ...props
}: Omit<ComponentProps<typeof Primitive.Root>, "type" | "value" | "onValueChange" | "defaultValue"> & {
  value: T | null;
  onValueChange: (value: T) => void;
}) {
  return (
    <Primitive.Root
      type="single"
      role="radiogroup"
      value={value ?? ""}
      onValueChange={(next) => next && onValueChange(next as T)}
      className={cn("flex flex-wrap gap-2", className)}
      {...props}
    />
  );
}

export function Choice({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-input bg-card px-3.5 text-sm font-medium shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm data-[state=on]:shadow-primary/25 md:min-h-10",
        className,
      )}
      {...props}
    />
  );
}
