import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphEdge, GraphNode } from "./build";

export type Point = { x: number; y: number };
export type LayoutViewport = { width: number; height: number };
export type LayoutRole = "core" | "bridge" | "peripheral" | "aggregate";

/** Wallet identity stays primary; interaction volume is shown on relationships. */
/**
 * A counterparty's size says how many transactions it has, on a log scale (1 tx → 6, 10 → 11, 100 → 16, capped
 * at 21 from 1,000) so one busy address can't dwarf the rest. Absolute, so filtering doesn't resize nodes.
 */
export const nodeRadius = (node: GraphNode) =>
  node.kind === "wallet" ? 16 : node.kind === "aggregate" ? 13 : node.kind === "program" ? 6 : Math.min(21, 6 + 5 * Math.log10(Math.max(1, node.txCount)));

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const interactionCount = (edge: GraphEdge) => edge.summary?.totalInteractions ?? edge.interactions.length;
const edgeWeight = (edge: GraphEdge) => Math.log1p(interactionCount(edge));

export function classifyLayout(nodes: GraphNode[], edges: GraphEdge[]): Map<string, LayoutRole> {
  const core = new Set(nodes.filter((node) => node.kind === "wallet").map((node) => node.id));
  const coreConnections = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (core.has(edge.a) && !core.has(edge.b)) coreConnections.set(edge.b, new Set([...(coreConnections.get(edge.b) ?? []), edge.a]));
    if (core.has(edge.b) && !core.has(edge.a)) coreConnections.set(edge.a, new Set([...(coreConnections.get(edge.a) ?? []), edge.b]));
  }
  return new Map(
    nodes.map((node) => [
      node.id,
      node.kind === "wallet"
        ? "core"
        : node.kind === "aggregate"
          ? "aggregate"
          : node.kind === "counterparty" && (coreConnections.get(node.id)?.size ?? 0) >= 2
            ? "bridge"
            : "peripheral",
    ]),
  );
}

function stableAngle(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash / 0xffffffff) * Math.PI * 2 - Math.PI;
}

function crosses(a: Point, b: Point, c: Point, d: Point) {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

function coreOrder(nodes: GraphNode[], edges: GraphEdge[], primary: string) {
  const ids = new Set(nodes.map((node) => node.id));
  const neighbors = new Map<string, string[]>();
  for (const edge of edges) {
    if (!ids.has(edge.a) || !ids.has(edge.b)) continue;
    neighbors.set(edge.a, [...(neighbors.get(edge.a) ?? []), edge.b]);
    neighbors.set(edge.b, [...(neighbors.get(edge.b) ?? []), edge.a]);
  }
  for (const links of neighbors.values()) links.sort();
  const ordered: string[] = [];
  const seen = new Set<string>([primary]);
  const queue = [primary];
  for (const id of queue) {
    ordered.push(id);
    for (const next of neighbors.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) if (!seen.has(node.id)) ordered.push(node.id);
  return ordered;
}

function layoutCore(nodes: GraphNode[], edges: GraphEdge[], primary: string, viewport: LayoutViewport, ticks: number) {
  if (nodes.length === 1) return new Map([[nodes[0].id, { x: 0, y: 0 }]]);
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    degree.set(edge.a, (degree.get(edge.a) ?? 0) + interactionCount(edge));
    degree.set(edge.b, (degree.get(edge.b) ?? 0) + interactionCount(edge));
  }
  const orders = [
    [...nodes].sort((a, b) => a.id.localeCompare(b.id)).map((node) => node.id),
    [...nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id)).map((node) => node.id),
    coreOrder(nodes, edges, primary),
  ].filter((order, index, all) => all.findIndex((item) => item.join("|") === order.join("|")) === index);
  const radius = clamp(Math.min(viewport.width, viewport.height) * 0.22, 150, 260);
  const maxWeight = Math.max(1, ...edges.map(edgeWeight));
  const idealDistance = (edge: GraphEdge) => clamp(260 - (edgeWeight(edge) / maxWeight) * 100, 140, 260);
  let best = new Map<string, Point>();
  let bestScore = Infinity;

  for (const order of orders) {
    type CoreNode = SimulationNodeDatum & { id: string };
    type CoreLink = SimulationLinkDatum<CoreNode> & { ideal: number };
    const simNodes: CoreNode[] = order.map((id, index) => {
      const angle = -Math.PI / 2 + (index / order.length) * Math.PI * 2;
      return { id, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
    const links: CoreLink[] = edges.map((edge) => ({ source: edge.a, target: edge.b, ideal: idealDistance(edge) }));
    const simulation = forceSimulation(simNodes)
      .alpha(0.9)
      .alphaDecay(0.05)
      .velocityDecay(0.45)
      .force(
        "link",
        forceLink<CoreNode, CoreLink>(links)
          .id((node) => node.id)
          .distance((link) => link.ideal)
          .strength(0.65),
      )
      .force("charge", forceManyBody<CoreNode>().strength(-650))
      .force("x", forceX<CoreNode>(0).strength((node) => (node.id === primary ? 0.35 : 0.035)))
      .force("y", forceY<CoreNode>(0).strength((node) => (node.id === primary ? 0.35 : 0.035)))
      .force("collide", forceCollide<CoreNode>(86).iterations(2))
      .stop();
    simulation.tick(ticks);
    const positions = new Map(simNodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]));
    let score = Math.hypot(positions.get(primary)?.x ?? 0, positions.get(primary)?.y ?? 0) ** 2 * 4;
    for (const edge of edges) {
      const a = positions.get(edge.a)!;
      const b = positions.get(edge.b)!;
      score += (Math.hypot(a.x - b.x, a.y - b.y) - idealDistance(edge)) ** 2;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions.get(nodes[i].id)!;
        const b = positions.get(nodes[j].id)!;
        score += Math.max(0, 170 - Math.hypot(a.x - b.x, a.y - b.y)) ** 2 * 10;
      }
    }
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const a = edges[i];
        const b = edges[j];
        if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) continue;
        if (crosses(positions.get(a.a)!, positions.get(a.b)!, positions.get(b.a)!, positions.get(b.b)!)) score += 100_000;
      }
    }
    if (score < bestScore) {
      bestScore = score;
      best = positions;
    }
  }
  return best;
}

