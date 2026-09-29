import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "./build";
import { layoutGraph, nodeRadius } from "./layout";

const nodes: GraphNode[] = [
  { id: "W", kind: "wallet", txCount: 10 },
  ...Array.from({ length: 12 }, (_, i) => ({ id: `C${i}`, kind: "counterparty" as const, txCount: i + 1 })),
];
const edges: GraphEdge[] = nodes.slice(1).map((n) => ({
  id: `${n.id}|W`,
  a: n.id,
  b: "W",
  kind: "interaction",
  interactions: Array.from({ length: n.txCount }, (_, i) => ({ signature: `${n.id}-${i}`, time: null, wallet: "W", kind: "SEND" as const, movements: [] })),
}));

describe("layoutGraph", () => {
  it("pins the wallet at the origin and is deterministic", () => {
    const a = layoutGraph(nodes, edges, "W");
    expect(a.get("W")).toEqual({ x: 0, y: 0 });
    expect([...layoutGraph(nodes, edges, "W")]).toEqual([...a]);
  });

  it("keeps nodes from overlapping", () => {
    const pos = layoutGraph(nodes, edges, "W");
    for (const a of nodes) {
      for (const b of nodes) {
        if (a.id >= b.id) continue;
        const p = pos.get(a.id)!;
        const q = pos.get(b.id)!;
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(nodeRadius(a) + nodeRadius(b));
      }
    }
  });

  it("uses a radial one-hop layout", () => {
    const pos = layoutGraph(nodes, edges, "W");
    const radii = nodes.slice(1).map((n) => Math.round(Math.hypot(pos.get(n.id)!.x, pos.get(n.id)!.y)));
    expect(new Set(radii)).toEqual(new Set([180]));
  });
});
