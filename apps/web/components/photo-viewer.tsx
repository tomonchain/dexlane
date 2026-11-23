"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState, type KeyboardEvent } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface ViewerPhoto {
  src: string;
  label: string;
  /** Proportion de l'image : carte (63 × 88) ou carré (visuel d'annonce). */
  shape?: "card" | "square";
}

/**
 * Photo d'une carte, avec le verso en débord juste derrière le recto quand il existe.
 * Un clic ouvre la visionneuse en grand.
 */
export function PhotoStack({ front, back, onOpen, className, label = t("Agrandir la photo") }: {
  front: ViewerPhoto;
  back?: ViewerPhoto | null;
  onOpen: (index: number) => void;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(0)}
      aria-label={back ? t("{label} (recto et verso)", { label }) : label}
      className={cn("group relative block shrink-0 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40", back && "mr-2.5 mb-1", className)}
      data-testid="photo-stack"
    >
      {back && (
        <img
          src={back.src}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full translate-x-2.5 translate-y-1 rotate-[5deg] rounded-md bg-muted object-cover shadow-sm ring-1 ring-border transition-transform duration-200 group-hover:translate-x-3.5 group-hover:rotate-[8deg]"
        />
      )}
      <img
        src={front.src}
        alt={front.label}
        className={cn(
          "relative w-full rounded-md bg-muted object-cover shadow-sm ring-1 ring-border transition-transform duration-200 group-hover:-rotate-1",
          front.shape === "square" ? "aspect-square" : "aspect-[63/88]",
        )}
      />
    </button>
  );
}

/** Visionneuse plein écran : photo en grand, recto ↔ verso et autres vues au clavier, aux flèches ou aux vignettes. */
export function PhotoViewer({ photos, start = 0, title, onClose }: { photos: ViewerPhoto[]; start?: number; title: string; onClose: () => void }) {
  const [index, setIndex] = useState(Math.min(start, photos.length - 1));
  const photo = photos[index]!;
  const go = (delta: number) => setIndex((i) => (i + delta + photos.length) % photos.length);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
  };
  const nav = "flex size-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60";

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={onKey}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          data-testid="photo-viewer"
        >
          <div className="flex w-full max-w-3xl items-center justify-between gap-3 text-white">
            <Dialog.Title className="min-w-0 truncate text-sm font-medium">
              {title} <span className="text-white/60">· {photo.label}</span>
            </Dialog.Title>
            <Dialog.Close aria-label={t("Fermer")} className={nav}><X className="size-5" /></Dialog.Close>
          </div>

          <div className="relative flex min-h-0 w-full max-w-3xl flex-1 items-center justify-center">
            <img
              key={photo.src}
              src={photo.src}
              alt={`${title}, ${photo.label}`}
              className="max-h-full max-w-full rounded-xl object-contain shadow-2xl animate-in fade-in-0"
            />
            {photos.length > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} aria-label={t("Photo précédente")} className={cn(nav, "absolute top-1/2 left-0 -translate-y-1/2")}><ChevronLeft className="size-5" /></button>
                <button type="button" onClick={() => go(1)} aria-label={t("Photo suivante")} className={cn(nav, "absolute top-1/2 right-0 -translate-y-1/2")}><ChevronRight className="size-5" /></button>
              </>
            )}
          </div>

          {photos.length > 1 && (
            <div className="flex max-w-full flex-wrap justify-center gap-2 p-1" role="tablist" aria-label={t("Photos")}>
              {photos.map((p, i) => (
                <button
                  key={p.src}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-label={p.label}
                  onClick={() => setIndex(i)}
                  className={cn("shrink-0 overflow-hidden rounded-md outline-none ring-2 transition focus-visible:ring-white", i === index ? "ring-white" : "opacity-60 ring-transparent hover:opacity-100")}
                >
                  <img src={p.src} alt="" className={cn("h-16 bg-white/10 object-cover", p.shape === "square" ? "aspect-square" : "aspect-[63/88]")} />
                </button>
              ))}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
