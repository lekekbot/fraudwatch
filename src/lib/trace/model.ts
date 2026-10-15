import type { FlowRole, SemanticEvent, SemanticFlow } from "@/lib/semantic/events";
import type { TracePresentation } from "./presentation";

/**
 * A trace: an investigator-built, saved set of observed movements within one
 * case. Steps point at movements by content, never copy the transaction, and
 * are re-resolved against current evidence every time the trace opens (see
 * docs/sprints/trace-graph/02).
 */

export const TRACE_SCHEMA_VERSION = 1;
export const MAX_HOPS = 20;
export const DEFAULT_MAX_HOPS = 6;

/**
 * `solana:<signature>:event:<i>:mv:<assetId>:<from|_>:<to|_>:<amount>:<n>`, where
 * `n` counts identical (asset, from, to, amount) tuples in flow order. Built from
 * content, not position, so a reinterpretation that keeps the movement keeps
 * its key, and one that changes it is detected rather than re-pointed.
 */
export type MovementKey = string;

export type MovementRef = {
  key: MovementKey;
  signature: string;
  eventIndex: number;
  assetId: string;
  from: string | null;
  to: string | null;
  /** Base units, integer string. */
  amount: string;
  /** Not part of the key: a refined role shouldn't orphan a step. */
  role: FlowRole | null;
  /** ms, or null when the RPC gave no block time. */
  time: number | null;
  slot: number;
};

export type Amount = { assetId: string; amount: string };

export type TraceSeed = { kind: "address"; address: string } | { kind: "transaction"; signature: string } | { kind: "movement"; ref: MovementRef };

export type TraceDirection = "forward" | "backward" | "both";

export type TraceScope = {
  /** null = any asset. */
  assets: string[] | null;
  /** ISO; null = the case range. */
  start: string | null;
  end: string | null;
  minAmount: Amount | null;
  maxHops: number;
};

export type TraceStep =
  | { id: string; kind: "movement"; ref: MovementRef; direction: "forward" | "backward"; addedAt: string; note?: string }
  | { id: string; kind: "conversion"; signature: string; address: string; spent: Amount[]; received: Amount[]; addedAt: string; note?: string };

export type Trace = {
  id: string;
  caseId: string;
  name: string;
  schemaVersion: number;
  seed: TraceSeed;
  direction: TraceDirection;
  scope: TraceScope;
  steps: TraceStep[];
  /**
   * Addresses the investigator put on the trace themselves. Each is a node
   * from the start, but it's connected to the seed only through added
   * movements: placing it claims nothing about the funds.
   */
  addresses?: string[];
  /** Damaged saved items remain available for review and removal, never silently discarded. */
  invalidSteps?: unknown[];
  invalidAnnotations?: unknown[];
  /** Positions, styles and annotations: presentation, never evidence. */
  presentation: TracePresentation;
  analysisAtSave: { semantic: number; registry: number };
  createdAt: string;
  updatedAt: string;
};

/**
 * Why a path stops at a node. Only `end_of_history` may read as "nothing
 * further", and only when the wallet's loaded history is complete.
 */
export type BoundaryKind =
  /** OBSERVED address: only movements touching mapped wallets are known. */
  | "history_not_loaded"
  /** Mapped, but its loaded history is incomplete (a safety limit or the provider's history ran out). */
  | "partial_history"
  /** Continuing would need activity outside the case or wallet range. */
  | "outside_range"
  /** Verified exchange or custodial service: no linkable continuation. */
  | "custodial"
  /** A flow with a null side: several senders and several receivers. */
  | "ambiguous"
  | "failed"
  /** Burned: left supply. */
  | "left_supply"
  /** Minted to the address: there is no sender to go back to. */
  | "entered_supply"
  | "bridged_out"
  /** Arrived from another chain: the origin isn't on Solana. */
  | "bridged_in"
  /** Value went into a stake, lending or liquidity position. */
  | "protocol_position"
  | "end_of_history";

export type EdgeProvenance = "observed" | "bundled" | "service";

const encode = (address: string | null) => address ?? "_";

export function movementKey(signature: string, eventIndex: number, flow: Pick<SemanticFlow, "assetId" | "from" | "to" | "amount">, occurrence: number): MovementKey {
  return `solana:${signature}:event:${eventIndex}:mv:${flow.assetId}:${encode(flow.from)}:${encode(flow.to)}:${flow.amount}:${occurrence}`;
}

/** The index in `solana:<signature>:event:<index>`. */
export function eventIndexOf(event: Pick<SemanticEvent, "id">): number {
  const index = Number(event.id.slice(event.id.lastIndexOf(":") + 1));
  return Number.isInteger(index) ? index : 0;
}

/** Every flow of an event with its reference, in flow order. */
export function keyedFlows(event: SemanticEvent): { flow: SemanticFlow; ref: MovementRef }[] {
  const eventIndex = eventIndexOf(event);
  const time = event.timestamp ? Date.parse(event.timestamp) : null;
  const seen = new Map<string, number>();
  return event.flows.map((flow) => {
    const tuple = `${flow.assetId}|${encode(flow.from)}|${encode(flow.to)}|${flow.amount}`;
    const occurrence = seen.get(tuple) ?? 0;
    seen.set(tuple, occurrence + 1);
    return {
      flow,
      ref: {
        key: movementKey(event.signature, eventIndex, flow, occurrence),
        signature: event.signature,
        eventIndex,
        assetId: flow.assetId,
        from: flow.from,
        to: flow.to,
        amount: flow.amount,
        role: flow.role ?? null,
        time: time !== null && Number.isFinite(time) ? time : null,
        slot: event.slot,
      },
    };
  });
}

/** Chronological order of two movements: slot, then key as a stable tiebreak. */
export function compareRefs(a: Pick<MovementRef, "slot" | "key">, b: Pick<MovementRef, "slot" | "key">): number {
  if (a.slot !== b.slot) return a.slot - b.slot;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
