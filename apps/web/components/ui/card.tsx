import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card" className={cn("rounded-xl border bg-card text-card-foreground shadow-xs", className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("text-[15px] leading-tight font-semibold tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-4 sm:p-5", className)} {...props} />;
}

/** Petit intitulé de section, en capitales discrètes. */
export function Eyebrow({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase", className)} {...props} />;
}
