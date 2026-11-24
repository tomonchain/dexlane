"use client";

import { useSyncExternalStore } from "react";

/**
 * Emplacement des actions de la page, en haut à droite du contenu (dans l'en-tête de page) : les barres d'action
 * (`ActionBar`, `SaveBar`) s'y placent toutes, pour que les boutons d'une page soient toujours au même endroit.
 * L'en-tête enregistre son emplacement ; une page sans en-tête garde la barre en bas de l'écran.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setPageActionsSlot(el: HTMLElement | null) {
  if (slot === el) return;
  slot = el;
  for (const listener of listeners) listener();
}

export function usePageActionsSlot(): HTMLElement | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => slot,
    () => null,
  );
}
