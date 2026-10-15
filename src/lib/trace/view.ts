import type { AddressState } from "@/lib/case/address-state";
import type { IngestionCoverage } from "@/lib/ingest/ingest";
import type { SemanticEvent } from "@/lib/semantic/events";
import type { RegistryEntry } from "@/lib/protocols/registry";
import { type Amount, type BoundaryKind, compareRefs, type EdgeProvenance, keyedFlows, type MovementRef, type Trace, type TraceStep } from "./model";

/** What `buildTraceView` reads; all of it already exists in the case workspace. */
export type TraceEvidence = {
  /** Current semantic events by signature. */
  events: ReadonlyMap<string, SemanticEvent>;
  /** Loaded history for a mapped wallet; null when the address isn't mapped. */
  coverage: (address: string) => IngestionCoverage | null;
  addressState: (address: string) => AddressState;
  isCustodial: (address: string) => boolean;
  serviceOf?: (address: string) => RegistryEntry | undefined;
  hasUserLabel?: (address: string) => boolean;
};

export type TraceNode = {
  /** The address (a collapsed service's `entity:<protocolId>` from Sprint 07). */
  id: string;
  addresses: string[];
  isSeed: boolean;
  /** Hops from the seed: negative backward, positive forward; null when no steps connect it to the seed. */
  depth: number | null;
  boundaries: BoundaryKind[];
  /** The investigator put this address on the trace (it may also have movements). */
  placed?: boolean;
  /** Conversion steps on this address. */
  conversions: string[];
  service?: { id: string; name: string; category: string };
  memberServiceId?: string;
  internalMovements?: string[];
};

export type TraceEdge = {
  /** `${from}->${to}`. */
  id: string;
  from: string;
  to: string;
  provenance: EdgeProvenance;
  /** Step ids, chronological. */
  steps: string[];
  /** Per asset, summed within one asset only. Totals of added steps, never a balance or "funds traced". */
  totals: Amount[];
  firstTime: number | null;
  lastTime: number | null;
  /** Points back toward the seed (a cycle or return). */
  returns: boolean;
  /** Real endpoints for every step, even when a service node is collapsed. */
  via?: { stepId: string; from: string; to: string }[];
};

export type TraceIssue =
  | { kind: "stale"; stepId: string; reason: "movement_changed" | "transaction_not_loaded" }
  | { kind: "out_of_scope"; stepId: string; reason: "asset" | "time" | "amount" | "hops" }
  /** A movement step that can't be an edge; kept in the trace, not drawn. */
  | { kind: "ignored"; stepId: string; reason: "unknown_side" | "self_transfer" };

export type TraceView = { nodes: TraceNode[]; edges: TraceEdge[]; issues: TraceIssue[] };

type MovementStep = Extract<TraceStep, { kind: "movement" }>;

/**
 * The trace as nodes and edges, read against current evidence. Pure: nothing
 * is dropped, merged into another movement or re-pointed. A step whose
 * movement is gone or changed is reported stale and still drawn from its
 * stored reference. Service expansion reads presentation; positions, styles and annotations do not affect evidence.
 */
