import type { Names } from "@/lib/labels/labels";
import { registry } from "@/lib/protocols/registry";
import type { EventCategory, FlowRole, SemanticEvent } from "@/lib/semantic/events";
import { projectEvent } from "@/lib/semantic/projection";
import type { WalletTransactionEffect } from "@/lib/state/reconstruct";
import type { EffectKind, EffectSummary, RecipientRole } from "@/lib/state/summarize";

/**
 * A wallet interaction map: who exchanged value with whom, read from semantic
 * events. NFT royalty, fee, rent and escrow legs stay grouped under the trade's
 * buyer/seller relationship; swap, stake, lending and bridge routing through
 * pools, vaults and protocol accounts makes no wallet connection at all; other
 * value movements get one node per address and one undirected connection per
 * pair. Every underlying transaction keeps its real direction and amounts.
 * Program calls are a separate connection kind and never join two wallets.
 */

/**
 * `burn`: where burned tokens go; they leave supply instead of reaching an address. `entity`: one protocol or
 * service standing in for every registry address of it the case touched (program, authority, fee account, pool…).
 */
export type GraphNodeKind = "wallet" | "counterparty" | "program" | "aggregate" | "burn" | "entity";

/**
 * Where an address that isn't ranked onto the map is collapsed. Fixed, meaningful groups, not graph communities;
 * `null` from `clusterOf` keeps an address out of every cluster (a look-alike, an address the investigator labelled).
 */
export type ClusterKind = "known" | "infrastructure" | "decoy" | "unknown" | "one_off";
export const CLUSTER_KINDS: readonly ClusterKind[] = ["known", "infrastructure", "decoy", "unknown", "one_off"];
export const CLUSTER_LABELS: Record<ClusterKind, string> = {
  known: "Known services",
  infrastructure: "Programs & infrastructure",
  decoy: "Likely decoys",
  unknown: "Unknown wallets",
  one_off: "One-off wallets",
};
export const clusterNodeId = (kind: ClusterKind) => `__cluster_${kind}__`;

/**
 * `wallet`: a mapped wallet. `txCount`: transactions on the node's connections. An `aggregate` is a cluster of
 * collapsed addresses: how many, and which mapped wallets they dealt with.
 */
export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  txCount: number;
  cluster?: { kind: ClusterKind; addresses: number; wallets: string[] };
  /** Why a counterparty made the map, in words (shared by mapped wallets, value moved, behaviour seen…). */
  reasons?: string[];
  /** The real addresses an entity node stands for, sorted. */
  entity?: { protocolId: string; addresses: string[] };
};

const ENTITY_PREFIX = "entity:";
export const entityNodeId = (protocolId: string) => `${ENTITY_PREFIX}${protocolId}`;
/** The registry protocol id behind an entity node id, or undefined for a real address. */
export const entityProtocol = (id: string) => (id.startsWith(ENTITY_PREFIX) ? id.slice(ENTITY_PREFIX.length) : undefined);

/** Value that moved between the pair in one transaction. `via`: the real address when one end is an entity node. */
export type Movement = { from: string; to: string; assetId: string; amount: string; via?: string };

/** Exact on-chain legs kept inside their NFT trade instead of drawn as separate relationships. */
export type NftRelatedMovement = Movement & { role: RecipientRole | "escrow" };

/** One transaction on a connection. */
export type Interaction = {
  signature: string;
  /** ms, or null when the RPC gave no block time. */
  time: number | null;
  /** Whose side of the transaction it was read from, and what it was for them. */
  wallet: string;
  kind: EffectKind;
  /** The transaction's semantic event, the same one the Timeline shows. */
  eventId?: string;
  category?: EventCategory;
  /** Empty for a program call. */
  movements: Movement[];
  /** Who approved the transaction: its fee payer, the first signer, which made the first move. */
  initiator: string;
  /** Royalty, fee, rent and escrow legs grouped under the NFT buyer/seller relationship. */
  nftRelated?: NftRelatedMovement[];
};

