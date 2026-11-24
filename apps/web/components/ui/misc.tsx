"use client";

import { ArrowLeft, LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { t } from "@/lib/i18n";
import { setPageActionsSlot } from "@/lib/page-actions";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("size-4 animate-spin text-muted-foreground", className)} aria-hidden />;
}

export function Loading({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <p role="status" className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <Spinner /> {children ?? t("Chargement…")}
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

/**
 * Gabarit de page : les écrans de données prennent toute la largeur, les formulaires une colonne lisible.
 * Tous sont alignés à gauche, pour que le titre ne saute pas d'un écran à l'autre.
 */
export function Page({ width = "full", className, ...props }: ComponentProps<"div"> & { width?: "full" | "narrow" }) {
  return <div className={cn("grid gap-5", width === "narrow" && "max-w-3xl", className)} {...props} />;
}

/** Retour vers l'écran parent : un lien, ou l'historique quand le parent n'est pas connu. */
export function BackLink({ href, onClick, children }: { href?: string; onClick?: () => void; children: ReactNode }) {
  const className =
    "-my-1 flex items-center gap-1.5 justify-self-start rounded-sm py-1 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 print:hidden";
  const body = <><ArrowLeft className="size-3.5" aria-hidden /> {children}</>;
  return href ? <Link href={href} className={className}>{body}</Link> : <button type="button" onClick={onClick} className={className}>{body}</button>;
}

export function PageHeader({ title, description, actions, back, meta, testId }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Lien de retour affiché au-dessus du titre. */
  back?: ReactNode;
  /** Badges ou repères affichés sous le titre, avant la description. */
  meta?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="grid gap-3">
      {/* Sur téléphone, la première ligne laisse la place à l'icône de recherche, en haut à droite. */}
      {back && <div className="flex max-lg:pr-20">{back}</div>}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className={cn("grid min-w-0 flex-1 basis-64 gap-1", !back && "max-lg:pr-12")}>
          <h1 className="text-xl leading-tight font-semibold tracking-tight sm:text-2xl" data-testid={testId}>{title}</h1>
          {meta && <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">{meta}</div>}
          {description && <p className="max-w-2xl text-sm text-pretty text-muted-foreground">{description}</p>}
        </div>
        {/* Toutes les actions de la page, en haut à droite : celles de l'en-tête, puis celles des barres d'action. */}
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 empty:hidden" data-testid="page-actions">
          {actions}
          <div ref={setPageActionsSlot} className="contents" />
        </div>
      </div>
    </div>
  );
}
