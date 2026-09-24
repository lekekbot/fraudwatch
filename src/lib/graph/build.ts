import { registry } from "@/lib/protocols/registry";
import type { WalletTransactionEffect } from "@/lib/state/reconstruct";
import type { EffectSummary } from "@/lib/state/summarize";

/**
 * A node-link view of one wallet's transactions: who it exchanged value with,
 * who sent transactions for it, and which programs it used. Everything is
 * aggregated per pair, so a thousand transfers to one address is one edge.
 */

export type GraphNodeKind = "wallet" | "counterparty" | "program";

export type GraphNode = { id: string; kind: GraphNodeKind; txCount: number };

/**
 * flow: value moved from `source` to `target` (amounts are what the
 * counterparty's own balance did). sent_by: `source` paid for a transaction
 * that touched the wallet. program: the wallet's transaction called `target`.
 */
export type GraphEdgeKind = "flow" | "sent_by" | "program";

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  /** Chronological. */
  signatures: string[];
  /** flow edges: base-unit totals per asset, largest count first. */
  totals: { assetId: string; amount: string }[];
  first: number | null;
  last: number | null;
};

export type WalletGraph = { nodes: GraphNode[]; edges: GraphEdge[]; omittedNodes: number };

export const MAX_GRAPH_NODES = 150;

const abs = (v: bigint) => (v < BigInt(0) ? -v : v);

export function buildWalletGraph(
  wallet: string,
  effects: WalletTransactionEffect[],
  summaries: EffectSummary[],
  maxNodes = MAX_GRAPH_NODES,
): WalletGraph {
  type Acc = Omit<GraphEdge, "totals"> & { sums: Map<string, bigint> };
  const edges = new Map<string, Acc>();
  const nodeTx = new Map<string, Set<string>>([[wallet, new Set()]]);
  const kinds = new Map<string, GraphNodeKind>([[wallet, "wallet"]]);

  const touch = (id: string, kind: GraphNodeKind, signature: string) => {
    if (!kinds.has(id)) kinds.set(id, kind);
    if (!nodeTx.has(id)) nodeTx.set(id, new Set());
    nodeTx.get(id)!.add(signature);
  };
  const add = (source: string, target: string, kind: GraphEdgeKind, e: WalletTransactionEffect, asset?: { id: string; amount: bigint }) => {
    const id = `${kind}:${source}>${target}`;
    let edge = edges.get(id);
    if (!edge) {
      edge = { id, source, target, kind, signatures: [], sums: new Map(), first: null, last: null };
      edges.set(id, edge);
    }
    if (edge.signatures[edge.signatures.length - 1] !== e.signature) edge.signatures.push(e.signature);
    if (asset) edge.sums.set(asset.id, (edge.sums.get(asset.id) ?? BigInt(0)) + asset.amount);
    const t = e.timestamp ? Date.parse(e.timestamp) : null;
    if (t !== null) {
      edge.first = edge.first === null ? t : Math.min(edge.first, t);
      edge.last = edge.last === null ? t : Math.max(edge.last, t);
    }
  };

  effects.forEach((e, i) => {
    const s = summaries[i];
    nodeTx.get(wallet)!.add(e.signature);
    for (const cp of s.counterparties) {
      if (cp.address === wallet) continue;
      touch(cp.address, "counterparty", e.signature);
      const amount = abs(BigInt(cp.delta));
      // The counterparty lost what the wallet gained, and the reverse.
      if (cp.delta.startsWith("-")) add(cp.address, wallet, "flow", e, { id: cp.assetId, amount });
      else add(wallet, cp.address, "flow", e, { id: cp.assetId, amount });
    }
    if (s.actor && s.actor !== wallet) {
      touch(s.actor, "counterparty", e.signature);
      add(s.actor, wallet, "sent_by", e);
    }
    // Core programs (system, token, compute budget) would connect to everything.
    const program = s.action?.programId;
    if (program && s.kind !== "ACCOUNT" && registry.lookup(program)?.category !== "core") {
      touch(program, "program", e.signature);
      add(wallet, program, "program", e);
    }
  });

  const ranked = [...nodeTx]
    .filter(([id]) => id !== wallet)
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  const kept = new Set([wallet, ...ranked.slice(0, maxNodes - 1).map(([id]) => id)]);

  const nodes: GraphNode[] = [...kept].map((id) => ({ id, kind: kinds.get(id)!, txCount: nodeTx.get(id)!.size }));
  const graphEdges: GraphEdge[] = [...edges.values()]
    .filter((e) => kept.has(e.source) && kept.has(e.target))
    .map(({ sums, ...rest }) => ({
      ...rest,
      totals: [...sums].map(([assetId, amount]) => ({ assetId, amount: amount.toString() })),
    }));
  return { nodes, edges: graphEdges, omittedNodes: nodeTx.size - kept.size };
}