export type RelationshipSummary = {
  totalInteractions: number;
  aToB: number;
  bToA: number;
  /** Per asset: how many transactions moved it, and the base units that moved each way. */
  assets: { assetId: string; txCount: number; aToB: string; bToA: string }[];
  transactionTypes: { kind: EffectKind; count: number }[];
  /** Semantic event categories behind the connection, most common first. */
  eventCategories: { category: EventCategory; count: number }[];
  firstInteraction: number | null;
  lastInteraction: number | null;
  activeDays: number;
  activityPattern: "One-off" | "Single burst" | "Recurring" | "Long-running";
  /** Transactions approved (signed) by each end, and by someone else entirely (a delegate, drainer or bot). */
  initiatedByA: number;
  initiatedByB: number;
  initiatedByOthers: number;
};

export type GraphEdge = {
  /** Order-independent: the same for A–B and B–A. */
  id: string;
  a: string;
  b: string;
  kind: "interaction" | "program";
  /** Chronological. */
  interactions: Interaction[];
  /** Computed once when the filtered graph is built; shared by every graph view. */
  summary: RelationshipSummary;
};

/** Who made the first move on a connection: how many transactions each end approved (signed), and anyone else. */
export function startedBy(edge: GraphEdge, names: Pick<Names, "of">): string {
  const s = edge.summary;
  const parts = [
    ...(s.initiatedByA ? [`${names.of(edge.a)} ${s.initiatedByA.toLocaleString()}`] : []),
    ...(s.initiatedByB ? [`${names.of(edge.b)} ${s.initiatedByB.toLocaleString()}`] : []),
    ...(s.initiatedByOthers ? [`someone else ${s.initiatedByOthers.toLocaleString()}`] : []),
  ];
  return `Started by ${parts.join(" · ")}`;
}