export function buildTraceView(trace: Trace, evidence: TraceEvidence): TraceView {
  const issues: TraceIssue[] = [];
  const resolved: { step: MovementStep; ref: MovementRef }[] = [];
  const keysBySignature = new Map<string, Map<string, MovementRef>>();
  const currentRefs = (signature: string) => {
    let keys = keysBySignature.get(signature);
    if (!keys) {
      const event = evidence.events.get(signature);
      keys = new Map(event ? keyedFlows(event).map(({ ref }) => [ref.key, ref]) : []);
      keysBySignature.set(signature, keys);
    }
    return keys;
  };

  for (const step of trace.steps) {
    if (step.kind !== "movement") continue;
    let ref = step.ref;
    if (!evidence.events.has(ref.signature)) issues.push({ kind: "stale", stepId: step.id, reason: "transaction_not_loaded" });
    else {
      const current = currentRefs(ref.signature).get(ref.key);
      if (current) ref = current;
      else issues.push({ kind: "stale", stepId: step.id, reason: "movement_changed" });
    }
    if (ref.from === null || ref.to === null) issues.push({ kind: "ignored", stepId: step.id, reason: "unknown_side" });
    else if (ref.from === ref.to) issues.push({ kind: "ignored", stepId: step.id, reason: "self_transfer" });
    else resolved.push({ step, ref });
  }
  resolved.sort((a, b) => compareRefs(a.ref, b.ref));

  const addresses = new Set<string>();
  for (const { ref } of resolved) addresses.add(ref.from!).add(ref.to!);
  const conversions = new Map<string, string[]>();
  for (const step of trace.steps) {
    if (step.kind !== "conversion") continue;
    addresses.add(step.address);
    conversions.set(step.address, [...(conversions.get(step.address) ?? []), step.id]);
  }
  const roots = seedAddresses(trace, resolved);
  for (const r of roots) addresses.add(r);
  const placed = new Set(trace.addresses ?? []);
  for (const a of placed) addresses.add(a);

  const depth = depths(roots, resolved);

  const grouped = new Map<string, { step: MovementStep; ref: MovementRef }[]>();
  for (const r of resolved) {
    const id = `${r.ref.from}->${r.ref.to}`;
    const group = grouped.get(id);
    if (group) group.push(r);
    else grouped.set(id, [r]);
  }
  const edges: TraceEdge[] = [...grouped].map(([id, group]) => {
    const { from, to } = group[0].ref as { from: string; to: string };
    const totals = new Map<string, bigint>();
    for (const { ref } of group) totals.set(ref.assetId, (totals.get(ref.assetId) ?? 0n) + BigInt(ref.amount));
    const times = group.map((g) => g.ref.time).filter((t): t is number => t !== null);
    const [df, dt] = [depth.get(from), depth.get(to)];
    return {
      id,
      from,
      to,
      provenance: group.length > 1 ? "bundled" : "observed",
      steps: group.map((g) => g.step.id),
      totals: [...totals].map(([assetId, amount]) => ({ assetId, amount: amount.toString() })),
      firstTime: times.length ? Math.min(...times) : null,
      lastTime: times.length ? Math.max(...times) : null,
      // Value moves away from the seed going forward (0 → 1) and toward it going backward (-1 → 0).
      returns: df !== undefined && dt !== undefined && dt < df,
    };
  });

  const outgoing = new Set(resolved.map((r) => r.ref.from!));
  const incoming = new Set(resolved.map((r) => r.ref.to!));
  const nodes: TraceNode[] = [...addresses].sort().map((address) => {
    const d = depth.get(address) ?? null;
    const frontier =
      d !== null && ((trace.direction !== "backward" && d >= 0 && !outgoing.has(address)) || (trace.direction !== "forward" && d <= 0 && !incoming.has(address)));
    return {
      id: address,
      addresses: [address],
      isSeed: roots.includes(address),
      ...(placed.has(address) ? { placed: true } : {}),
      depth: d,
      boundaries: boundaries(address, frontier, evidence),
      conversions: conversions.get(address) ?? [],
    };
  });

  for (const { step, ref } of resolved) {
    const reason = outOfScope(trace, ref, Math.max(Math.abs(depth.get(ref.from!) ?? 0), Math.abs(depth.get(ref.to!) ?? 0)));
    if (reason) issues.push({ kind: "out_of_scope", stepId: step.id, reason });
  }
  return { ...foldServices(nodes, edges, trace, evidence), issues };
}

function foldServices(nodes: TraceNode[], edges: TraceEdge[], trace: Trace, evidence: TraceEvidence): Pick<TraceView, "nodes" | "edges"> {
  if (!evidence.serviceOf) return { nodes, edges };
  const expanded = new Set(trace.presentation.expandedServices);
  const idOf = (address: string) => {
    const entry = evidence.serviceOf?.(address);
    return entry && !expanded.has(entry.protocolId) && !evidence.hasUserLabel?.(address) && !["PRIMARY", "MAPPED"].includes(evidence.addressState(address)) ? `entity:${entry.protocolId}` : address;
  };
  const groupedNodes = new Map<string, TraceNode>();
  for (const node of nodes) {
    const id = idOf(node.id);
    const entry = id !== node.id ? evidence.serviceOf(node.id) : undefined;
    const previous = groupedNodes.get(id);
    if (!previous) groupedNodes.set(id, { ...node, id, service: entry ? { id: entry.protocolId, name: entry.protocolName, category: entry.category } : undefined, memberServiceId: evidence.serviceOf(node.id)?.protocolId, internalMovements: [] });
    else {
      previous.addresses.push(...node.addresses);
      previous.isSeed ||= node.isSeed;
      if (node.depth !== null && (previous.depth === null || Math.abs(node.depth) < Math.abs(previous.depth))) previous.depth = node.depth;
      previous.boundaries = [...new Set([...previous.boundaries, ...node.boundaries])];
      previous.conversions.push(...node.conversions);
    }
  }
  const groupedEdges = new Map<string, TraceEdge>();
  for (const edge of edges) {
    const from = idOf(edge.from), to = idOf(edge.to);
    if (from === to) { groupedNodes.get(from)?.internalMovements?.push(...edge.steps); continue; }
    const id = `${from}->${to}`;
    const via = edge.steps.map((stepId) => ({ stepId, from: edge.from, to: edge.to }));
    const previous = groupedEdges.get(id);
    if (!previous) groupedEdges.set(id, { ...edge, id, from, to, provenance: from !== edge.from || to !== edge.to ? "service" : edge.provenance, via });
    else {
      previous.steps.push(...edge.steps);
      previous.via?.push(...via);
      for (const total of edge.totals) {
        const existing = previous.totals.find((item) => item.assetId === total.assetId);
        if (existing) existing.amount = (BigInt(existing.amount) + BigInt(total.amount)).toString();
        else previous.totals.push({ ...total });
      }
      const times = [previous.firstTime, edge.firstTime].filter((time): time is number => time !== null);
      previous.firstTime = times.length ? Math.min(...times) : null;
      const last = [previous.lastTime, edge.lastTime].filter((time): time is number => time !== null);
      previous.lastTime = last.length ? Math.max(...last) : null;
      previous.returns ||= edge.returns;
      if (from !== edge.from || to !== edge.to) previous.provenance = "service";
    }
  }
  return { nodes: [...groupedNodes.values()], edges: [...groupedEdges.values()] };
}

