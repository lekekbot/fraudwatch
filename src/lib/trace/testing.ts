import type { SemanticEvent, SemanticFlow } from "@/lib/semantic/events";
import { eventId } from "@/lib/semantic/events";
import { keyedFlows, type Trace, type TraceStep } from "./model";
import { emptyPresentation } from "./presentation";

/** Builders for traces in tests. */

type Flow = Pick<SemanticFlow, "assetId" | "from" | "to" | "amount"> & Partial<SemanticFlow>;

/** A transfer-like event with just the fields traces read. */
export function event(signature: string, flows: Flow[], o: { slot?: number; time?: string | null; category?: SemanticEvent["category"] } = {}): SemanticEvent {
  return {
    id: eventId(signature, 0),
    version: 0,
    signature,
    slot: o.slot ?? 1,
    timestamp: o.time === undefined ? "2026-01-01T00:00:00.000Z" : o.time,
    category: o.category ?? "TRANSFER",
    action: "SEND",
    participants: [],
    infrastructure: [],
    assets: [...new Set(flows.map((f) => f.assetId))],
    flows: flows.map((f) => ({ source: "balance", ...f })),
    protocol: null,
    service: null,
    confidence: "HIGH",
    evidence: [],
    interpreter: { id: "test" },
    trace: [],
    warnings: [],
    nft: null,
    bridge: null,
    stake: null,
    metadata: { feePayer: flows[0]?.from ?? null, feeLamports: "5000" },
  };
}

/** A SOL movement event `from → to` of `amount` base units. */
export const transfer = (signature: string, from: string, to: string, amount: number | string, slot = 1) => event(signature, [{ assetId: "SOL", from, to, amount: String(amount) }], { slot });

/** A step for flow `i` of an event. */
export function stepOf(e: SemanticEvent, i = 0, direction: "forward" | "backward" = "forward"): TraceStep {
  const { ref } = keyedFlows(e)[i];
  return { id: `step:${ref.key}`, kind: "movement", ref, direction, addedAt: "2026-01-02T00:00:00.000Z" };
}

export function trace(o: Partial<Trace> & Pick<Trace, "seed">): Trace {
  return {
    id: "t1",
    caseId: "c1",
    name: "Trace",
    schemaVersion: 1,
    direction: "forward",
    scope: { assets: null, start: null, end: null, minAmount: null, maxHops: 6 },
    steps: [],
    presentation: emptyPresentation(),
    analysisAtSave: { semantic: 9, registry: 1 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...o,
  };
}
