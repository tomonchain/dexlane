"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

/**
 * Mémoire des données déjà chargées, partagée par tous les écrans le temps de la session (navigation sans
 * rechargement). En revenant sur un écran, ses dernières données s'affichent tout de suite au lieu du squelette ;
 * l'écran les recharge quand même aussitôt et les remplace (affichage immédiat, puis mise à jour).
 *
 * Elle est aussi gardée sur l'appareil (localStorage, effacée à la déconnexion) : en rouvrant l'application, les
 * écrans retrouvent leurs données de la fois précédente. Celles-ci ne sont reprises qu'après le premier rendu, pour
 * que ce rendu reste identique à celui du serveur.
 */
const store = new Map<string, unknown>();
const MAX_ENTRIES = 200;

const STORAGE_KEY = "dexlane-cache-v1";
/**
 * Ce qui est gardé sur l'appareil : les entrées les plus récentes de moins d'une semaine, dans un budget total
 * (le stockage du navigateur est limité à quelques mégaoctets) ; une entrée trop lourde reste en mémoire seulement.
 */
const PERSIST_ENTRIES = 60;
const PERSIST_MAX_CHARS = 900_000;
const PERSIST_BUDGET_CHARS = 2_000_000;
const PERSIST_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
type Saved = Record<string, { at: number; value: unknown }>;
let saved: Saved | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function readSaved(): Saved {
  if (saved) return saved;
  saved = {};
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Saved) : {};
    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed)) if (now - entry.at < PERSIST_MAX_AGE_MS) saved[key] = entry;
  } catch {
    saved = {}; // stockage indisponible (navigation privée, quota) : la mémoire de session suffit
  }
  return saved;
}

function persist(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  const all = readSaved();
  delete all[key];
  all[key] = { at: Date.now(), value };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    // Des plus récentes aux plus anciennes, tant que le budget le permet.
    const kept: [string, { at: number; value: unknown }][] = [];
    let used = 0;
    for (const [k, entry] of Object.entries(readSaved()).slice(-PERSIST_ENTRIES).reverse()) {
      let size: number;
      try {
        size = JSON.stringify(entry.value).length;
      } catch {
        continue; // valeur non sérialisable : gardée en mémoire seulement
      }
      if (size > PERSIST_MAX_CHARS || used + size > PERSIST_BUDGET_CHARS) continue;
      used += size;
      kept.push([k, entry]);
    }
    saved = Object.fromEntries(kept.reverse());
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // quota dépassé : la mémoire de session suffit
    }
  }, 600);
}

/** Valeur gardée sur l'appareil pour cette clé, reprise en mémoire. */
function restore<T>(key: string | null): T | undefined {
  if (key === null || typeof window === "undefined") return undefined;
  const entry = readSaved()[key];
  if (!entry) return undefined;
  store.set(key, entry.value);
  return entry.value as T;
}

/** Efface tout, en mémoire et sur l'appareil (déconnexion, session expirée). */
export function clearCache() {
  store.clear();
  saved = {};
  if (saveTimer) clearTimeout(saveTimer);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // rien à effacer
  }
}

export function peek<T>(key: string | null): T | undefined {
  return key === null ? undefined : (store.get(key) as T | undefined);
}

export function remember<T>(key: string, value: T) {
  store.delete(key); // la plus récente passe en dernier : les plus anciennes partent d'abord
  store.set(key, value);
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value!);
  persist(key, value);
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
  // Après le premier rendu : à défaut de valeur en mémoire, celle gardée sur l'appareil (réouverture de l'application).
  const missing = current.value === null;
  useEffect(() => {
    if (!missing || key === null) return;
    const value = restore<T>(key);
    if (value !== undefined) setState((prev) => (prev.key === key && prev.value === null ? { key, value } : prev));
  }, [key, missing]);

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
