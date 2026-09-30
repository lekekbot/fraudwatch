import { registry } from "@/lib/protocols/registry";
import type { WalletTransactionEffect } from "@/lib/state/reconstruct";
import type { EffectKind, EffectSummary } from "@/lib/state/summarize";

/**
 * A wallet interaction map: who exchanged value with whom. One node per
 * address, and exactly one undirected connection per pair that directly
 * interacted, however many transactions, directions, tokens or days that
 * covers. Every underlying transaction stays on the connection, with its real
 * direction and amounts, for the detail list. Program calls are a separate kind
 * of connection (wallet ↔ program) and never join two wallets.
 */

export type GraphNodeKind = "wallet" | "counterparty" | "program" | "aggregate";

/** `wallet`: a mapped wallet. `txCount`: transactions on the node's connections. */
export type GraphNode = { id: string; kind: GraphNodeKind; txCount: number };

/** Value that moved between the pair in one transaction. */
export type Movement = { from: string; to: string; assetId: string; amount: string };

/** One transaction on a connection. */
export type Interaction = {
  signature: string;
  /** ms, or null when the RPC gave no block time. */
  time: number | null;
  /** Whose side of the transaction it was read from, and what it was for them. */
  wallet: string;
  kind: EffectKind;
  /** Empty for a program call. */
  movements: Movement[];
};

export type RelationshipSummary = {
  totalInteractions: number;
  aToB: number;
  bToA: number;
  assets: { assetId: string; txCount: number }[];
  transactionTypes: { kind: EffectKind; count: number }[];
  firstInteraction: number | null;
  lastInteraction: number | null;
  activeDays: number;
  activityPattern: "One-off" | "Single burst" | "Recurring" | "Long-running";
};

export type GraphEdge = {
  /** Order-independent: the same for A–B and B–A. */
  id: string;
  a: string;
  b: string;
  kind: "interaction" | "program";
  /** Chronological. */
  interactions: Interaction[];
  /** Precomputed once when the filtered graph is built; shared by every graph view. */
  summary?: RelationshipSummary;
};

export function summarizeRelationship(edge: Pick<GraphEdge, "a" | "b" | "interactions">): RelationshipSummary {
  const assets = new Map<string, Set<string>>();
  const kinds = new Map<EffectKind, number>();
  const days = new Set<string>();
  const times: number[] = [];
  let aToB = 0;
  let bToA = 0;
  for (const interaction of edge.interactions) {
    kinds.set(interaction.kind, (kinds.get(interaction.kind) ?? 0) + 1);
    if (interaction.time !== null) {
      times.push(interaction.time);
      days.add(new Date(interaction.time).toISOString().slice(0, 10));
    }
    if (interaction.movements.some((movement) => movement.from === edge.a && movement.to === edge.b)) aToB++;
    if (interaction.movements.some((movement) => movement.from === edge.b && movement.to === edge.a)) bToA++;
    for (const movement of interaction.movements) {
      if (!assets.has(movement.assetId)) assets.set(movement.assetId, new Set());
      assets.get(movement.assetId)!.add(interaction.signature);
    }
  }
  const firstInteraction = times.length ? Math.min(...times) : null;
  const lastInteraction = times.length ? Math.max(...times) : null;
  const spanDays = firstInteraction === null || lastInteraction === null ? 0 : (lastInteraction - firstInteraction) / 86_400_000;
  const totalInteractions = edge.interactions.length;
  return {
    totalInteractions,
    aToB,
    bToA,
    assets: [...assets].map(([assetId, signatures]) => ({ assetId, txCount: signatures.size })).sort((x, y) => y.txCount - x.txCount || x.assetId.localeCompare(y.assetId)),
    transactionTypes: [...kinds].map(([kind, count]) => ({ kind, count })).sort((x, y) => y.count - x.count || x.kind.localeCompare(y.kind)),
    firstInteraction,
    lastInteraction,
    activeDays: days.size,
    activityPattern: totalInteractions <= 1 ? "One-off" : days.size <= 1 ? "Single burst" : spanDays >= 30 && days.size >= 3 ? "Recurring" : "Long-running",
  };
}

