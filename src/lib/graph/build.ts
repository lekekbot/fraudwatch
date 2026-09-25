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

export type GraphNodeKind = "wallet" | "counterparty" | "program";

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

export type GraphEdge = {
  /** Order-independent: the same for A–B and B–A. */
  id: string;
  a: string;
  b: string;
  kind: "interaction" | "program";
  /** Chronological. */
  interactions: Interaction[];
};

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

export const MAX_GRAPH_NODES = 150;

export const pairId = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

const abs = (v: bigint) => (v < BigInt(0) ? -v : v);

/**
 * Builds the map from each mapped wallet's (already filtered) effects and
 * summaries. `hiddenAssets` drops movements of those assets, so a pair joined
 * only by hidden assets loses its connection.
 */
export function buildInteractionGraph(
  sides: WalletSide[],
  options: { hiddenAssets?: ReadonlySet<string>; showPrograms?: boolean; maxNodes?: number } = {},
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

  const all: GraphEdge[] = [...edges.values()].map((edge) => ({
    id: edge.id,
    a: edge.a,
    b: edge.b,
    kind: edge.kind,
    interactions: [...edge.interactions].sort((x, y) => (x.time ?? 0) - (y.time ?? 0) || x.signature.localeCompare(y.signature)),
  }));
  const programEdges = all.filter((e) => e.kind === "program");
  const drawn = all.filter((e) => e.kind === "interaction" || options.showPrograms);

  // Nodes: every mapped wallet, then the busiest others up to the cap.
  const txs = new Map<string, Set<string>>();
  const programs = new Set(programEdges.flatMap((e) => (mapped.has(e.a) ? [e.b] : [e.a])));
  for (const e of drawn) {
    for (const id of [e.a, e.b]) {
      if (!txs.has(id)) txs.set(id, new Set());
      for (const it of e.interactions) txs.get(id)!.add(it.signature);
    }
  }
  const others = [...txs.keys()]
    .filter((id) => !mapped.has(id))
    .sort((x, y) => txs.get(y)!.size - txs.get(x)!.size || x.localeCompare(y));
  const kept = new Set([...mapped, ...others.slice(0, Math.max(0, maxNodes - mapped.size))]);
  const nodes: GraphNode[] = [...kept].map((id) => ({
    id,
    kind: mapped.has(id) ? "wallet" : programs.has(id) ? "program" : "counterparty",
    txCount: txs.get(id)?.size ?? 0,
  }));
  const shown = drawn.filter((e) => kept.has(e.a) && kept.has(e.b));
  const interactions = shown.filter((e) => e.kind === "interaction");
  return {
    nodes,
    edges: shown,
    omittedNodes: txs.size + [...mapped].filter((m) => !txs.has(m)).length - kept.size,
    counts: {
      addresses: nodes.filter((n) => n.kind !== "program").length,
      connections: interactions.length,
      transactions: new Set(interactions.flatMap((e) => e.interactions.map((it) => it.signature))).size,
      programConnections: programEdges.length,
    },
  };
}
