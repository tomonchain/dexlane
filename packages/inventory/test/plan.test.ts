import { describe, expect, it } from "vitest";
import { planAllocation, type CandidatePosition } from "../src";

const pos = (id: string, locationId: string, available: number, day: number): CandidatePosition => ({
  id,
  locationId,
  available,
  createdAt: new Date(2026, 0, day),
});

describe("planAllocation", () => {
  it("returns null when total availability is insufficient", () => {
    expect(planAllocation([pos("a", "L1", 1, 1), pos("b", "L2", 1, 2)], 3)).toBeNull();
  });

  it("prefers the oldest position that covers the full quantity on its own", () => {
    const plan = planAllocation([pos("new", "L1", 5, 10), pos("old", "L2", 5, 1)], 2);
    expect(plan).toEqual([{ stockItemId: "old", locationId: "L2", qty: 2 }]);
  });

  it("treats several positions in the same location as a single stop", () => {
    // L1 holds 2 + 2 = 4 across two positions; L2 holds 3. Qty 4 → only L1 covers it alone.
    const plan = planAllocation(
      [pos("a", "L1", 2, 1), pos("b", "L1", 2, 2), pos("c", "L2", 3, 0)],
      4,
    );
    expect(plan?.map((p) => p.locationId)).toEqual(["L1", "L1"]);
  });

  it("minimises locations when no single location suffices", () => {
    const plan = planAllocation(
      [pos("small1", "L1", 1, 1), pos("small2", "L2", 1, 2), pos("big", "L3", 4, 3)],
      5,
    );
    expect(plan).toEqual([
      { stockItemId: "big", locationId: "L3", qty: 4 },
      { stockItemId: "small1", locationId: "L1", qty: 1 },
    ]);
  });

  it("ignores positions with no availability", () => {
    expect(planAllocation([pos("a", "L1", 0, 1), pos("b", "L2", 1, 2)], 1)).toEqual([
      { stockItemId: "b", locationId: "L2", qty: 1 },
    ]);
  });

  it("rejects non-positive quantities", () => {
    expect(() => planAllocation([], 0)).toThrow();
  });
});
