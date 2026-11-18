"use client";

import { ImagePlus, X } from "lucide-react";
import { useRef } from "react";
import { api } from "@/lib/api";
import { prepareImage } from "@/lib/image";
import type { Photo } from "@/lib/types";
import { Button } from "./ui/button";

/**
 * Photos de l'exemplaire d'une carte en stock : les voir, en retirer une, en ajouter une après coup
 * (carte entrée sans scan, ou photo à refaire). La première photo est le recto, la suivante le verso.
 */
export function OfferPhotos({ offerId, photos, run, disabled }: {
  offerId: string;
  photos: Photo[];
  /** Exécute l'action, affiche son message de succès et recharge la carte. */
  run: (action: () => Promise<string>) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scans = photos.filter((p) => p.kind === "SCAN_FRONT" || p.kind === "SCAN_BACK");
  const next = scans.some((p) => p.kind === "SCAN_FRONT") && !scans.some((p) => p.kind === "SCAN_BACK") ? "SCAN_BACK" : "SCAN_FRONT";

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="offer-photos">
      {scans.map((photo) => (
        <span key={photo.id} className="relative">
          <a href={photo.url} target="_blank" rel="noreferrer" className="block rounded outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30">
            <img src={photo.url} alt={photo.kind === "SCAN_BACK" ? "Verso" : "Recto"} loading="lazy" className="aspect-[63/88] w-12 rounded bg-muted object-cover ring-1 ring-border" />
          </a>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Retirer la photo ${photo.kind === "SCAN_BACK" ? "du verso" : "du recto"}`}
            title="Retirer cette photo"
            onClick={() => run(async () => {
              await api.deletePhoto(photo.id);
              return "Photo retirée";
            })}
            className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-xs outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        data-testid="offer-photo-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) run(async () => {
            await api.addOfferPhoto(offerId, await prepareImage(file), next);
            return next === "SCAN_BACK" ? "Verso ajouté" : "Photo ajoutée";
          });
        }}
      />
      <Button variant={scans.length === 0 ? "default" : "outline"} size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
        <ImagePlus /> {scans.length === 0 ? "Ajouter une photo" : next === "SCAN_BACK" ? "Ajouter le verso" : "Ajouter une photo"}
      </Button>
    </div>
  );
}