export function summarizeRelationship(edge: Pick<GraphEdge, "a" | "b" | "interactions">): RelationshipSummary {
  const assets = new Map<string, { signatures: Set<string>; aToB: bigint; bToA: bigint }>();
  const kinds = new Map<EffectKind, number>();
  const categories = new Map<EventCategory, number>();
  const days = new Set<string>();
  const times: number[] = [];
  let aToB = 0;
  let bToA = 0;
  let initiatedByA = 0;
  let initiatedByB = 0;
  let initiatedByOthers = 0;
  for (const interaction of edge.interactions) {
    kinds.set(interaction.kind, (kinds.get(interaction.kind) ?? 0) + 1);
    if (interaction.category) categories.set(interaction.category, (categories.get(interaction.category) ?? 0) + 1);
    if (interaction.initiator === edge.a) initiatedByA++;
    else if (interaction.initiator === edge.b) initiatedByB++;
    else initiatedByOthers++;
    if (interaction.time !== null) {
      times.push(interaction.time);
      days.add(new Date(interaction.time).toISOString().slice(0, 10));
    }
    if (interaction.movements.some((movement) => movement.from === edge.a && movement.to === edge.b)) aToB++;
    if (interaction.movements.some((movement) => movement.from === edge.b && movement.to === edge.a)) bToA++;
    for (const movement of interaction.movements) {
      let asset = assets.get(movement.assetId);
      if (!asset) assets.set(movement.assetId, (asset = { signatures: new Set(), aToB: BigInt(0), bToA: BigInt(0) }));
      asset.signatures.add(interaction.signature);
      // A movement on this connection always runs between its two endpoints.
      if (movement.to === edge.b) asset.aToB += BigInt(movement.amount);
      else asset.bToA += BigInt(movement.amount);
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
    assets: [...assets]
      .map(([assetId, a]) => ({ assetId, txCount: a.signatures.size, aToB: a.aToB.toString(), bToA: a.bToA.toString() }))
      .sort((x, y) => y.txCount - x.txCount || x.assetId.localeCompare(y.assetId)),
    transactionTypes: [...kinds].map(([kind, count]) => ({ kind, count })).sort((x, y) => y.count - x.count || x.kind.localeCompare(y.kind)),
    eventCategories: [...categories].map(([category, count]) => ({ category, count })).sort((x, y) => y.count - x.count || x.category.localeCompare(y.category)),
    firstInteraction,
    lastInteraction,
    activeDays: days.size,
    activityPattern: totalInteractions <= 1 ? "One-off" : days.size <= 1 ? "Single burst" : spanDays >= 30 && days.size >= 3 ? "Recurring" : "Long-running",
    initiatedByA,
    initiatedByB,
    initiatedByOthers,
  };
}

/**
 * How much value each direction of each line moved, 0–1, comparable across lines without prices: per asset, the
 * amount over the largest amount of that asset any line moved one way; a direction takes its best asset. Assets that
 * never move more than one unit (NFTs) say nothing about size and score 0.
 */
export function flowShares(edges: readonly GraphEdge[]): Map<string, { aToB: number; bToA: number }> {
  const largest = new Map<string, bigint>();
  for (const edge of edges) {
    for (const asset of edge.summary.assets) {
      const most = BigInt(asset.aToB) > BigInt(asset.bToA) ? BigInt(asset.aToB) : BigInt(asset.bToA);
      if (most > (largest.get(asset.assetId) ?? BigInt(0))) largest.set(asset.assetId, most);
    }
  }
  const share = (amount: string, assetId: string) => {
    const max = largest.get(assetId) ?? BigInt(0);
    return max > BigInt(1) ? Number(amount) / Number(max) : 0;
  };
  return new Map(
    edges.map((edge) => {
      const assets = edge.summary.assets;
      return [edge.id, { aToB: Math.max(0, ...assets.map((a) => share(a.aToB, a.assetId))), bToA: Math.max(0, ...assets.map((a) => share(a.bToA, a.assetId))) }];
    }),
  );
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

/** `events`, when given, lines up with `effects`: each transaction's semantic event. */
export type WalletSide = { wallet: string; effects: WalletTransactionEffect[]; summaries: EffectSummary[]; events?: readonly (SemanticEvent | undefined)[] };

export type GraphRanking = "significant" | "interactions" | "value" | "incoming" | "outgoing" | "recent";

export const MAX_GRAPH_NODES = 25;
export const BURNED_NODE_ID = "__burned__";

/** `names`, also naming the burn node and entity nodes, for everything that labels graph nodes. */
export const withGraphNames = (names: Names): Names => {
  const special = (id: string) => (id === BURNED_NODE_ID ? "Burned" : registry.protocols.get(entityProtocol(id) ?? "")?.name);
  return {
    ...names,
    of: (address, chars) => special(address) ?? names.of(address, chars),
    known: (address) => special(address) ?? names.known(address),
  };
};

export const pairId = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

const abs = (v: bigint) => (v < BigInt(0) ? -v : v);

/**
 * Builds the map from each mapped wallet's (already filtered) effects and
 * summaries. `hiddenAssets` drops movements of those assets, so a pair joined
 * only by hidden assets loses its connection.
 */
export function buildInteractionGraph(
  sides: WalletSide[],
  options: {
    hiddenAssets?: ReadonlySet<string>;
    showPrograms?: boolean;
    maxNodes?: number;
    ranking?: GraphRanking;
    /** Which cluster an address collapses into; every address is "unknown" without it. */
    clusterOf?: (address: string) => ClusterKind | null;
    /** Clusters shown as their addresses instead. */
    expandedClusters?: ReadonlySet<ClusterKind>;
    /** Registry protocols drawn as their separate addresses instead of one entity node. */
    expandedEntities?: ReadonlySet<string>;
    /** How many behaviour observations each address appears in; such addresses are offered a place on the map. */
    observed?: ReadonlyMap<string, number>;
  } = {},
): WalletGraph {
  const hidden = options.hiddenAssets ?? new Set<string>();
  const maxNodes = options.maxNodes ?? MAX_GRAPH_NODES;
  const mapped = new Set(sides.map((s) => s.wallet));
  type Building = Omit<GraphEdge, "summary"> & { bySignature: Map<string, Interaction> };
  const edges = new Map<string, Building>();
  // The same movement seen from both mapped wallets' sides is recorded once.
  const seen = new Set<string>();
  const seenNftRelated = new Set<string>();
  // Known protocol and service addresses collapse into one node per protocol; mapped wallets never do.
  const expandedEntities = options.expandedEntities ?? new Set<string>();
  const members = new Map<string, Set<string>>();
  const sideOf = (address: string) => {
    const entry = mapped.has(address) ? undefined : registry.lookup(address);
    if (!entry || entry.category === "core" || expandedEntities.has(entry.protocolId)) return address;
    const id = entityNodeId(entry.protocolId);
    members.set(id, (members.get(id) ?? new Set()).add(address));
    return id;
  };

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
  const eventOf = new Map<string, SemanticEvent>();
  for (const side of sides) side.events?.forEach((event, i) => event && eventOf.set(side.effects[i].signature, event));
  const interactionOn = (edge: Building, e: WalletTransactionEffect, s: EffectSummary) => {
    let it = edge.bySignature.get(e.signature);
    if (!it) {
      const event = eventOf.get(e.signature);
      // The summary names the fee payer only when it isn't the wallet; otherwise the wallet approved it itself.
      it = {
        signature: e.signature,
        time: e.timestamp ? Date.parse(e.timestamp) : null,
        wallet: e.wallet,
        kind: s.kind,
        ...(event ? { eventId: event.id, category: event.category } : {}),
        movements: [],
        initiator: s.actor ? sideOf(s.actor) : e.wallet,
      };
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
    const from = sideOf(m.from);
    const to = sideOf(m.to);
    if (from === to) return;
    const via = from !== m.from ? m.from : to !== m.to ? m.to : undefined;
    interactionOn(edgeFor(from, to, "interaction"), e, s).movements.push(via ? { ...m, from, to, via } : m);
  };
  const groupNftMovement = (e: WalletTransactionEffect, s: EffectSummary, party: string, m: NftRelatedMovement) => {
    if (m.from === m.to || hidden.has(m.assetId)) return;
    const key = `${e.signature}|${m.from}|${m.to}|${m.assetId}|${m.role}`;
    if (seenNftRelated.has(key)) return;
    seenNftRelated.add(key);
    const interaction = interactionOn(edgeFor(e.wallet, sideOf(party), "interaction"), e, s);
    (interaction.nftRelated ??= []).push(m);
  };

  /** NFT legs that stay inside the trade instead of becoming relationships. */
  const GROUPED = new Set<FlowRole | undefined>(["royalty", "marketplace_fee", "unidentified", "rent"]);
  /**
   * Movements from the wallet's side of its semantic event. Only meaningful legs connect addresses:
   * routing and settlement (pools, vaults, escrows, closures) never do, nor do infrastructure
   * addresses; a swap's or bridge's spent and received legs have no other side to connect to.
   */
  const fromEvent = (wallet: string, e: WalletTransactionEffect, s: EffectSummary, event: SemanticEvent) => {
    const projection = projectEvent(event, wallet);
    if (!projection) return;
    const infrastructure = new Set(event.infrastructure.map((i) => i.address));
    const nft = event.nft;
    const nftParty = (() => {
      if (!nft) return null;
      if (wallet === nft.buyer) return nft.seller;
      if (wallet === nft.seller) return nft.buyer;
      const leg = event.flows.find((f) => f.role === "nft" && (f.from === wallet || f.to === wallet));
      return (leg?.from === wallet ? leg.to : leg?.from) ?? null;
    })();
    for (const f of [...projection.outgoing, ...projection.incoming]) {
      if (!f.from || !f.to || f.role === "settlement" || f.role === "spent" || f.role === "received") continue;
      const movement = { from: f.from, to: f.to, assetId: f.assetId, amount: f.amount };
      if (GROUPED.has(f.role)) {
        if (nftParty) groupNftMovement(e, s, nftParty, { ...movement, role: f.role as RecipientRole });
        continue;
      }
      const other = f.from === wallet ? f.to : f.from;
      if (other === wallet || infrastructure.has(other)) continue;
      move(e, s, movement);
    }
  };

  /** Without a semantic event: the wallet's own counterparties, with NFT legs grouped under the trade's party. */
  const fromSummary = (wallet: string, e: WalletTransactionEffect, s: EffectSummary) => {
    const nftAssets = new Set([...(s.nft?.received ?? []), ...(s.nft?.sent ?? [])]);
    const nftRecipients = new Map(s.nft?.others.map((recipient) => [recipient.address, recipient.role]) ?? []);
    // Direct value movements: the counterparty's balance moved against the wallet's.
    for (const cp of s.counterparties) {
      if (cp.address === wallet) continue;
      const amount = abs(BigInt(cp.delta)).toString();
      // The counterparty lost what the wallet gained, and the reverse.
      const movement = cp.delta.startsWith("-") ? { from: cp.address, to: wallet, assetId: cp.assetId, amount } : { from: wallet, to: cp.address, assetId: cp.assetId, amount };
      const recipientRole = cp.assetId === s.nft?.payment?.assetId ? nftRecipients.get(cp.address) : undefined;
      const groupedRole = recipientRole ?? (nftAssets.has(cp.assetId) ? "escrow" : null);
      if (s.nft?.party && cp.address !== s.nft.party && !mapped.has(cp.address) && groupedRole) {
        groupNftMovement(e, s, s.nft.party, { ...movement, role: groupedRole });
      } else move(e, s, movement);
    }
    // One semantic NFT leg joins the trade's actual party. Escrow, royalty, fee and rent legs stay
    // available on that transaction instead of scattering one purchase across several relationships.
    if (s.nft?.party) {
      for (const mint of s.nft.received) move(e, s, { from: s.nft.party, to: wallet, assetId: mint, amount: "1" });
      for (const mint of s.nft.sent) move(e, s, { from: wallet, to: s.nft.party, assetId: mint, amount: "1" });
    }
  };

  for (const { wallet, effects, summaries, events } of sides) {
    effects.forEach((e, i) => {
      const s = summaries[i];
      const event = events?.[i];
      if (event) fromEvent(wallet, e, s, event);
      else fromSummary(wallet, e, s);
      if (s.kind === "BURN") {
        for (const out of s.outflows) move(e, s, { from: wallet, to: BURNED_NODE_ID, assetId: out.assetId, amount: abs(BigInt(out.delta)).toString() });
      }
      // Program calls connect the wallet to the program only, never to other wallets.
      // ponytail: program links stay on raw program ids, not entities; fold them in if both on one line ever reads badly.
      const program = s.action?.programId;
      if (program && s.kind !== "ACCOUNT" && registry.lookup(program)?.category !== "core") {
        interactionOn(edgeFor(wallet, program, "program"), e, s);
      }
    });
  }

  const all: GraphEdge[] = [...edges.values()].map(({ id, a, b, kind, interactions }) => {
    const sorted = [...interactions].sort((x, y) => (x.time ?? 0) - (y.time ?? 0) || x.signature.localeCompare(y.signature));
    return { id, a, b, kind, interactions: sorted, summary: summarizeRelationship({ a, b, interactions: sorted }) };
  });
  const programEdges = all.filter((e) => e.kind === "program");
  const drawn = all.filter((e) => e.kind === "interaction" || options.showPrograms);

  // Nodes: every mapped wallet, then a bounded investigative projection.
  const txs = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  const lastSeen = new Map<string, number>();
  /** The mapped wallets each address dealt with. */
  const walletsOf = new Map<string, Set<string>>();
  const programs = new Set(programEdges.flatMap((e) => (mapped.has(e.a) ? [e.b] : [e.a])));
  for (const e of drawn) {
    for (const [id, other] of [[e.a, e.b], [e.b, e.a]]) {
      if (mapped.has(other)) walletsOf.set(id, (walletsOf.get(id) ?? new Set()).add(other));
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
  // Burns always show: like the mapped wallets, the burn node isn't ranked against counterparties.
  const burned = txs.has(BURNED_NODE_ID) ? [BURNED_NODE_ID] : [];
  const others = [...txs.keys()].filter((id) => !mapped.has(id) && id !== BURNED_NODE_ID);
  const by = (score: (id: string) => number) => [...others].sort((x, y) => score(y) - score(x) || x.localeCompare(y));
  const byInteractions = by((id) => txs.get(id)!.size);
  // Value moved with the mapped wallets, comparable across assets without prices: per asset, the share of the
  // most any address moved; an address takes its best asset. NFTs (one unit) say nothing about size.
  const moved = new Map<string, Map<string, bigint>>();
  for (const e of drawn) {
    if (e.kind !== "interaction") continue;
    for (const it of e.interactions) {
      for (const m of it.movements) {
        for (const id of [m.from, m.to]) {
          const assets = moved.get(id) ?? new Map<string, bigint>();
          assets.set(m.assetId, (assets.get(m.assetId) ?? BigInt(0)) + BigInt(m.amount));
          moved.set(id, assets);
        }
      }
    }
  }
  const mostMoved = new Map<string, bigint>();
  for (const id of others) for (const [assetId, amount] of moved.get(id) ?? []) if (amount > (mostMoved.get(assetId) ?? BigInt(0))) mostMoved.set(assetId, amount);
  const valueShare = (id: string) =>
    Math.max(0, ...[...(moved.get(id) ?? [])].map(([assetId, amount]) => ((mostMoved.get(assetId) ?? BigInt(0)) > BigInt(1) ? Number(amount) / Number(mostMoved.get(assetId)) : 0)));
  const observed = options.observed ?? new Map<string, number>();
  const rankings: Record<GraphRanking, string[]> = {
    interactions: byInteractions,
    value: by(valueShare),
    // From the mapped wallet's perspective: a counterparty sending is incoming.
    incoming: by((id) => outgoing.get(id)?.size ?? 0),
    outgoing: by((id) => incoming.get(id)?.size ?? 0),
    recent: by((id) => lastSeen.get(id) ?? -Infinity),
    significant: [],
  };
  const capacity = Math.max(0, maxNodes - mapped.size - burned.length);
  if ((options.ranking ?? "significant") === "significant") {
    const behaviour = by((id) => observed.get(id) ?? 0).filter((id) => (observed.get(id) ?? 0) > 0);
    const groups = [rankings.interactions.slice(0, 10), rankings.value.slice(0, 5), behaviour.slice(0, 5), rankings.incoming.slice(0, 5), rankings.outgoing.slice(0, 5), rankings.recent.slice(0, 5)];
    // Counterparties shared by mapped wallets come first: they tie the case together.
    const shared = byInteractions.filter((id) => (walletsOf.get(id)?.size ?? 0) >= 2);
    const picked = new Set<string>(shared.slice(0, capacity));
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
  const clusterOf = options.clusterOf ?? (() => "unknown");
  const expanded = options.expandedClusters ?? new Set();
  const kept = new Set([...mapped, ...burned, ...rankings[options.ranking ?? "significant"].slice(0, capacity)]);
  const clusters = new Map<ClusterKind, { addresses: number; txs: Set<string>; wallets: Set<string> }>();
  for (const id of others) {
    if (kept.has(id)) continue;
    // An entity is a known service by definition.
    const assigned = entityProtocol(id) ? "known" : clusterOf(id);
    // Unknown addresses seen in a single transaction are split off: usually the bulk, and the least telling.
    const kind = assigned === "unknown" && txs.get(id)!.size === 1 ? "one_off" : assigned;
    if (kind === null || expanded.has(kind)) {
      kept.add(id);
      continue;
    }
    let cluster = clusters.get(kind);
    if (!cluster) clusters.set(kind, (cluster = { addresses: 0, txs: new Set(), wallets: new Set() }));
    cluster.addresses++;
    for (const signature of txs.get(id)!) cluster.txs.add(signature);
    for (const wallet of walletsOf.get(id) ?? []) cluster.wallets.add(wallet);
  }
  const omittedNodes = new Set([...txs.keys(), ...mapped]).size - kept.size;
  // Why each counterparty is on the map, from the same transparent factors the ranking used.
  const top = (list: string[], n: number) => new Set(list.slice(0, n));
  const [topEvents, topValue, topIn, topOut, topRecent] = [top(rankings.interactions, 10), top(rankings.value, 5), top(rankings.incoming, 5), top(rankings.outgoing, 5), top(rankings.recent, 5)];
  const reasonsFor = (id: string): string[] => {
    const shared = walletsOf.get(id)?.size ?? 0;
    const reasons = [
      ...(shared >= 2 ? [`Dealt with ${shared} mapped wallets`] : []),
      ...(entityProtocol(id) ? ["A service the protocol registry verifies"] : []),
      ...(topEvents.has(id) ? ["Among the 10 with the most events"] : []),
      ...(topValue.has(id) && valueShare(id) > 0 ? ["Among the 5 that moved the most value"] : []),
      ...((observed.get(id) ?? 0) > 0 ? [`In ${observed.get(id)} behaviour observation${observed.get(id) === 1 ? "" : "s"}`] : []),
      ...(topIn.has(id) ? ["Among the 5 that sent most often"] : []),
      ...(topOut.has(id) ? ["Among the 5 that received most often"] : []),
      ...(topRecent.has(id) ? ["Among the 5 most recent"] : []),
    ];
    return reasons.length > 0 ? reasons : ["Next by event count"];
  };
  const nodes: GraphNode[] = [...kept].map((id) => ({
    id,
    kind: mapped.has(id) ? "wallet" : id === BURNED_NODE_ID ? "burn" : entityProtocol(id) ? "entity" : programs.has(id) ? "program" : "counterparty",
    txCount: txs.get(id)?.size ?? 0,
    ...(!mapped.has(id) && id !== BURNED_NODE_ID ? { reasons: reasonsFor(id) } : {}),
    ...(entityProtocol(id) ? { entity: { protocolId: entityProtocol(id)!, addresses: [...(members.get(id) ?? [])].sort() } } : {}),
  }));
  for (const kind of CLUSTER_KINDS) {
    const cluster = clusters.get(kind);
    if (cluster) nodes.push({ id: clusterNodeId(kind), kind: "aggregate", txCount: cluster.txs.size, cluster: { kind, addresses: cluster.addresses, wallets: [...cluster.wallets].sort() } });
  }
  const shown = drawn.filter((e) => kept.has(e.a) && kept.has(e.b));
  const interactions = shown.filter((e) => e.kind === "interaction");
  return {
    nodes,
    edges: shown,
    omittedNodes,
    counts: {
      addresses: nodes.filter((n) => n.kind !== "program" && n.kind !== "aggregate" && n.kind !== "burn").length,
      connections: interactions.length,
      transactions: new Set(interactions.flatMap((e) => e.interactions.map((it) => it.signature))).size,
      programConnections: programEdges.length,
    },
  };
}