/** Actual value-flow direction across an aggregate edge, independent of its alphabetic endpoint order. */
export function edgeFlow(edge: GraphEdge) {
  const aToB = edge.interactions.filter((it) => it.movements.some((m) => m.from === edge.a && m.to === edge.b)).length;
  const bToA = edge.interactions.filter((it) => it.movements.some((m) => m.from === edge.b && m.to === edge.a)).length;
  return bToA > 0 && aToB === 0
    ? { from: edge.b, to: edge.a, forward: bToA, reverse: 0, bidirectional: false }
    : { from: edge.a, to: edge.b, forward: aToB, reverse: bToA, bidirectional: aToB > 0 && bToA > 0 };
}

export type WalletGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  omittedNodes: number;
  counts: {
    /** Mapped wallets and counterparties drawn. */
    addresses: number;
    connections: number;
    /** Distinct transactions behind the wallet-to-wallet connections. */
    transactions: number;
    /** Program connections that exist, whether shown or not. */
    programConnections: number;
  };
};

export type WalletSide = { wallet: string; effects: WalletTransactionEffect[]; summaries: EffectSummary[] };

export type GraphRanking = "significant" | "interactions" | "incoming" | "outgoing" | "recent";

export const MAX_GRAPH_NODES = 25;
export const OMITTED_NODE_ID = "__other_addresses__";

export const pairId = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

const abs = (v: bigint) => (v < BigInt(0) ? -v : v);

/**
 * Builds the map from each mapped wallet's (already filtered) effects and
 * summaries. `hiddenAssets` drops movements of those assets, so a pair joined
 * only by hidden assets loses its connection.
 */
