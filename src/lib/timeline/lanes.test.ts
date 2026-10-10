import { describe, expect, it } from "vitest";
import type { EventCategory } from "@/lib/semantic/events";
import { mergeConnectors, withoutCategories } from "./lanes";

const down = (from: number, to: number) => ({ from, to, directed: true });

describe("cross-lane trunks", () => {
  it("merges nearby transactions between different lanes into one trunk over all of them", () => {
    const [t, ...rest] = mergeConnectors([{ x: 0, connectors: [down(0, 1)] }, { x: 30, connectors: [down(2, 1), down(3, 1)] }], 40);
    expect(rest).toEqual([]);
    expect(t).toEqual({ x: 15, lanes: [0, 1, 2, 3], count: 2, arrivals: [{ lane: 1, direction: -1 }, { lane: 1, direction: 1 }] });
  });

  it("arrows every lane that received value, the way it came, even when merged transactions go both ways", () => {
    expect(mergeConnectors([{ x: 0, connectors: [down(0, 1)] }, { x: 10, connectors: [down(1, 2)] }], 40)[0].arrivals).toEqual([
      { lane: 1, direction: 1 },
      { lane: 2, direction: 1 },
    ]);
    expect(mergeConnectors([{ x: 0, connectors: [down(2, 0)] }], 40)[0].arrivals).toEqual([{ lane: 0, direction: -1 }]);
    expect(mergeConnectors([{ x: 0, connectors: [down(0, 3)] }, { x: 10, connectors: [down(3, 0)] }], 40)[0].arrivals).toEqual([
      { lane: 0, direction: -1 },
      { lane: 3, direction: 1 },
    ]);
  });

  it("draws no arrow for connectors without a direction", () => {
    expect(mergeConnectors([{ x: 0, connectors: [{ from: 0, to: 1, directed: false }] }], 40)[0].arrivals).toEqual([]);
  });

  it("splits transactions further apart than the gap", () => {
    expect(mergeConnectors([{ x: 0, connectors: [down(0, 1)] }, { x: 41, connectors: [down(0, 1)] }], 40).map((t) => t.count)).toEqual([1, 1]);
  });
});

describe("leaving categories off the timeline", () => {
  const events = [
    { signature: "a", entries: [0, 1] },
    { signature: "b", entries: [0] },
    { signature: "c", entries: [1] },
    { signature: "d", entries: [0] },
  ];
  const categories: Record<string, EventCategory> = { a: "NFT_TRADE", b: "PROGRAM_INTERACTION", c: "TRANSFER", d: "PROGRAM_INTERACTION" };

  it("leaves out whole transactions, even shared ones, keeps order, and counts what it left out", () => {
    const { shown, counts } = withoutCategories(events, (s) => categories[s], new Set<EventCategory>(["PROGRAM_INTERACTION", "NFT_TRADE"]));
    expect(shown.map((e) => e.signature)).toEqual(["c"]);
    expect(Object.fromEntries(counts)).toEqual({ NFT_TRADE: 1, PROGRAM_INTERACTION: 2 });
  });

  it("returns the same list when nothing is hidden, and keeps transactions it can't categorise", () => {
    expect(withoutCategories(events, (s) => categories[s], new Set()).shown).toBe(events);
    expect(withoutCategories(events, () => undefined, new Set<EventCategory>(["TRANSFER"])).shown).toEqual(events);
  });
});
