"use client";

import { useCallback, useRef, useState, type SetStateAction } from "react";

/**
 * Mémoire des données déjà chargées, partagée par tous les écrans le temps de la session (navigation sans
 * rechargement). En revenant sur un écran, ses dernières données s'affichent tout de suite au lieu du squelette ;
 * l'écran les recharge quand même aussitôt et les remplace (affichage immédiat, puis mise à jour).
 * Rien n'est gardé d'un rechargement complet de la page : le premier rendu, fait aussi côté serveur, reste identique.
 */
const store = new Map<string, unknown>();
const MAX_ENTRIES = 200;

export function peek<T>(key: string | null): T | undefined {
  return key === null ? undefined : (store.get(key) as T | undefined);
}

export function remember<T>(key: string, value: T) {
  store.delete(key); // la plus récente passe en dernier : les plus anciennes partent d'abord
  store.set(key, value);
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value!);
}

/** Oublie les entrées dont la clé commence par l'un des préfixes (toutes sans argument). */
export function forget(...prefixes: string[]) {
  for (const key of [...store.keys()]) if (prefixes.length === 0 || prefixes.some((p) => key.startsWith(p))) store.delete(key);
}

/**
 * Comme `useState<T | null>(null)`, mais la valeur de départ vient de la mémoire pour cette clé, et chaque valeur
 * posée y est gardée. Quand la clé change (autre filtre, autre carte), la valeur connue pour la nouvelle clé
 * s'affiche, ou null s'il n'y en a pas. `keepPrevious` : pour une liste qu'on filtre ou qu'on recherche, la valeur
 * précédente reste affichée tant que la nouvelle n'est pas arrivée (pas de squelette à chaque frappe).
 */
export function useCachedState<T>(key: string | null, opts: { keepPrevious?: boolean } = {}): [T | null, (next: SetStateAction<T | null>) => void] {
  const [state, setState] = useState<{ key: string | null; value: T | null }>(() => ({ key, value: peek<T>(key) ?? null }));
  const keyRef = useRef(key);
  keyRef.current = key;
  let current = state;
  if (state.key !== key) {
    current = { key, value: peek<T>(key) ?? (opts.keepPrevious ? state.value : null) };
    setState(current); // état dérivé de la clé : React reprend le rendu avec la bonne valeur
  }
  const set = useCallback((next: SetStateAction<T | null>) => {
    setState((prev) => {
      const k = keyRef.current;
      const base = prev.key === k ? prev.value : (peek<T>(k) ?? null);
      const value = typeof next === "function" ? (next as (v: T | null) => T | null)(base) : next;
      if (k !== null && value !== null) remember(k, value);
      return { key: k, value };
    });
  }, []);
  return [current.value, set];
}
