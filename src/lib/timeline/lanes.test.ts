import { describe, expect, it } from "vitest";
import { mergeConnectors } from "./lanes";

const down = (from: number, to: number) => ({ from, to, directed: true });

describe("cross-lane trunks", () => {
  it("merges nearby transactions between different lanes into one trunk over all of them", () => {
    const [t, ...rest] = mergeConnectors([{ x: 0, connectors: [down(0, 1)] }, { x: 30, connectors: [down(2, 1), down(3, 1)] }], 40);
    expect(rest).toEqual([]);
    expect(t).toEqual({ x: 15, lanes: [0, 1, 2, 3], count: 2, direction: null });
  });

  it("keeps the arrow when every merged transaction moved value the same way", () => {
    expect(mergeConnectors([{ x: 0, connectors: [down(0, 1)] }, { x: 10, connectors: [down(1, 2)] }], 40)[0].direction).toBe(1);
    expect(mergeConnectors([{ x: 0, connectors: [down(2, 0)] }], 40)[0].direction).toBe(-1);
  });

  it("splits transactions further apart than the gap", () => {
    expect(mergeConnectors([{ x: 0, connectors: [down(0, 1)] }, { x: 41, connectors: [down(0, 1)] }], 40).map((t) => t.count)).toEqual([1, 1]);
  });
});
