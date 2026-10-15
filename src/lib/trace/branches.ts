import type { Amount, BoundaryKind } from "./model";
import type { TraceEdge, TraceNode, TraceView } from "./view";

/**
 * Branches, hiding and focus over a built `TraceView` (see
 * docs/sprints/trace-graph/08). All of it is presentation: steps are never
 * dropped, only left undrawn.
 */

export type Branch = {
  root: string;
  direction: "forward" | "backward";
  /** Downstream nodes, without the root. */
  nodes: Set<string>;
  edges: Set<string>;
  /** Nodes closer to the seed that the branch leads back to. */
  returnsTo: Set<string>;
};

const hops = (node: TraceNode | undefined) => (node?.depth === null || node?.depth === undefined ? null : Math.abs(node.depth));

/** Forward from a node ahead of the seed, backward from one behind it; the seed and unconnected nodes have no branch. */
export function branchDirection(node: TraceNode): "forward" | "backward" | null {
  if (node.isSeed || node.depth === null || node.depth === 0) return null;
  return node.depth > 0 ? "forward" : "backward";
}

/**
 * The nodes reachable from `root` by steps directed away from the seed,
 * stopping at nodes closer to the seed than the root (so a return edge
 * doesn't make the whole trace a branch). Each node is visited once, so
 * cycles terminate.
 */
export function branchOf(view: TraceView, root: string, direction: "forward" | "backward"): Branch {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const limit = hops(byId.get(root)) ?? 0;
  const out = new Map<string, TraceEdge[]>();
  for (const edge of view.edges) {
    const key = direction === "forward" ? edge.from : edge.to;
    const list = out.get(key);
    if (list) list.push(edge);
    else out.set(key, [edge]);
  }
  const branch: Branch = { root, direction, nodes: new Set(), edges: new Set(), returnsTo: new Set() };
  const stack = [root];
  while (stack.length) {
    const at = stack.pop()!;
    for (const edge of out.get(at) ?? []) {
      branch.edges.add(edge.id);
      const next = direction === "forward" ? edge.to : edge.from;
      if (next === root || branch.nodes.has(next)) continue;
      const d = hops(byId.get(next));
      if (d !== null && d < limit) { branch.returnsTo.add(next); continue; }
      branch.nodes.add(next);
      stack.push(next);
    }
  }
  return branch;
}

export type BranchSummary = {
  steps: number;
  nodes: number;
  /** Per asset, the added steps only; never combined across assets. */
  totals: Amount[];
  firstTime: number | null;
  lastTime: number | null;
  boundaries: BoundaryKind[];
  returnsTo: string[];
};

/** Each step counted once: every step belongs to exactly one edge, so summing the branch's edges never walks a path twice. */
export function summarizeBranch(view: TraceView, branch: Branch): BranchSummary {
  const steps = new Set<string>();
  const totals = new Map<string, bigint>();
  const times: number[] = [];
  for (const edge of view.edges) {
    if (!branch.edges.has(edge.id)) continue;
    edge.steps.forEach((id) => steps.add(id));
    for (const t of edge.totals) totals.set(t.assetId, (totals.get(t.assetId) ?? 0n) + BigInt(t.amount));
    if (edge.firstTime !== null) times.push(edge.firstTime);
    if (edge.lastTime !== null) times.push(edge.lastTime);
  }
  const boundaries = new Set(view.nodes.filter((n) => branch.nodes.has(n.id)).flatMap((n) => n.boundaries));
  return {
    steps: steps.size,
    nodes: branch.nodes.size,
    totals: [...totals].map(([assetId, amount]) => ({ assetId, amount: amount.toString() })),
    firstTime: times.length ? Math.min(...times) : null,
    lastTime: times.length ? Math.max(...times) : null,
    boundaries: [...boundaries],
    returnsTo: [...branch.returnsTo].sort(),
  };
}

/**
 * From a node, the neighbours one hop further from the seed: along movements
 * ahead of the seed, against them behind it. Earliest edge first, so ties
 * resolve the same way every time.
 */
