import { readFileSync } from "node:fs";
import type { TcgdexCard, TcgdexClient, TcgdexSet } from "../src";

const dir = new URL("./fixtures/", import.meta.url);
export const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, dir), "utf8")) as T;
export const card = (id: string) => fixture<TcgdexCard>(`card-fr-${id}.json`);

/** Client TCGdex hors ligne, alimenté par les réponses réelles enregistrées dans fixtures/. */
export function fakeClient(cards: TcgdexCard[], overrides: Partial<TcgdexClient> = {}): TcgdexClient {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return {
    listSets: async () => [],
    getSet: async (_lang, setId) => {
      const real = fixture<TcgdexSet>("set-fr-swsh3.json");
      const inSet = cards.filter((c) => c.set.id === setId);
      const first = inSet[0]?.set;
      return {
        ...(setId === real.id ? real : { id: setId, name: first?.name ?? setId, cardCount: first?.cardCount }),
        cards: inSet.map((c) => ({ id: c.id, localId: c.localId, name: c.name })),
      };
    },
    getCard: async (_lang, id) => structuredClone(byId.get(id)) ?? null,
    listSeries: async () => [],
    getSerie: async () => null,
    ...overrides,
  };
}
