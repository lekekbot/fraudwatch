import { forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from "d3-force";
import type { GraphEdge, GraphNode } from "./build";

export type Point = { x: number; y: number };

/** Node radius in px: mapped wallets are largest; others grow with the square root of their transaction count. */
export const nodeRadius = (n: GraphNode) => (n.kind === "wallet" ? 20 : Math.min(18, 7 + Math.sqrt(n.txCount) * 2));

/**
 * Force layout with `pinned` (the selected wallet) at the origin. Runs to
 * completion up front, so the same graph always lands in the same place
 * (d3-force seeds positions deterministically).
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], pinned?: string, ticks = 300): Map<string, Point> {
  type SimNode = SimulationNodeDatum & { id: string; r: number };
  const simNodes: SimNode[] = nodes.map((n) => ({ id: n.id, r: nodeRadius(n), ...(n.id === pinned ? { fx: 0, fy: 0 } : {}) }));
  // Connections are already one per pair; busier ones pull closer.
  const pairs = edges.map((e) => ({ source: e.a, target: e.b, weight: e.interactions.length }));
  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string; weight: number }>(pairs)
        .id((d) => d.id)
        // Busier relationships sit closer to the wallet.
        .distance((l) => 240 - Math.min(100, Math.log2(l.weight + 1) * 20)),
    )
    .force("charge", forceManyBody().strength(-600))
    // Room for the label under each node.
    .force("collide", forceCollide<SimNode>((d) => d.r + 40))
    .stop();
  simulation.tick(ticks);
  return new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
}
