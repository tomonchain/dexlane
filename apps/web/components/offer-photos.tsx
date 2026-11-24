"use client";

import { ImagePlus, RefreshCw, X } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { scanCardPhoto } from "@/lib/card-scan";
import { t } from "@/lib/i18n";
import { prepareImage } from "@/lib/image";
import type { Photo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { composeMissingVisuals } from "@/lib/visuals";

type Side = "SCAN_FRONT" | "SCAN_BACK";
const SIDES: { kind: Side; label: string }[] = [
  { kind: "SCAN_FRONT", label: "Recto" },
  { kind: "SCAN_BACK", label: "Verso" },
];

/**
 * Photos de l'exemplaire d'une carte en stock : un emplacement pour le recto, un pour le verso. Chacun s'ajoute, se
 * remplace ou se retire ; une photo prise au téléphone est recadrée au format carte, comme au scanner.
 */
export function OfferPhotos({ offerId, photos, run, disabled, onOpen }: {
  offerId: string;
  photos: Photo[];
  /** Ouvre la photo en grand ; sans lui, la photo s'ouvre dans un nouvel onglet. */
  onOpen?: (photo: Photo) => void;
  /** Exécute l'action, affiche son message de succès et recharge la carte. */
  run: (action: () => Promise<string>) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<Side>("SCAN_FRONT");
  const current = (kind: Side) => photos.find((p) => p.kind === kind) ?? null;

  function pick(kind: Side) {
    setTarget(kind);
    // L'emplacement visé doit être retenu avant que la boîte de choix de fichier s'ouvre.
    requestAnimationFrame(() => inputRef.current?.click());
  }

  return (
    <div className="flex flex-wrap items-start gap-3" data-testid="offer-photos">
      {SIDES.map(({ kind, label }) => {
        const photo = current(kind);
        const name = t(label);
        return (
          <div key={kind} className="grid justify-items-center gap-1" data-testid={`offer-photo-${kind === "SCAN_FRONT" ? "front" : "back"}`}>
            {photo ? (
              <span className="relative">
                {onOpen ? (
                  <button type="button" onClick={() => onOpen(photo)} title={t("Agrandir")} className="block rounded outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30">
                    <img src={photo.url} alt={name} loading="lazy" className="aspect-[63/88] w-14 rounded bg-muted object-cover ring-1 ring-border" />
                  </button>
                ) : (
                  <a href={photo.url} target="_blank" rel="noreferrer" className="block rounded outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30">
                    <img src={photo.url} alt={name} loading="lazy" className="aspect-[63/88] w-14 rounded bg-muted object-cover ring-1 ring-border" />
                  </a>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={kind === "SCAN_BACK" ? t("Retirer la photo du verso") : t("Retirer la photo du recto")}
                  title={t("Retirer cette photo")}
                  onClick={() => run(async () => {
                    await api.deletePhoto(photo.id);
                    return t("Photo retirée");
                  })}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-xs outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={disabled}
                onClick={() => pick(kind)}
                aria-label={kind === "SCAN_BACK" ? t("Ajouter le verso") : t("Ajouter le recto")}
                className={cn("flex aspect-[63/88] w-14 flex-col items-center justify-center gap-1 rounded border border-dashed text-muted-foreground outline-none transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-50")}
              >
                <ImagePlus className="size-4" aria-hidden />
              </button>
            )}
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {name}
              {photo && (
                <button type="button" disabled={disabled} onClick={() => pick(kind)} title={t("Remplacer")} aria-label={kind === "SCAN_BACK" ? t("Remplacer le verso") : t("Remplacer le recto")}
                  className="rounded p-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30">
                  <RefreshCw className="size-3" aria-hidden />
                </button>
              )}
            </span>
          </div>
        );
      })}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        data-testid="offer-photo-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          const kind = target;
          const previous = current(kind);
          if (file) run(async () => {
            const scanned = await scanCardPhoto(file).catch(() => ({ blob: file as Blob }));
            await api.addOfferPhoto(offerId, await prepareImage(scanned.blob), kind);
            // La nouvelle photo remplace l'ancienne du même côté.
            if (previous) await api.deletePhoto(previous.id).catch(() => undefined);
            await composeMissingVisuals([offerId]).catch(() => 0);
            return kind === "SCAN_BACK" ? (previous ? t("Verso remplacé") : t("Verso ajouté")) : (previous ? t("Recto remplacé") : t("Recto ajouté"));
          });
        }}
      />
    </div>
  );
}
