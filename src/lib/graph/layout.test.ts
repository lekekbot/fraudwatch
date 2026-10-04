import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "./build";
import { classifyLayout, layoutGraph, nodeRadius } from "./layout";

const movement = (from: string, to: string, signature: string) => ({
  signature,
  time: null,
  wallet: from,
  initiator: from,
  kind: "SEND" as const,
  movements: [{ from, to, assetId: "SOL", amount: "1" }],
});
const edge = (a: string, b: string, count = 1): GraphEdge => ({
  id: a + "|" + b,
  a,
  b,
  kind: "interaction",
  interactions: Array.from({ length: count }, (_, index) => movement(a, b, a + "-" + b + "-" + index)),
});

const nodes: GraphNode[] = [
  { id: "W", kind: "wallet", txCount: 10 },
  ...Array.from({ length: 12 }, (_, i) => ({ id: "C" + i, kind: "counterparty" as const, txCount: i + 1 })),
];
const edges = nodes.slice(1).map((node) => edge("W", node.id, node.txCount));

describe("layoutGraph", () => {
  it("keeps the primary near the core center and is deterministic", () => {
    const a = layoutGraph(nodes, edges, "W");
    expect(Math.hypot(a.get("W")!.x, a.get("W")!.y)).toBeLessThan(80);
    expect([...layoutGraph(nodes, edges, "W")]).toEqual([...a]);
  });

  it("keeps node circles from overlapping", () => {
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

  it("does not use transfer direction as global position", () => {
    const reversed = edges.map((item) => ({
      ...item,
      interactions: item.interactions.map((interaction) => ({
        ...interaction,
        movements: interaction.movements.map((movement) => ({ ...movement, from: movement.to, to: movement.from })),
      })),
    }));
    expect([...layoutGraph(nodes, reversed, "W")]).toEqual([...layoutGraph(nodes, edges, "W")]);
  });

  it("classifies mapped wallets, shared bridges, satellites and aggregates", () => {
    const mixedNodes: GraphNode[] = [
      { id: "A", kind: "wallet", txCount: 8 },
      { id: "B", kind: "wallet", txCount: 6 },
      { id: "C", kind: "wallet", txCount: 5 },
      { id: "X", kind: "counterparty", txCount: 4 },
      { id: "S", kind: "counterparty", txCount: 2 },
      { id: "__other_addresses__", kind: "aggregate", txCount: 20 },
    ];
    const roles = classifyLayout(mixedNodes, [edge("A", "B", 4), edge("B", "C", 3), edge("B", "X", 2), edge("C", "X", 2), edge("A", "S")]);

    expect(roles.get("A")).toBe("core");
    expect(roles.get("X")).toBe("bridge");
    expect(roles.get("S")).toBe("peripheral");
    expect(roles.get("__other_addresses__")).toBe("aggregate");
  });

  it("keeps satellites outside the mapped-wallet backbone", () => {
    const mixedNodes: GraphNode[] = [
      { id: "A", kind: "wallet", txCount: 8 },
      { id: "B", kind: "wallet", txCount: 6 },
      { id: "C", kind: "wallet", txCount: 5 },
      { id: "X", kind: "counterparty", txCount: 4 },
      { id: "S", kind: "counterparty", txCount: 2 },
    ];
    const mixedEdges = [edge("A", "B", 4), edge("B", "C", 3), edge("C", "A", 2), edge("B", "X", 2), edge("C", "X", 2), edge("A", "S")];
    const pos = layoutGraph(mixedNodes, mixedEdges, "A");
    const core = ["A", "B", "C"].map((id) => pos.get(id)!);
    const center = { x: core.reduce((sum, point) => sum + point.x, 0) / 3, y: core.reduce((sum, point) => sum + point.y, 0) / 3 };
    const coreExtent = Math.max(...core.map((point) => Math.hypot(point.x - center.x, point.y - center.y)));

    expect(Math.hypot(pos.get("S")!.x - center.x, pos.get("S")!.y - center.y)).toBeGreaterThan(coreExtent);
    expect(Math.hypot(pos.get("X")!.x - center.x, pos.get("X")!.y - center.y)).toBeLessThan(Math.hypot(pos.get("S")!.x - center.x, pos.get("S")!.y - center.y));
  });

  it("sizes counterparties by transaction count on a capped log scale", () => {
    const cp = (txCount: number) => nodeRadius({ id: "x", kind: "counterparty", txCount });
    expect([cp(1), cp(10), cp(100)]).toEqual([6, 11, 16]);
    expect(cp(50)).toBeGreaterThan(cp(40));
    expect(cp(1_000_000)).toBe(21);
  });

  it("puts secondary wallets beyond the primary's counterparties, at every spacing", () => {
    const wallets: GraphNode[] = [
      { id: "W", kind: "wallet", txCount: 40 },
      { id: "S", kind: "wallet", txCount: 10 },
      ...Array.from({ length: 14 }, (_, i) => ({ id: "C" + i, kind: "counterparty" as const, txCount: 14 - i })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: "D" + i, kind: "counterparty" as const, txCount: 4 - i })),
    ];
    const links = [edge("W", "S", 3), ...Array.from({ length: 14 }, (_, i) => edge("W", "C" + i)), ...Array.from({ length: 4 }, (_, i) => edge("S", "D" + i, 2))];
    const reach = (pos: Map<string, { x: number; y: number }>) => {
      const w = pos.get("W")!;
      const from = (id: string) => Math.hypot(pos.get(id)!.x - w.x, pos.get(id)!.y - w.y);
      return { secondary: from("S"), farthestOwn: Math.max(...Array.from({ length: 14 }, (_, i) => from("C" + i))) };
    };
    for (const spacing of [0.75, 1, 1.4, 1.9]) {
      const { secondary, farthestOwn } = reach(layoutGraph(wallets, links, "W", undefined, 220, spacing));
      expect(secondary).toBeGreaterThan(farthestOwn);
    }
    expect(reach(layoutGraph(wallets, links, "W", undefined, 220, 1.9)).secondary).toBeGreaterThan(reach(layoutGraph(wallets, links, "W", undefined, 220, 1)).secondary);
  });
});

