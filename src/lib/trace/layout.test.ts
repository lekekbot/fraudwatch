import { describe, expect, it } from "vitest";
import { autoPlace, snap, tidyLayout } from "./layout";
import type { TraceView } from "./view";

const node = (id: string, depth: number) => ({ id, addresses: [id], isSeed: depth === 0, depth, boundaries: [], conversions: [] });
const edge = (from: string, to: string) => ({ id: `${from}->${to}`, from, to, provenance: "observed" as const, steps: [], totals: [], firstTime: null, lastTime: null, returns: false });
const view: TraceView = { nodes: [node("A", 0), node("B", 1), node("C", 1), node("D", -1)], edges: [edge("A", "B"), edge("A", "C"), edge("D", "A")], issues: [] };

describe("trace placement", () => {
  it("places forward and backward nodes without moving saved positions or hitting obstacles", () => {
    const positions = { A: { x: 50, y: 10 } };
    const input = { view, positions, obstacles: [{ x: 190, y: -20, width: 200, height: 70 }] };
    const result = autoPlace(input);
    expect(result.A).toBeUndefined();
    expect(positions.A).toEqual({ x: 50, y: 10 });
    expect(result.B.x).toBeGreaterThan(positions.A.x);
    expect(result.C.x).toBeGreaterThan(positions.A.x);
    expect(result.D.x).toBeLessThan(positions.A.x);
    expect(result.B.y).not.toBe(result.C.y);
    expect(result).toEqual(autoPlace(input));
  });

  it("tidies by depth, and snaps to grid", () => {
    const positions = { A: { x: 900, y: 300 }, B: { x: -100, y: 40 } };
    const tidy = tidyLayout({ view, positions, obstacles: [] });
    expect(tidy.D.x).toBeLessThan(tidy.A.x);
    expect(tidy.B.x).toBeGreaterThan(tidy.A.x);
    expect(tidy).toEqual(tidyLayout({ view, positions, obstacles: [] }));
    expect(snap({ x: 35, y: -13 }, 24)).toEqual({ x: 24, y: -24 });
  });
});
