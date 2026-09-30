import { forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from "d3-force";
import type { GraphEdge, GraphNode } from "./build";

export type Point = { x: number; y: number };

/** Wallet identity stays primary; interaction volume is shown in a separate badge. */
export const nodeRadius = (n: GraphNode) => (n.kind === "wallet" ? 16 : n.kind === "aggregate" ? 13 : n.kind === "program" ? 6 : 8);

function radialLayout(nodes: GraphNode[], edges: GraphEdge[], pinned: string): Map<string, Point> | null {
  const peers = nodes.filter((n) => n.id !== pinned && n.kind !== "aggregate");
  if (!nodes.some((n) => n.id === pinned) || edges.some((e) => e.a !== pinned && e.b !== pinned)) return null;
  if (peers.some((n) => !edges.some((e) => (e.a === pinned && e.b === n.id) || (e.b === pinned && e.a === n.id)))) return null;

  const direction = (id: string) => {
    let incoming = false;
    let outgoing = false;
    for (const edge of edges) {
      if (edge.a !== id && edge.b !== id) continue;
      for (const movement of edge.interactions.flatMap((it) => it.movements)) {
        incoming ||= movement.to === pinned;
        outgoing ||= movement.from === pinned;
      }
    }
    return incoming && outgoing ? 1 : incoming ? 0 : outgoing ? 2 : 3;
  };
  const ordered = nodes
    .filter((n) => n.id !== pinned)
    .sort((a, b) => (a.kind === "aggregate" ? 4 : direction(a.id)) - (b.kind === "aggregate" ? 4 : direction(b.id)) || b.txCount - a.txCount || a.id.localeCompare(b.id));
  const radius = Math.max(180, (ordered.length * 60) / (Math.PI * 2));
  const positions = new Map<string, Point>([[pinned, { x: 0, y: 0 }]]);
  ordered.forEach((node, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / Math.max(1, ordered.length);
    positions.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });
  return positions;
}

/**
 * Force layout with `pinned` (the selected wallet) at the origin. Runs to
 * completion up front, so the same graph always lands in the same place
 * (d3-force seeds positions deterministically).
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], pinned?: string, ticks = 300): Map<string, Point> {
  if (pinned) {
    const radial = radialLayout(nodes, edges, pinned);
    if (radial) return radial;
  }
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
