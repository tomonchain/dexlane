"use client";

import { Minus, Plus } from "lucide-react";

const side =
  "flex size-11 items-center justify-center bg-card text-foreground transition-colors outline-none hover:bg-accent focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-40 md:size-10";

export function Stepper({ value, onChange, min = 1, max = 10000, label }: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  label: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? Math.trunc(n) : min));
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-input shadow-xs">
      <button type="button" className={side} onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label={`${label} : moins`}>
        <Minus className="size-4" aria-hidden />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        onFocus={(e) => e.target.select()}
        aria-label={label}
        className="tabular w-16 [appearance:textfield] border-x border-input bg-card text-center text-base font-semibold outline-none focus-visible:bg-accent [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button type="button" className={side} onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label={`${label} : plus`}>
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