/**
 * Where hop counting starts: the seed address; a seeded movement's sender (or
 * receiver when the sender is unknown); for a seeded transaction, the senders
 * of its steps, or the earliest step's sender when none of its movements were added.
 */
function seedAddresses(trace: Trace, resolved: readonly { ref: MovementRef }[]): string[] {
  const seed = trace.seed;
  if (seed.kind === "address") return [seed.address];
  if (seed.kind === "movement") {
    const end = seed.ref.from ?? seed.ref.to;
    return end ? [end] : [];
  }
  const own = [...new Set(resolved.filter((r) => r.ref.signature === seed.signature).map((r) => r.ref.from!))];
  if (own.length) return own.sort();
  return resolved.length ? [resolved[0].ref.from!] : [];
}

/**
 * Hops from the seed by breadth-first search over the steps, so every node
 * gets its smallest hop count. Following a movement from sender to receiver
 * adds one; following it back subtracts one. Steps are visited in
 * chronological order, which settles ties deterministically.
 */
function depths(roots: readonly string[], resolved: readonly { ref: MovementRef }[]): Map<string, number> {
  const next = new Map<string, { address: string; delta: number }[]>();
  const link = (a: string, b: string, delta: number) => {
    const list = next.get(a);
    if (list) list.push({ address: b, delta });
    else next.set(a, [{ address: b, delta }]);
  };
  for (const { ref } of resolved) {
    link(ref.from!, ref.to!, 1);
    link(ref.to!, ref.from!, -1);
  }
  const depth = new Map(roots.map((r) => [r, 0]));
  let frontier = [...roots];
  while (frontier.length) {
    const following: string[] = [];
    for (const address of frontier) {
      for (const n of next.get(address) ?? []) {
        if (depth.has(n.address)) continue;
        depth.set(n.address, depth.get(address)! + n.delta);
        following.push(n.address);
      }
    }
    frontier = following;
  }
  return depth;
}

/**
 * Why the trace can't go further from this address. Coverage boundaries apply
 * only where the trace currently ends (the frontier), so a mapped wallet in
 * the middle of a path isn't labelled "end of history".
 */
function boundaries(address: string, frontier: boolean, evidence: TraceEvidence): BoundaryKind[] {
  const out: BoundaryKind[] = [];
  if (evidence.isCustodial(address)) return ["custodial"];
  if (!frontier) return out;
  const coverage = evidence.coverage(address);
  if (coverage) out.push(coverage.complete ? "end_of_history" : "partial_history");
  else if (evidence.addressState(address) !== "INFRASTRUCTURE") out.push("history_not_loaded");
  return out;
}

function outOfScope(trace: Trace, ref: MovementRef, hops: number): "asset" | "time" | "amount" | "hops" | null {
  const { assets, start, end, minAmount, maxHops } = trace.scope;
  if (assets && !assets.includes(ref.assetId)) return "asset";
  if (ref.time !== null && ((start && ref.time < Date.parse(start)) || (end && ref.time > Date.parse(end)))) return "time";
  if (minAmount && minAmount.assetId === ref.assetId && BigInt(ref.amount) < BigInt(minAmount.amount)) return "amount";
  if (hops > maxHops) return "hops";
  return null;
}
