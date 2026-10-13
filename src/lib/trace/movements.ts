import type { IngestionCoverage } from "@/lib/ingest/ingest";
import type { SemanticEvent } from "@/lib/semantic/events";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import { compareTransactions } from "@/lib/state/reconstruct";
import { type Amount, type BoundaryKind, keyedFlows, type MovementKey, type MovementRef, type TraceScope } from "./model";

/**
 * Which movements in a case can be traced, and what each one means (see
 * docs/sprints/trace-graph/03). A royalty isn't the trade, a pool isn't a
 * counterparty, a swap doesn't send money to anyone, and the network fee isn't
 * a flow at all. Everything here is a real flow of a loaded event; nothing is
 * synthesised.
 */

export type Weight = "primary" | "supporting";

export type Classified =
  /** An observed movement between two known addresses. Supporting: fees, royalties, rent and other recipients of a trade. */
  | { kind: "movement"; ref: MovementRef; weight: Weight }
  /** One actor gave up some assets and got others back (swap, liquid stake, receipt-token deposit): the asset changes, nobody receives it. */
  | { kind: "conversion"; signature: string; address: string; spent: Amount[]; received: Amount[] }
  | { kind: "boundary"; signature: string; address: string; boundary: BoundaryKind; ref?: MovementRef }
  /** Routing and closures (settlement), zero amounts, and what a bridge arrival cost to receive. */
  | { kind: "excluded"; ref: MovementRef; reason: "settlement" | "zero" | "bridge_cost" };

type Conversion = Extract<Classified, { kind: "conversion" }>;
type Boundary = Extract<Classified, { kind: "boundary" }>;

const SUPPORTING = new Set(["royalty", "marketplace_fee", "rent", "unidentified"]);
/** Where value goes into (or comes out of) a position rather than to a wallet. */
const POSITION_CATEGORIES = new Set(["STAKE", "UNSTAKE", "LENDING", "LIQUIDITY"]);

/** Every flow of an event, classified. The network fee isn't a flow and never appears. */
export function classifyEvent(event: SemanticEvent): Classified[] {
  if (event.category === "FAILED") {
    const payer = event.metadata.feePayer;
    return payer ? [{ kind: "boundary", signature: event.signature, address: payer, boundary: "failed" }] : [];
  }
  const out: Classified[] = [];
  const sided = new Map<string, { spent: MovementRef[]; received: MovementRef[] }>();
  const boundary = (address: string, kind: BoundaryKind, ref?: MovementRef): Boundary => ({ kind: "boundary", signature: event.signature, address, boundary: kind, ...(ref ? { ref } : {}) });

  for (const { ref } of keyedFlows(event)) {
    if (BigInt(ref.amount) === 0n) out.push({ kind: "excluded", ref, reason: "zero" });
    else if (ref.role === "settlement") out.push({ kind: "excluded", ref, reason: "settlement" });
    else if (ref.role === "spent" || ref.role === "received") {
      const actor = ref.role === "spent" ? ref.from : ref.to;
      if (!actor) continue;
      const side = sided.get(actor) ?? { spent: [], received: [] };
      side[ref.role].push(ref);
      sided.set(actor, side);
    } else if (ref.from && ref.to) out.push({ kind: "movement", ref, weight: ref.role && SUPPORTING.has(ref.role) ? "supporting" : "primary" });
    else if (ref.from && event.category === "BURN") out.push(boundary(ref.from, "left_supply", ref));
    else if (ref.to && ref.role === "nft" && !ref.from && event.category === "NFT_MINT") out.push(boundary(ref.to, "entered_supply", ref));
    else if (ref.from || ref.to) out.push(boundary((ref.from ?? ref.to)!, "ambiguous", ref));
  }

  for (const [address, { spent, received }] of sided) {
    if (event.category === "BRIDGE") {
      // The bridged asset leaves (OUT) or arrives (IN); anything else the actor spent or got is what the crossing cost.
      const crossing = event.bridge?.direction === "IN" ? received : spent;
      const kind: BoundaryKind = event.bridge?.direction === "IN" ? "bridged_in" : "bridged_out";
      for (const ref of crossing) out.push(boundary(address, kind, ref));
      for (const ref of event.bridge?.direction === "IN" ? spent : received) out.push({ kind: "excluded", ref, reason: "bridge_cost" });
    } else if (spent.length && received.length) {
      out.push({ kind: "conversion", signature: event.signature, address, spent: spent.map(amountOf), received: received.map(amountOf) });
    } else {
      // Only one side: value went into a position, or came out of one. Outside those categories nothing says where it went.
      const kind: BoundaryKind = POSITION_CATEGORIES.has(event.category) ? "protocol_position" : "ambiguous";
      for (const ref of [...spent, ...received]) out.push(boundary(address, kind, ref));
    }
  }
  return out;
}

const amountOf = (ref: MovementRef): Amount => ({ assetId: ref.assetId, amount: ref.amount });

/** Position of each transaction in chronological order (slot, index in slot, signature). */
export function chronologicalOrder(transactions: Iterable<CanonicalTransaction>): Map<string, number> {
  return new Map([...transactions].sort(compareTransactions).map((tx, i) => [tx.signature, i]));
}

export type IndexedMovement = { ref: MovementRef; weight: Weight; order: number };

