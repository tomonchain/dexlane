import type { TcgdexCard, TcgdexSet, TcgdexSetBrief } from "./types";

export interface TcgdexClient {
  listSets(language: string): Promise<TcgdexSetBrief[]>;
  getSet(language: string, setId: string): Promise<TcgdexSet>;
  /** null si la carte n'existe pas dans cette langue. */
  getCard(language: string, cardId: string): Promise<TcgdexCard | null>;
}

export interface HttpClientOptions {
  baseUrl?: string;
  /** Requêtes simultanées maximum (API publique gratuite : rester raisonnable). */
  concurrency?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

export function createTcgdexClient(opts: HttpClientOptions = {}): TcgdexClient {
  const baseUrl = opts.baseUrl ?? "https://api.tcgdex.net/v2";
  const retries = opts.retries ?? 3;
  const doFetch = opts.fetchImpl ?? fetch;
  const limit = semaphore(opts.concurrency ?? 4);

  async function get<T>(path: string, allow404 = false): Promise<T | null> {
    return limit(async () => {
      for (let attempt = 0; ; attempt++) {
        const res = await doFetch(`${baseUrl}${path}`, {
          headers: { accept: "application/json", "user-agent": "dexlane-catalog-sync" },
        });
        if (res.ok) return (await res.json()) as T;
        if (res.status === 404 && allow404) return null;
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= retries) {
          throw new Error(`TCGdex ${path} → HTTP ${res.status}`);
        }
        await sleep(500 * 2 ** attempt);
      }
    });
  }

  return {
    listSets: async (lang) => (await get<TcgdexSetBrief[]>(`/${lang}/sets`))!,
    getSet: async (lang, id) => (await get<TcgdexSet>(`/${lang}/sets/${encodeURIComponent(id)}`))!,
    getCard: (lang, id) => get<TcgdexCard>(`/${lang}/cards/${encodeURIComponent(id)}`, true),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function semaphore(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    // Le créneau est transmis directement au suivant en file : `active` ne dépasse jamais `max`.
    if (active >= max) await new Promise<void>((r) => queue.push(r));
    else active++;
    try {
      return await fn();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}
