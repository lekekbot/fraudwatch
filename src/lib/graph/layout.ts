import { forceCollide, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import type { GraphEdge, GraphNode } from "./build";

export type Point = { x: number; y: number };
export type LayoutRole = "core" | "bridge" | "peripheral" | "aggregate";

/** Wallet identity stays primary; interaction volume is shown on relationships. */
/**
 * A counterparty's size says how many transactions it has, on a log scale (1 tx → 6, 10 → 11, 100 → 16, capped
 * at 21 from 1,000) so one busy address can't dwarf the rest. Absolute, so filtering doesn't resize nodes.
 */
export const nodeRadius = (node: GraphNode) =>
  node.kind === "wallet" ? 16 : node.kind === "aggregate" ? 13 : node.kind === "program" ? 6 : Math.min(21, 6 + 5 * Math.log10(Math.max(1, node.txCount)));

const interactionCount = (edge: GraphEdge) => edge.summary.totalInteractions;
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
          : (node.kind === "counterparty" || node.kind === "entity") && (coreConnections.get(node.id)?.size ?? 0) >= 2
            ? "bridge"
            : "peripheral",
    ]),
  );
}

/** A fixed 32-bit number for a string: stable positions, sides and seeds without randomness. */
export function hashId(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

const stableAngle = (id: string) => (hashId(id) / 0xffffffff) * Math.PI * 2 - Math.PI;

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

/**
 * Mapped wallets: the primary at the centre, the others evenly around it in link order, so wallets that deal
 * with each other sit side by side. Only their directions matter: the caller pushes them out past the
 * primary's own counterparties.
 */
function layoutCore(nodes: GraphNode[], edges: GraphEdge[], primary: string): Map<string, Point> {
  const others = coreOrder(nodes, edges, primary).filter((id) => id !== primary);
  // One or two hang below the primary; more go all the way round.
  const step = (Math.PI * 2) / Math.max(3, others.length);
  return new Map([
    [primary, { x: 0, y: 0 }],
    ...others.map((id, i): [string, Point] => {
      const angle = Math.PI / 2 + (i - (others.length - 1) / 2) * step;
      return [id, { x: Math.cos(angle) * 200, y: Math.sin(angle) * 200 }];
    }),
  ]);
}

/** How far apart the graph is drawn: 1 is the default; larger spreads every ring and gap. */
export const SPACINGS = { compact: 0.75, normal: 1, wide: 1.4, widest: 1.9 } as const;
export type Spacing = keyof typeof SPACINGS;

/** Distance from a wallet to its ring of counterparties: innermost, and between rings. */
const RING = 190;
const RING_STEP = 95;
const ringsFor = (count: number) => (count <= 10 ? 1 : count <= 28 ? 2 : 3);

/**
 * Core topology first, then shared bridges, owner satellites, aggregates, and one collision pass.
 * Secondary wallets sit beyond the primary's own counterparties, with room for theirs; `spacing` scales it all.
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  primary?: string,
  spacing = 1,
): Map<string, Point> {
  // With the primary's lane hidden it can still appear as another wallet's counterparty: anchor on a shown wallet.
  if (!nodes.some((node) => node.id === primary && node.kind === "wallet")) primary = nodes.filter((node) => node.kind === "wallet").map((node) => node.id).sort()[0];
  if (!primary) return new Map(nodes.map((node, i) => [node.id, { x: (i % 8) * 110, y: Math.floor(i / 8) * 80 }]));

  const roles = classifyLayout(nodes, edges);
  const core = nodes.filter((node) => roles.get(node.id) === "core");
  const coreIds = new Set(core.map((node) => node.id));
  const coreEdges = edges.filter((edge) => coreIds.has(edge.a) && coreIds.has(edge.b));
  const targets = layoutCore(core, coreEdges, primary);
  const coreLinks = new Map<string, { id: string; weight: number }[]>();
  for (const edge of edges) {
    if (coreIds.has(edge.a) && !coreIds.has(edge.b)) coreLinks.set(edge.b, [...(coreLinks.get(edge.b) ?? []), { id: edge.a, weight: edgeWeight(edge) }]);
    if (coreIds.has(edge.b) && !coreIds.has(edge.a)) coreLinks.set(edge.a, [...(coreLinks.get(edge.a) ?? []), { id: edge.b, weight: edgeWeight(edge) }]);
  }
  const satellites = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (roles.get(node.id) !== "peripheral") continue;
    const links = coreLinks.get(node.id) ?? [];
    const owner = [...links].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))[0]?.id ?? primary;
    satellites.set(owner, [...(satellites.get(owner) ?? []), node]);
  }

  // Secondary wallets go beyond the primary's outermost ring of counterparties, keeping their direction, so the
  // primary's cluster and each secondary's own cluster don't overlap.
  const origin = targets.get(primary)!;
  const primaryReach = (RING + (ringsFor(satellites.get(primary)?.length ?? 0) - 1) * RING_STEP) * spacing;
  for (const node of core) {
    if (node.id === primary) continue;
    const at = targets.get(node.id)!;
    let dx = at.x - origin.x;
    let dy = at.y - origin.y;
    let length = Math.hypot(dx, dy);
    if (length < 1) {
      const angle = stableAngle(node.id);
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      length = 1;
    }
    const wanted = Math.max(length * spacing, primaryReach + RING * spacing);
    targets.set(node.id, { x: origin.x + (dx / length) * wanted, y: origin.y + (dy / length) * wanted });
  }
  const coreCenter = {
    x: core.reduce((sum, node) => sum + targets.get(node.id)!.x, 0) / core.length,
    y: core.reduce((sum, node) => sum + targets.get(node.id)!.y, 0) / core.length,
  };
  const coreExtent = Math.max(80, ...core.map((node) => Math.hypot(targets.get(node.id)!.x - coreCenter.x, targets.get(node.id)!.y - coreCenter.y)));

  // Shared counterparties sit between the wallets they connect: at the midpoint of two, the centroid of more,
  // never weighted toward the busier wallet (that dragged them behind it, with lines crossing the whole map).
  // Each wallet set's group is a row across the line between its wallets (lines along that line would lie on
  // top of each other), wrapping into further rows toward either wallet; busiest nearest the middle.
  const bridgeGroups = new Map<string, GraphNode[]>();
  for (const node of nodes.filter((item) => roles.get(item.id) === "bridge")) {
    const key = [...new Set((coreLinks.get(node.id) ?? []).map((link) => link.id))].sort().join("|");
    bridgeGroups.set(key, [...(bridgeGroups.get(key) ?? []), node]);
  }
  const gap = 64 * spacing;
  for (const [key, group] of [...bridgeGroups].sort(([a], [b]) => a.localeCompare(b))) {
    const ends = key.split("|").map((id) => targets.get(id)!);
    const center = { x: ends.reduce((sum, p) => sum + p.x, 0) / ends.length, y: ends.reduce((sum, p) => sum + p.y, 0) / ends.length };
    // Along: the axis between two wallets (or a fixed direction for more); across: perpendicular to it, where the row runs.
    const axisAngle = ends.length === 2 ? Math.atan2(ends[1].y - ends[0].y, ends[1].x - ends[0].x) : stableAngle(key);
    const along = { x: Math.cos(axisAngle), y: Math.sin(axisAngle) };
    const across = { x: -along.y, y: along.x };
    // A row as wide as the wallets are apart; further rows step toward the wallets.
    const room = ends.length === 2 ? Math.hypot(ends[1].x - ends[0].x, ends[1].y - ends[0].y) : 2 * Math.min(...ends.map((p) => Math.hypot(p.x - center.x, p.y - center.y)));
    const perRow = Math.max(1, Math.min(group.length, Math.floor(room / gap)));
    group.sort((a, b) => b.txCount - a.txCount || a.id.localeCompare(b.id));
    group.forEach((node, index) => {
      const column = (index % perRow) - (perRow - 1) / 2;
      const row = Math.floor(index / perRow);
      const side = row === 0 ? 0 : (row % 2 ? 1 : -1) * Math.ceil(row / 2);
      targets.set(node.id, { x: center.x + across.x * column * gap + along.x * side * gap, y: center.y + across.y * column * gap + along.y * side * gap });
    });
  }

  for (const [ownerId, group] of [...satellites].sort(([a], [b]) => a.localeCompare(b))) {
    const owner = targets.get(ownerId) ?? targets.get(primary)!;
    const ownerAngle = Math.hypot(owner.x - coreCenter.x, owner.y - coreCenter.y) < 40 ? stableAngle(ownerId) : Math.atan2(owner.y - coreCenter.y, owner.x - coreCenter.x);
    group.sort((a, b) => b.txCount - a.txCount || a.id.localeCompare(b.id));
    const rings = ringsFor(group.length);
    const spread = Math.hypot(owner.x - coreCenter.x, owner.y - coreCenter.y) < 40 ? Math.PI * 2 : Math.min(Math.PI * 1.35, Math.PI / 2 + group.length * 0.06);
    group.forEach((node, index) => {
      const angle = ownerAngle - spread / 2 + ((index + 0.5) / group.length) * spread;
      const ring = index % rings;
      const distance = (RING + ring * RING_STEP) * spacing;
      let target = { x: owner.x + Math.cos(angle) * distance, y: owner.y + Math.sin(angle) * distance };
      // Keep clear of the other wallets: a counterparty stays with its own wallet's cluster.
      for (const other of core) {
        if (other.id === ownerId) continue;
        const at = targets.get(other.id)!;
        const dx = target.x - at.x;
        const dy = target.y - at.y;
        const gap = Math.hypot(dx, dy);
        const clear = RING * 0.8 * spacing;
        if (gap < clear) target = gap < 1 ? { x: at.x + clear, y: at.y } : { x: at.x + (dx / gap) * clear, y: at.y + (dy / gap) * clear };
      }
      targets.set(node.id, target);
    });
  }

  // Clusters sit in one row just below everything else, in their fixed order.
  const aggregates = nodes.filter((node) => roles.get(node.id) === "aggregate");
  const bottom = Math.max(coreCenter.y + coreExtent, ...nodes.filter((node) => roles.get(node.id) !== "aggregate").map((node) => targets.get(node.id)?.y ?? -Infinity));
  aggregates.forEach((node, i) => targets.set(node.id, { x: coreCenter.x + (i - (aggregates.length - 1) / 2) * 150, y: bottom + 110 * spacing }));

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

/** How much detail the map draws at a zoom level: far keeps the case's skeleton, close shows everything. */
export type ZoomTier = "far" | "medium" | "close";

/**
 * The detail tier for zoom `k`, given the current one. Each boundary has a gap (enter at one scale, leave at
 * another), so labels don't flicker while zooming across it.
 */
export function zoomTier(current: ZoomTier, k: number): ZoomTier {
  if (current === "far") return k > 0.6 ? zoomTier("medium", k) : "far";
  if (current === "close") return k < 1.15 ? zoomTier("medium", k) : "close";
  return k < 0.5 ? "far" : k > 1.3 ? "close" : "medium";
}

/** The relationships still drawn at far zoom: the busiest quarter (at least 10), plus every line between mapped wallets or to a service. */
export function majorEdges(nodes: GraphNode[], edges: GraphEdge[]): Set<string> {
  const ids = (kind: GraphNode["kind"]) => new Set(nodes.filter((node) => node.kind === kind).map((node) => node.id));
  const wallets = ids("wallet");
  const services = ids("entity");
  const ranked = edges.filter((edge) => edge.kind === "interaction").sort((x, y) => interactionCount(y) - interactionCount(x) || x.id.localeCompare(y.id));
  return new Set([
    ...ranked.slice(0, Math.max(10, Math.ceil(ranked.length / 4))),
    ...ranked.filter((edge) => (wallets.has(edge.a) && wallets.has(edge.b)) || services.has(edge.a) || services.has(edge.b)),
  ].map((edge) => edge.id));
}
