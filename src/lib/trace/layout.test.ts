import { describe, expect, it } from "vitest";
import { autoPlace, type PlaceInput, type Rect, snap, tidyLayout } from "./layout";
import type { Point } from "./presentation";
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

  it("matches the original placement exactly (Sprint 10 optimisation)", () => {
    const shapes: TraceView[] = [
      { nodes: [node("H", 0), ...Array.from({ length: 60 }, (_, i) => node(`O${i}`, 1))], edges: Array.from({ length: 60 }, (_, i) => edge("H", `O${i}`)), issues: [] },
      { nodes: [node("S", 0), node("K", 1), ...Array.from({ length: 40 }, (_, i) => node(`I${i}`, 0))], edges: [edge("S", "K"), ...Array.from({ length: 40 }, (_, i) => edge(`I${i}`, "K"))], issues: [] },
      { nodes: Array.from({ length: 30 }, (_, i) => node(`R${i}`, i < 15 ? i : 30 - i)), edges: Array.from({ length: 30 }, (_, i) => edge(`R${i}`, `R${(i + 1) % 30}`)), issues: [] },
      { nodes: [...view.nodes, node("X", 3), node("Y", -2)], edges: view.edges, issues: [] },
    ];
    for (const shape of shapes) {
      const ids = shape.nodes.map((n) => n.id);
      const positions = Object.fromEntries(ids.filter((_, i) => i % 4 === 1).map((id, i) => [id, { x: (i % 3) * 240, y: i * 50 - 100 }]));
      const obstacles = [{ x: 150, y: 20, width: 200, height: 90 }];
      for (const input of [{ view: shape, positions: {}, obstacles: [] }, { view: shape, positions, obstacles }, { view: shape, positions, obstacles, grid: 24 }]) {
        expect(autoPlace(input)).toEqual(referenceAutoPlace(input));
      }
    }
  });
});

// The placement as it was before the Sprint 10 spatial index, kept to prove the optimisation changes no output.
const NODE_WIDTH = 180;
const NODE_HEIGHT = 58;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const nodeRect = (p: Point): Rect => ({ x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2, width: NODE_WIDTH, height: NODE_HEIGHT });
function referenceAutoPlace(input: PlaceInput): Record<string, Point> {
  const { column = 240, row = 72 } = input.spacing ?? {};
  const placed: Record<string, Point> = { ...input.positions };
  const result: Record<string, Point> = {};
  const free = (p: Point) => !input.obstacles.some((o) => overlaps(nodeRect(p), o)) && !Object.values(placed).some((q) => overlaps(nodeRect(p), nodeRect(q)));
  const settle = (base: Point): Point => {
    for (let n = 0; ; n++) {
      const offset = n === 0 ? 0 : Math.ceil(n / 2) * (n % 2 ? 1 : -1);
      const candidate = input.grid ? snap({ x: base.x, y: base.y + offset * row }, input.grid) : { x: base.x, y: base.y + offset * row };
      if (free(candidate)) return candidate;
    }
  };
  const remaining = new Set(input.view.nodes.map((n) => n.id).filter((id) => !placed[id]));
  while (remaining.size) {
    let progressed = false;
    for (const node of input.view.nodes) {
      if (!remaining.has(node.id)) continue;
      const parent = input.view.edges.find((e) => (e.to === node.id && placed[e.from]) || (e.from === node.id && placed[e.to]));
      if (!parent && Object.keys(placed).length && [...remaining].some((id) => input.view.edges.some((e) => (e.to === id && placed[e.from]) || (e.from === id && placed[e.to])))) continue;
      const origin = parent ? placed[parent.to === node.id ? parent.from : parent.to] : { x: 0, y: 0 };
      const base = parent ? { x: origin.x + (parent.to === node.id ? column : -column), y: origin.y } : { x: (node.depth ?? 0) * column, y: 0 };
      const at = settle(base);
      placed[node.id] = at;
      result[node.id] = at;
      remaining.delete(node.id);
      progressed = true;
    }
    if (!progressed) break;
  }
  return result;
}
