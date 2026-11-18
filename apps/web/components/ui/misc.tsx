import { LoaderCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("size-4 animate-spin text-muted-foreground", className)} aria-hidden />;
}

export function Loading({ children = "Chargement…", className }: { children?: ReactNode; className?: string }) {
  return (
    <p role="status" className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <Spinner /> {children}
    </p>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
      {icon && <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">{icon}</div>}
      <div className="grid gap-1">
        <p className="text-sm font-semibold">{title}</p>
        {children && <p className="mx-auto max-w-sm text-sm text-muted-foreground">{children}</p>}
      </div>
      {action}
    </div>
  );
}

/** Identifiant technique (SKU, code d'emplacement) : chasse fixe, non coupé. */
export function Code({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("font-mono text-[0.92em] tracking-tight whitespace-nowrap", className)} {...props} />;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="grid gap-1">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
