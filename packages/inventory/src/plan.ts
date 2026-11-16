export interface CandidatePosition {
  id: string;
  locationId: string;
  available: number;
  createdAt: Date;
}

export interface PlannedAllocation {
  stockItemId: string;
  locationId: string;
  qty: number;
}

const fifo = (a: CandidatePosition, b: CandidatePosition) =>
  a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

/**
 * Choisit les positions à allouer pour `qty` unités (spec 4.2) :
 * 1. minimiser le nombre d'emplacements à visiter ;
 * 2. à nombre égal, privilégier le stock le plus ancien (FIFO).
 * Retourne `null` si la quantité disponible totale est insuffisante.
 */
export function planAllocation(positions: CandidatePosition[], qty: number): PlannedAllocation[] | null {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("qty must be a positive integer");

  const usable = positions.filter((p) => p.available > 0).sort(fifo);
  const total = usable.reduce((n, p) => n + p.available, 0);
  if (total < qty) return null;

  // Regroupement par emplacement, en conservant l'ordre FIFO à l'intérieur.
  const byLocation = new Map<string, CandidatePosition[]>();
  for (const p of usable) {
    const list = byLocation.get(p.locationId) ?? [];
    list.push(p);
    byLocation.set(p.locationId, list);
  }
  const groups = [...byLocation.values()].map((list) => ({
    positions: list,
    available: list.reduce((n, p) => n + p.available, 0),
    oldest: list[0]!,
  }));

  // Un seul emplacement suffit ? On prend le plus ancien parmi ceux qui suffisent.
  // Sinon : glouton par quantité décroissante (minimise le nombre d'emplacements), FIFO en cas d'égalité.
  const sufficient = groups.filter((g) => g.available >= qty).sort((a, b) => fifo(a.oldest, b.oldest));
  const ordered = sufficient.length
    ? [sufficient[0]!]
    : [...groups].sort((a, b) => b.available - a.available || fifo(a.oldest, b.oldest));

  const plan: PlannedAllocation[] = [];
  let remaining = qty;
  for (const group of ordered) {
    for (const p of group.positions) {
      if (remaining === 0) break;
      const take = Math.min(p.available, remaining);
      plan.push({ stockItemId: p.id, locationId: p.locationId, qty: take });
      remaining -= take;
    }
    if (remaining === 0) break;
  }
  return plan;
}