export function buildInteractionGraph(
  sides: WalletSide[],
  options: { hiddenAssets?: ReadonlySet<string>; showPrograms?: boolean; maxNodes?: number; ranking?: GraphRanking } = {},
): WalletGraph {
  const hidden = options.hiddenAssets ?? new Set<string>();
  const maxNodes = options.maxNodes ?? MAX_GRAPH_NODES;
  const mapped = new Set(sides.map((s) => s.wallet));
  const edges = new Map<string, GraphEdge & { bySignature: Map<string, Interaction> }>();
  // The same movement seen from both mapped wallets' sides is recorded once.
  const seen = new Set<string>();

  const edgeFor = (x: string, y: string, kind: GraphEdge["kind"]) => {
    const id = kind === "program" ? `program:${pairId(x, y)}` : pairId(x, y);
    let edge = edges.get(id);
    if (!edge) {
      const [a, b] = x < y ? [x, y] : [y, x];
      edge = { id, a, b, kind, interactions: [], bySignature: new Map() };
      edges.set(id, edge);
    }
    return edge;
  };
  const interactionOn = (edge: GraphEdge & { bySignature: Map<string, Interaction> }, e: WalletTransactionEffect, s: EffectSummary) => {
    let it = edge.bySignature.get(e.signature);
    if (!it) {
      it = { signature: e.signature, time: e.timestamp ? Date.parse(e.timestamp) : null, wallet: e.wallet, kind: s.kind, movements: [] };
      edge.bySignature.set(e.signature, it);
      edge.interactions.push(it);
    }
    return it;
  };
  const move = (e: WalletTransactionEffect, s: EffectSummary, m: Movement) => {
    if (m.from === m.to || hidden.has(m.assetId)) return;
    const key = `${e.signature}|${m.from}|${m.to}|${m.assetId}`;
    if (seen.has(key)) return;
    seen.add(key);
    interactionOn(edgeFor(m.from, m.to, "interaction"), e, s).movements.push(m);
  };

  for (const { wallet, effects, summaries } of sides) {
    effects.forEach((e, i) => {
      const s = summaries[i];
      // Direct value movements: the counterparty's balance moved against the wallet's.
      for (const cp of s.counterparties) {
        if (cp.address === wallet) continue;
        const amount = abs(BigInt(cp.delta)).toString();
        // The counterparty lost what the wallet gained, and the reverse.
        if (cp.delta.startsWith("-")) move(e, s, { from: cp.address, to: wallet, assetId: cp.assetId, amount });
        else move(e, s, { from: wallet, to: cp.address, assetId: cp.assetId, amount });
      }
      // NFTs whose other side isn't a balance counterparty (compressed NFTs, escrowed listings).
      if (s.nft?.party) {
        const covered = new Set(s.counterparties.map((c) => c.assetId));
        for (const mint of s.nft.received) if (!covered.has(mint)) move(e, s, { from: s.nft.party, to: wallet, assetId: mint, amount: "1" });
        for (const mint of s.nft.sent) if (!covered.has(mint)) move(e, s, { from: wallet, to: s.nft.party, assetId: mint, amount: "1" });
      }
      // Program calls connect the wallet to the program only, never to other wallets.
      const program = s.action?.programId;
      if (program && s.kind !== "ACCOUNT" && registry.lookup(program)?.category !== "core") {
        interactionOn(edgeFor(wallet, program, "program"), e, s);
      }
    });
  }

  const all: GraphEdge[] = [...edges.values()].map((edge) => {
    const built: GraphEdge = {
      id: edge.id,
      a: edge.a,
      b: edge.b,
      kind: edge.kind,
      interactions: [...edge.interactions].sort((x, y) => (x.time ?? 0) - (y.time ?? 0) || x.signature.localeCompare(y.signature)),
    };
    built.summary = summarizeRelationship(built);
    return built;
  });
  const programEdges = all.filter((e) => e.kind === "program");
  const drawn = all.filter((e) => e.kind === "interaction" || options.showPrograms);

  // Nodes: every mapped wallet, then a bounded investigative projection.
  const txs = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  const lastSeen = new Map<string, number>();
  const programs = new Set(programEdges.flatMap((e) => (mapped.has(e.a) ? [e.b] : [e.a])));
  for (const e of drawn) {
    for (const id of [e.a, e.b]) {
      if (!txs.has(id)) txs.set(id, new Set());
      for (const it of e.interactions) {
        txs.get(id)!.add(it.signature);
        if (it.time !== null) lastSeen.set(id, Math.max(lastSeen.get(id) ?? -Infinity, it.time));
        if (it.movements.some((m) => m.to === id)) {
          if (!incoming.has(id)) incoming.set(id, new Set());
          incoming.get(id)!.add(it.signature);
        }
        if (it.movements.some((m) => m.from === id)) {
          if (!outgoing.has(id)) outgoing.set(id, new Set());
          outgoing.get(id)!.add(it.signature);
        }
      }
    }
  }
  const others = [...txs.keys()].filter((id) => !mapped.has(id));
  const by = (score: (id: string) => number) => [...others].sort((x, y) => score(y) - score(x) || x.localeCompare(y));
  const byInteractions = by((id) => txs.get(id)!.size);
  const rankings: Record<GraphRanking, string[]> = {
    interactions: byInteractions,
    // From the mapped wallet's perspective: a counterparty sending is incoming.
    incoming: by((id) => outgoing.get(id)?.size ?? 0),
    outgoing: by((id) => incoming.get(id)?.size ?? 0),
    recent: by((id) => lastSeen.get(id) ?? -Infinity),
    significant: [],
  };
  const capacity = Math.max(0, maxNodes - mapped.size);
  if ((options.ranking ?? "significant") === "significant") {
    const groups = [rankings.interactions.slice(0, 10), rankings.incoming.slice(0, 5), rankings.outgoing.slice(0, 5), rankings.recent.slice(0, 5)];
    const picked = new Set<string>();
    for (let i = 0; i < 10 && picked.size < capacity; i++) {
      for (const group of groups) {
        if (group[i]) picked.add(group[i]);
        if (picked.size === capacity) break;
      }
    }
    for (const id of byInteractions) {
      if (picked.size === capacity) break;
      picked.add(id);
    }
    rankings.significant = [...picked];
  }
  const kept = new Set([...mapped, ...rankings[options.ranking ?? "significant"].slice(0, capacity)]);
  const omittedNodes = new Set([...txs.keys(), ...mapped]).size - kept.size;
  const nodes: GraphNode[] = [...kept].map((id) => ({
    id,
    kind: mapped.has(id) ? "wallet" : programs.has(id) ? "program" : "counterparty",
    txCount: txs.get(id)?.size ?? 0,
  }));
  if (omittedNodes > 0) nodes.push({ id: OMITTED_NODE_ID, kind: "aggregate", txCount: omittedNodes });
  const shown = drawn.filter((e) => kept.has(e.a) && kept.has(e.b));
  const interactions = shown.filter((e) => e.kind === "interaction");
  return {
    nodes,
    edges: shown,
    omittedNodes,
    counts: {
      addresses: nodes.filter((n) => n.kind !== "program" && n.kind !== "aggregate").length,
      connections: interactions.length,
      transactions: new Set(interactions.flatMap((e) => e.interactions.map((it) => it.signature))).size,
      programConnections: programEdges.length,
    },
  };
}