export type MovementIndex = {
  /** Per address, the movements it sent / received, in chronological order. */
  outgoing: ReadonlyMap<string, readonly IndexedMovement[]>;
  incoming: ReadonlyMap<string, readonly IndexedMovement[]>;
  conversions: ReadonlyMap<string, readonly Conversion[]>;
  boundaries: ReadonlyMap<string, readonly Boundary[]>;
  /** Every movement of one signature, so legs of one transaction stay together. */
  bySignature: ReadonlyMap<string, readonly IndexedMovement[]>;
};

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/** Chronological; one transaction's legs keep their flow order (the sort is stable), so a payment lists before its fees. */
const byOrder = (a: IndexedMovement, b: IndexedMovement) => a.order - b.order || (a.ref.signature < b.ref.signature ? -1 : a.ref.signature > b.ref.signature ? 1 : 0);

/**
 * One pass over the case's events. `orderOf` comes from `chronologicalOrder`;
 * a signature it doesn't know sorts by slot after the known ones.
 */
export function buildMovementIndex(events: Iterable<SemanticEvent>, orderOf: (signature: string) => number | undefined): MovementIndex {
  const outgoing = new Map<string, IndexedMovement[]>();
  const incoming = new Map<string, IndexedMovement[]>();
  const conversions = new Map<string, Conversion[]>();
  const boundaries = new Map<string, Boundary[]>();
  const bySignature = new Map<string, IndexedMovement[]>();
  for (const event of events) {
    const order = orderOf(event.signature) ?? Number.MAX_SAFE_INTEGER / 2 + event.slot;
    for (const c of classifyEvent(event)) {
      if (c.kind === "movement") {
        const m = { ref: c.ref, weight: c.weight, order };
        push(outgoing, c.ref.from!, m);
        push(incoming, c.ref.to!, m);
        push(bySignature, c.ref.signature, m);
      } else if (c.kind === "conversion") push(conversions, c.address, c);
      else if (c.kind === "boundary") push(boundaries, c.address, c);
    }
  }
  for (const list of [...outgoing.values(), ...incoming.values(), ...bySignature.values()]) list.sort(byOrder);
  return { outgoing, incoming, conversions, boundaries, bySignature };
}

export type CandidateQuery = {
  node: string;
  direction: "forward" | "backward";
  /** Forward: only movements at or after this order (the arrival into the node). */
  after?: number;
  /** Backward: only movements at or before this order (the departure from the node). */
  before?: number;
  scope: TraceScope;
  /** Already in the trace. */
  exclude: ReadonlySet<MovementKey>;
  includeSupporting: boolean;
  hiddenReason: (signature: string) => "manual" | "rule" | null;
  /** The node's loaded history and the range it was loaded for; null when it isn't a mapped wallet (only movements touching mapped wallets are known). */
  loaded: { complete: IngestionCoverage["complete"]; start: string; end: string } | null;
  /** What a scope without dates means. */
  caseRange: { start: string; end: string };
};

export type Candidate = {
  ref: MovementRef;
  weight: Weight;
  order: number;
  /** Hidden in the case's main views; still a real movement (D5). */
  hidden: "manual" | "rule" | null;
  /** Candidates sharing this one's signature, so one transaction's legs list as one group. */
  groupSize: number;
};

export type CandidatePage = {
  items: Candidate[];
  /** Matching, before paging. */
  total: number;
  completeness: "complete" | "partial_history" | "outside_range";
  nextCursor: number | null;
};

/**
 * Movements that could be added next from a node, oldest first. Paging is a
 * slice of the address's pre-sorted list after filtering. The completeness
 * says how much of the node's history these can be.
 */
export function candidates(index: MovementIndex, q: CandidateQuery, page: { cursor?: number; limit: number }): CandidatePage {
  const list = (q.direction === "forward" ? index.outgoing : index.incoming).get(q.node) ?? [];
  const { assets, start, end, minAmount } = q.scope;
  const [startMs, endMs] = [start ? Date.parse(start) : null, end ? Date.parse(end) : null];
  const matching = list.filter((m) => {
    const { ref } = m;
    if (q.exclude.has(ref.key)) return false;
    if (!q.includeSupporting && m.weight === "supporting") return false;
    if (q.after !== undefined && m.order < q.after) return false;
    if (q.before !== undefined && m.order > q.before) return false;
    if (assets && !assets.includes(ref.assetId)) return false;
    // A movement without a block time can't be placed in the range; it stays, and the UI marks it.
    if (ref.time !== null && ((startMs !== null && ref.time < startMs) || (endMs !== null && ref.time > endMs))) return false;
    if (minAmount && ref.assetId === minAmount.assetId && BigInt(ref.amount) < BigInt(minAmount.amount)) return false;
    return true;
  });
  const perSignature = new Map<string, number>();
  for (const m of matching) perSignature.set(m.ref.signature, (perSignature.get(m.ref.signature) ?? 0) + 1);
  const from = page.cursor ?? 0;
  const items = matching.slice(from, from + page.limit).map((m) => ({ ...m, hidden: q.hiddenReason(m.ref.signature), groupSize: perSignature.get(m.ref.signature)! }));
  return { items, total: matching.length, completeness: completeness(q), nextCursor: from + page.limit < matching.length ? from + page.limit : null };
}

function completeness(q: CandidateQuery): CandidatePage["completeness"] {
  if (!q.loaded) return "partial_history";
  // A wallet mapped from its first interaction is loaded from then on, so a scope reaching earlier asks for history it doesn't have.
  const start = Date.parse(q.scope.start ?? q.caseRange.start);
  const end = Date.parse(q.scope.end ?? q.caseRange.end);
  if (start < Date.parse(q.loaded.start) || end > Date.parse(q.loaded.end)) return "outside_range";
  return q.loaded.complete ? "complete" : "partial_history";
}
