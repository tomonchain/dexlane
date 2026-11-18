"use client";

import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { Input } from "./ui/input";

/** Champ secret avec bouton afficher / masquer. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input type={visible ? "text" : "password"} className={`px-9 ${className ?? ""}`} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Masquer" : "Afficher"}
        className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </span>
  );
}
