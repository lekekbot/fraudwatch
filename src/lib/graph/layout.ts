import { forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from "d3-force";
import type { GraphEdge, GraphNode } from "./build";

export type Point = { x: number; y: number };

/** Node radius in px: grows with the square root of its transaction count. */
export const nodeRadius = (n: GraphNode) => (n.kind === "wallet" ? 22 : Math.min(18, 7 + Math.sqrt(n.txCount) * 2));

/**
 * Force layout with the wallet pinned at the origin. Runs to completion up
 * front, so the same graph always lands in the same place (d3-force seeds
 * positions deterministically).
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], ticks = 300): Map<string, Point> {
  type SimNode = SimulationNodeDatum & { id: string; r: number };
  const simNodes: SimNode[] = nodes.map((n) => ({ id: n.id, r: nodeRadius(n), ...(n.kind === "wallet" ? { fx: 0, fy: 0 } : {}) }));
  // One link per connected pair, however many edges (directions, kinds) join them.
  const pairs = new Map<string, { source: string; target: string; weight: number }>();
  for (const e of edges) {
    const key = [e.source, e.target].sort().join("|");
    const p = pairs.get(key) ?? { source: e.source, target: e.target, weight: 0 };
    p.weight += e.signatures.length;
    pairs.set(key, p);
  }
  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string; weight: number }>([...pairs.values()])
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
