import "server-only";
import type { PublicCard, PublicSet, PublicSetCard } from "@dexlane/catalog";
import { callApi } from "./backend";

/**
 * Catalogue public du site (pages /series) : lu par l'API, qui ne renvoie que le catalogue commun et les cotes.
 * Les pages sont rendues côté serveur puis mises en cache (voir `revalidate` dans app/(marketing)/series).
 */
const LANGUAGE = "fr";
/** Les cotes sont relevées chaque nuit : une lecture par jour suffit. */
const REVALIDATE = 86400;

/** Les dates arrivent en texte (JSON) : on les remet en `Date`. */
type Wire<T> = T extends Date ? string : T extends (infer U)[] ? Wire<U>[] : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;

async function get<T>(path: string): Promise<T | null> {
  const res = await callApi(`/api/public/catalog${path}${path.includes("?") ? "&" : "?"}language=${LANGUAGE}`, { revalidate: REVALIDATE });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`public catalog: ${res.status} on ${path}`);
  return (await res.json()) as T;
}

const reviveSet = (s: Wire<PublicSet>): PublicSet => ({ ...s, updatedAt: s.updatedAt ? new Date(s.updatedAt) : null });

export async function publicSets(): Promise<PublicSet[]> {
  const body = await get<{ sets: Wire<PublicSet>[] }>("/sets");
  return (body?.sets ?? []).map(reviveSet);
}

export async function publicSet(segment: string): Promise<{ set: PublicSet; cards: PublicSetCard[] } | null> {
  const body = await get<{ set: Wire<PublicSet>; cards: PublicSetCard[] }>(`/sets/${encodeURIComponent(segment)}`);
  return body && { set: reviveSet(body.set), cards: body.cards };
}

export async function publicCard(setSegment: string, cardSegment: string): Promise<PublicCard | null> {
  const body = await get<Wire<PublicCard>>(`/sets/${encodeURIComponent(setSegment)}/cards/${encodeURIComponent(cardSegment)}`);
  if (!body) return null;
  return {
    ...body,
    set: reviveSet(body.set),
    variants: body.variants.map((v) => ({ ...v, price: v.price ? { ...v.price, observedAt: new Date(v.price.observedAt) } : null })),
  };
}

export async function publicSitemap(): Promise<{ sets: PublicSet[]; cards: { setId: string; setName: string; localNumber: string; name: string; updatedAt: Date }[] }> {
  const body = await get<{ sets: Wire<PublicSet>[]; cards: { setId: string; setName: string; localNumber: string; name: string; updatedAt: string }[] }>("/sitemap");
  return {
    sets: (body?.sets ?? []).map(reviveSet),
    cards: (body?.cards ?? []).map((c) => ({ ...c, updatedAt: new Date(c.updatedAt) })),
  };
}
