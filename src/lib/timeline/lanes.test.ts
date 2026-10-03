import { describe, expect, it } from "vitest";
import { connectors, mergeLaneEvents, mergeConnectors } from "./lanes";

describe("mergeLaneEvents", () => {
  it("puts a transaction shared by two lanes once, at one time, with an entry per lane", () => {
    const events = mergeLaneEvents([
      [
        { signature: "a", time: 10, kind: "SEND" },
        { signature: "shared", time: 20, kind: "SEND" },
      ],
      [
        { signature: "shared", time: 20, kind: "RECEIVE" },
        { signature: "b", time: 5, kind: "RECEIVE" },
      ],
    ]);
    expect(events.map((e) => e.signature)).toEqual(["b", "a", "shared"]);
    expect(events[2].entries).toEqual([
      { kind: "SEND", lane: 0 },
      { kind: "RECEIVE", lane: 1 },
    ]);
  });

  it("breaks time ties by signature so the order is stable", () => {
    const events = mergeLaneEvents([[{ signature: "z", time: 1 }], [{ signature: "m", time: 1 }]]);
    expect(events.map((e) => e.signature)).toEqual(["m", "z"]);
  });
});

describe("connectors", () => {
  it("points from each lane that lost value to each that gained it, including loops back to earlier lanes", () => {
    expect(connectors([{ lane: 3, flow: "out" }, { lane: 0, flow: "in" }])).toEqual([{ from: 3, to: 0, directed: true }]);
  });

  it("joins adjacent lanes without arrows when the direction isn't clear", () => {
    expect(connectors([{ lane: 2, flow: "none" }, { lane: 0, flow: "none" }, { lane: 1, flow: "in" }])).toEqual([
      { from: 0, to: 1, directed: false },
      { from: 1, to: 2, directed: false },
    ]);
    expect(connectors([{ lane: 0, flow: "out" }])).toEqual([]);
  });
});

describe("mergeConnectors", () => {
  it("combines nearby connectors between the same lanes, the same way, with a count", () => {
    const merged = mergeConnectors(
      [
        { x: 100, from: 0, to: 1, directed: true },
        { x: 110, from: 0, to: 1, directed: true },
        { x: 104, from: 1, to: 0, directed: true },
        { x: 200, from: 0, to: 1, directed: true },
      ],
      24,
    );
    expect(merged).toEqual([
      { from: 0, to: 1, directed: true, x: 105, count: 2 },
      { from: 0, to: 1, directed: true, x: 200, count: 1 },
      { from: 1, to: 0, directed: true, x: 104, count: 1 },
    ]);
  });

  it("measures a run from its first connector, so a long chain still splits", () => {
    const merged = mergeConnectors([0, 20, 40, 60].map((x) => ({ x, from: 0, to: 2, directed: false })), 24);
    expect(merged.map((m) => m.count)).toEqual([2, 2]);
  });
});