function outward(view: TraceView): Map<string, { to: string; edge: TraceEdge }[]> {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const next = new Map<string, { to: string; edge: TraceEdge }[]>();
  const add = (a: string, b: string, edge: TraceEdge) => {
    const list = next.get(a);
    if (list) list.push({ to: b, edge });
    else next.set(a, [{ to: b, edge }]);
  };
  const sorted = [...view.edges].sort((a, b) => (a.firstTime ?? Infinity) - (b.firstTime ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const edge of sorted) {
    if ((byId.get(edge.to)?.depth ?? 0) >= 0) add(edge.from, edge.to, edge);
    if ((byId.get(edge.from)?.depth ?? 0) <= 0) add(edge.to, edge.from, edge);
  }
  return next;
}

export type HiddenBranches = {
  /** The view without hidden nodes and the edges touching them. */
  view: TraceView;
  /** Per hidden root, how many of its branch's steps aren't drawn. */
  counts: Map<string, number>;
  /** Hidden node → the visible root a connector to it should be drawn to. */
  anchors: Map<string, string>;
};

/**
 * Hide each root's branch. A node in a hidden branch stays visible when the
 * seed reaches it without passing through a hidden root (a merge from a
 * visible path). Steps stay in the trace; only drawing changes.
 */
export function hideBranches(view: TraceView, hidden: readonly string[]): HiddenBranches {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const branches = hidden.flatMap((id) => {
    const node = byId.get(id);
    const direction = node && branchDirection(node);
    return direction ? [branchOf(view, id, direction)] : [];
  });
  if (!branches.length) return { view, counts: new Map(), anchors: new Map() };

  const inBranch = new Map<string, string>();
  for (const b of branches) for (const id of b.nodes) if (!inBranch.has(id)) inBranch.set(id, b.root);
  const roots = new Set(branches.map((b) => b.root));
  const next = outward(view);
  const reached = new Set(view.nodes.filter((n) => n.isSeed || n.depth === null).map((n) => n.id));
  const queue = [...reached];
  while (queue.length) {
    const at = queue.shift()!;
    for (const { to } of next.get(at) ?? []) {
      if (reached.has(to)) continue;
      // Leaving a hidden root into its own branch is the one blocked move.
      if (roots.has(at) && branches.some((b) => b.root === at && b.nodes.has(to))) continue;
      reached.add(to);
      queue.push(to);
    }
  }
  const gone = new Set([...inBranch.keys()].filter((id) => !reached.has(id)));
  const edges = view.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to));
  const drawn = new Set(edges.map((e) => e.id));
  const steps = new Map(view.edges.map((e) => [e.id, e.steps.length]));
  const counts = new Map(branches.map((b) => [b.root, [...b.edges].filter((id) => !drawn.has(id)).reduce((sum, id) => sum + (steps.get(id) ?? 0), 0)]));
  const anchors = new Map([...gone].map((id) => [id, inBranch.get(id)!]));
  return { view: { ...view, nodes: view.nodes.filter((n) => !gone.has(n.id)), edges }, counts, anchors };
}

/** The shortest path by steps from the seed to `target` (earliest edges win ties); null when no path reaches it. */
export function focusPath(view: TraceView, target: string): { nodes: Set<string>; edges: Set<string> } | null {
  const next = outward(view);
  const from = new Map<string, { node: string; edge: string } | null>(view.nodes.filter((n) => n.isSeed).map((n) => [n.id, null]));
  const queue = [...from.keys()];
  while (queue.length && !from.has(target)) {
    const at = queue.shift()!;
    for (const { to, edge } of next.get(at) ?? []) {
      if (from.has(to)) continue;
      from.set(to, { node: at, edge: edge.id });
      queue.push(to);
    }
  }
  if (!from.has(target)) return null;
  const path = { nodes: new Set([target]), edges: new Set<string>() };
  for (let link = from.get(target); link; link = from.get(link.node)) {
    path.nodes.add(link.node);
    path.edges.add(link.edge);
  }
  return path;
}
