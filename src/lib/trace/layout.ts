import type { Point } from "./presentation";
import type { TraceView } from "./view";

export type Rect = { x: number; y: number; width: number; height: number };
export type PlaceInput = {
  view: Pick<TraceView, "nodes" | "edges">;
  positions: Readonly<Record<string, Point>>;
  obstacles: readonly Rect[];
  spacing?: { column: number; row: number };
  grid?: number | null;
};

export function snap(p: Point, grid: number): Point {
  if (!Number.isFinite(grid) || grid <= 0) return p;
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 58;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const nodeRect = (p: Point): Rect => ({ x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2, width: NODE_WIDTH, height: NODE_HEIGHT });

/** Place missing evidence nodes only. Existing positions never move. */
export function autoPlace(input: PlaceInput): Record<string, Point> {
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

/** Explicit tidy action. Deterministic layers; only evidence nodes are returned. */
export function tidyLayout(input: PlaceInput): Record<string, Point> {
  const { column = 240, row = 72 } = input.spacing ?? {};
  const groups = new Map<number, string[]>();
  for (const node of input.view.nodes) {
    const depth = node.depth ?? 0;
    groups.set(depth, [...(groups.get(depth) ?? []), node.id]);
  }
  const depths = [...groups.keys()].sort((a, b) => a - b);
  for (const ids of groups.values()) ids.sort((a, b) => (input.positions[a]?.y ?? 0) - (input.positions[b]?.y ?? 0) || a.localeCompare(b));
  const adjacent = new Map<string, string[]>();
  for (const edge of input.view.edges) {
    adjacent.set(edge.from, [...(adjacent.get(edge.from) ?? []), edge.to]);
    adjacent.set(edge.to, [...(adjacent.get(edge.to) ?? []), edge.from]);
  }
  for (let sweep = 0; sweep < 4; sweep++) {
    const rank = new Map<string, number>();
    for (const ids of groups.values()) ids.forEach((id, i) => rank.set(id, i));
    for (const depth of sweep % 2 ? [...depths].reverse() : depths) {
      const ids = groups.get(depth)!;
      const score = (id: string) => {
        const neighbours = (adjacent.get(id) ?? []).map((other) => rank.get(other)).filter((n): n is number => n !== undefined);
        return neighbours.length ? neighbours.reduce((sum, n) => sum + n, 0) / neighbours.length : rank.get(id) ?? 0;
      };
      ids.sort((a, b) => score(a) - score(b) || a.localeCompare(b));
      ids.forEach((id, i) => rank.set(id, i));
    }
  }
  const result: Record<string, Point> = {};
  for (const depth of depths) {
    const ids = groups.get(depth)!;
    ids.forEach((id, i) => {
      const p = { x: depth * column, y: (i - (ids.length - 1) / 2) * row };
      result[id] = input.grid ? snap(p, input.grid) : p;
    });
  }
  return result;
}