/** Core topology first, then shared bridges, owner satellites, aggregates, and one collision pass. */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  primary?: string,
  viewport: LayoutViewport = { width: 1100, height: 760 },
  ticks = 220,
): Map<string, Point> {
  if (!primary || !nodes.some((node) => node.id === primary)) return new Map(nodes.map((node, i) => [node.id, { x: (i % 8) * 110, y: Math.floor(i / 8) * 80 }]));

  const roles = classifyLayout(nodes, edges);
  const core = nodes.filter((node) => roles.get(node.id) === "core");
  const coreIds = new Set(core.map((node) => node.id));
  const coreEdges = edges.filter((edge) => coreIds.has(edge.a) && coreIds.has(edge.b));
  const targets = layoutCore(core, coreEdges, primary, viewport, ticks);
  const coreCenter = {
    x: core.reduce((sum, node) => sum + targets.get(node.id)!.x, 0) / core.length,
    y: core.reduce((sum, node) => sum + targets.get(node.id)!.y, 0) / core.length,
  };
  const coreExtent = Math.max(80, ...core.map((node) => Math.hypot(targets.get(node.id)!.x - coreCenter.x, targets.get(node.id)!.y - coreCenter.y)));
  const coreLinks = new Map<string, { id: string; weight: number }[]>();
  for (const edge of edges) {
    if (coreIds.has(edge.a) && !coreIds.has(edge.b)) coreLinks.set(edge.b, [...(coreLinks.get(edge.b) ?? []), { id: edge.a, weight: edgeWeight(edge) }]);
    if (coreIds.has(edge.b) && !coreIds.has(edge.a)) coreLinks.set(edge.a, [...(coreLinks.get(edge.a) ?? []), { id: edge.b, weight: edgeWeight(edge) }]);
  }

  for (const node of nodes.filter((item) => roles.get(item.id) === "bridge").sort((a, b) => a.id.localeCompare(b.id))) {
    const links = coreLinks.get(node.id) ?? [];
    const total = links.reduce((sum, link) => sum + link.weight, 0) || 1;
    const barycenter = {
      x: links.reduce((sum, link) => sum + targets.get(link.id)!.x * link.weight, 0) / total,
      y: links.reduce((sum, link) => sum + targets.get(link.id)!.y * link.weight, 0) / total,
    };
    let dx = barycenter.x - coreCenter.x;
    let dy = barycenter.y - coreCenter.y;
    if (Math.hypot(dx, dy) < 1) {
      const angle = stableAngle(node.id);
      dx = Math.cos(angle);
      dy = Math.sin(angle);
    }
    const length = Math.hypot(dx, dy);
    const push = links.length >= 3 ? 70 : 110;
    targets.set(node.id, { x: barycenter.x + (dx / length) * push, y: barycenter.y + (dy / length) * push });
  }

  const satellites = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (roles.get(node.id) !== "peripheral") continue;
    const links = coreLinks.get(node.id) ?? [];
    const owner = [...links].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))[0]?.id ?? primary;
    satellites.set(owner, [...(satellites.get(owner) ?? []), node]);
  }
  for (const [ownerId, group] of [...satellites].sort(([a], [b]) => a.localeCompare(b))) {
    const owner = targets.get(ownerId) ?? targets.get(primary)!;
    const ownerAngle = Math.hypot(owner.x - coreCenter.x, owner.y - coreCenter.y) < 40 ? stableAngle(ownerId) : Math.atan2(owner.y - coreCenter.y, owner.x - coreCenter.x);
    group.sort((a, b) => b.txCount - a.txCount || a.id.localeCompare(b.id));
    const rings = group.length <= 10 ? 1 : group.length <= 28 ? 2 : 3;
    const spread = Math.hypot(owner.x - coreCenter.x, owner.y - coreCenter.y) < 40 ? Math.PI * 2 : Math.min(Math.PI * 1.35, Math.PI / 2 + group.length * 0.06);
    group.forEach((node, index) => {
      const angle = ownerAngle - spread / 2 + ((index + 0.5) / group.length) * spread;
      const ring = index % rings;
      const distance = 190 + ring * 95;
      let target = { x: owner.x + Math.cos(angle) * distance, y: owner.y + Math.sin(angle) * distance };
      let dx = target.x - coreCenter.x;
      let dy = target.y - coreCenter.y;
      let fromCenter = Math.hypot(dx, dy);
      if (fromCenter < 1) {
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        fromCenter = 1;
      }
      const minDistance = coreExtent + 150 + ring * 45;
      if (fromCenter < minDistance) target = { x: coreCenter.x + (dx / fromCenter) * minDistance, y: coreCenter.y + (dy / fromCenter) * minDistance };
      targets.set(node.id, target);
    });
  }

  const aggregate = nodes.find((node) => roles.get(node.id) === "aggregate");
  if (aggregate) targets.set(aggregate.id, { x: coreCenter.x, y: coreCenter.y + coreExtent + Math.min(360, viewport.height * 0.38) });

  type SimNode = SimulationNodeDatum & { id: string; role: LayoutRole; targetX: number; targetY: number; footprint: number };
  const simNodes: SimNode[] = nodes.map((node) => {
    const role = roles.get(node.id) ?? "peripheral";
    const target = targets.get(node.id) ?? targets.get(primary)!;
    const footprint = role === "core" ? 86 : role === "bridge" ? 66 : role === "aggregate" ? 68 : node.kind === "program" ? 42 : 50;
    return {
      id: node.id,
      role,
      x: target.x,
      y: target.y,
      targetX: target.x,
      targetY: target.y,
      footprint,
      ...(role === "core" ? { fx: target.x, fy: target.y } : {}),
    };
  });
  const simulation = forceSimulation(simNodes)
    .alpha(0.8)
    .alphaDecay(0.08)
    .velocityDecay(0.55)
    .force("x", forceX<SimNode>((node) => node.targetX).strength((node) => (node.role === "bridge" ? 0.55 : 0.75)))
    .force("y", forceY<SimNode>((node) => node.targetY).strength((node) => (node.role === "bridge" ? 0.55 : 0.75)))
    .force("collide", forceCollide<SimNode>((node) => node.footprint).iterations(2))
    .stop();
  simulation.tick(160);
  return new Map(simNodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]));
}
