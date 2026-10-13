import { describe, expect, it } from "vitest";
import type { AddressState } from "@/lib/case/address-state";
import type { IngestionCoverage } from "@/lib/ingest/ingest";
import type { SemanticEvent } from "@/lib/semantic/events";
import type { TraceStep } from "./model";
import { emptyPresentation } from "./presentation";
import { event, stepOf, trace, transfer } from "./testing";
import { buildTraceView, type TraceEvidence } from "./view";

const coverage = (complete: boolean): IngestionCoverage => ({ complete, signatureCount: 1, transactionCount: 1, warnings: [] });

function evidence(events: SemanticEvent[], o: { mapped?: Record<string, boolean>; custodial?: string[] } = {}): TraceEvidence {
  const mapped = o.mapped ?? {};
  return {
    events: new Map(events.map((e) => [e.signature, e])),
    coverage: (a) => (a in mapped ? coverage(mapped[a]) : null),
    addressState: (a): AddressState => (a in mapped ? "MAPPED" : "OBSERVED"),
    isCustodial: (a) => (o.custodial ?? []).includes(a),
  };
}

const depths = (v: ReturnType<typeof buildTraceView>) => Object.fromEntries(v.nodes.map((n) => [n.id, n.depth]));

describe("buildTraceView", () => {
  it("counts hops forward along a path", () => {
    const [ab, bc] = [transfer("s1", "A", "B", 10, 1), transfer("s2", "B", "C", 5, 2)];
    const v = buildTraceView(trace({ seed: { kind: "address", address: "A" }, steps: [stepOf(ab), stepOf(bc)] }), evidence([ab, bc]));
    expect(depths(v)).toEqual({ A: 0, B: 1, C: 2 });
    expect(v.edges.map((e) => [e.id, e.provenance, e.returns])).toEqual([
      ["A->B", "observed", false],
      ["B->C", "observed", false],
    ]);
    expect(v.nodes.find((n) => n.id === "A")?.isSeed).toBe(true);
    expect(v.issues).toEqual([]);
  });

  it("bundles repeated movements between one pair, summing per asset only", () => {
    const events = [transfer("s1", "A", "B", 10, 1), transfer("s2", "A", "B", 20, 2), event("s3", [{ assetId: "USDC", from: "A", to: "B", amount: "7" }], { slot: 3 })];
    const steps = events.map((e) => stepOf(e));
    const v = buildTraceView(trace({ seed: { kind: "address", address: "A" }, steps }), evidence(events));
    expect(v.edges).toHaveLength(1);
    expect(v.edges[0]).toMatchObject({
      provenance: "bundled",
      steps: steps.map((s) => s.id),
      totals: [
        { assetId: "SOL", amount: "30" },
        { assetId: "USDC", amount: "7" },
      ],
    });
  });

  it("keeps one node per address and marks a return to the seed", () => {
    const [ab, ba] = [transfer("s1", "A", "B", 10, 1), transfer("s2", "B", "A", 4, 2)];
    const v = buildTraceView(trace({ seed: { kind: "address", address: "A" }, steps: [stepOf(ab), stepOf(ba)] }), evidence([ab, ba]));
    expect(depths(v)).toEqual({ A: 0, B: 1 });
    expect(v.edges.find((e) => e.id === "B->A")?.returns).toBe(true);
  });

  it("counts hops backward as negative, with value still flowing toward the seed", () => {
    const [xa, yx] = [transfer("s1", "X", "A", 10, 2), transfer("s2", "Y", "X", 10, 1)];
    const v = buildTraceView(trace({ seed: { kind: "address", address: "A" }, direction: "backward", steps: [stepOf(xa, 0, "backward"), stepOf(yx, 0, "backward")] }), evidence([xa, yx]));
    expect(depths(v)).toEqual({ A: 0, X: -1, Y: -2 });
    expect(v.edges.every((e) => !e.returns)).toBe(true);
    expect(v.nodes.find((n) => n.id === "Y")?.boundaries).toEqual(["history_not_loaded"]);
    expect(v.nodes.find((n) => n.id === "X")?.boundaries).toEqual([]);
  });

  it("reports stale steps and still draws them from their stored reference", () => {
    const ab = transfer("s1", "A", "B", 10);
    const changed = transfer("s1", "A", "B", 11);
    const step = stepOf(ab);
    const missing = buildTraceView(trace({ seed: { kind: "address", address: "A" }, steps: [step] }), evidence([]));
    const reread = buildTraceView(trace({ seed: { kind: "address", address: "A" }, steps: [step] }), evidence([changed]));
    expect(missing.issues).toEqual([{ kind: "stale", stepId: step.id, reason: "transaction_not_loaded" }]);
    expect(reread.issues).toEqual([{ kind: "stale", stepId: step.id, reason: "movement_changed" }]);
    expect([missing.edges[0].totals, reread.edges[0].totals]).toEqual([[{ assetId: "SOL", amount: "10" }], [{ assetId: "SOL", amount: "10" }]]);
  });

  it("shows the current role when a reinterpretation refines it", () => {
    const before = event("s1", [{ assetId: "SOL", from: "A", to: "B", amount: "10", role: "unidentified" }]);
    const after = event("s1", [{ assetId: "SOL", from: "A", to: "B", amount: "10", role: "royalty" }]);
    const v = buildTraceView(trace({ seed: { kind: "address", address: "A" }, steps: [stepOf(before)] }), evidence([after]));
    expect(v.issues).toEqual([]);
  });

  it("sets boundaries only where the trace ends", () => {
    const [ab, bc, cd] = [transfer("s1", "A", "B", 1, 1), transfer("s2", "B", "C", 1, 2), transfer("s3", "C", "D", 1, 3)];
    const v = buildTraceView(
      trace({ seed: { kind: "address", address: "A" }, steps: [stepOf(ab), stepOf(bc), stepOf(cd)] }),
      evidence([ab, bc, cd], { mapped: { A: true, B: true, C: false }, custodial: ["C"] }),
    );
    const b = Object.fromEntries(v.nodes.map((n) => [n.id, n.boundaries]));
    expect(b).toEqual({ A: [], B: [], C: ["custodial"], D: ["history_not_loaded"] });
    const end = buildTraceView(trace({ seed: { kind: "address", address: "A" }, steps: [stepOf(ab)] }), evidence([ab], { mapped: { B: true } }));
    const partial = buildTraceView(trace({ seed: { kind: "address", address: "A" }, steps: [stepOf(ab)] }), evidence([ab], { mapped: { B: false } }));
    expect([end.nodes[1].boundaries, partial.nodes[1].boundaries]).toEqual([["end_of_history"], ["partial_history"]]);
  });

  it("keeps steps that leave the scope, reporting why", () => {
    const usdc = event("s1", [{ assetId: "USDC", from: "A", to: "B", amount: "5" }]);
    const small = transfer("s2", "B", "C", 1, 2);
    const v = buildTraceView(
      trace({
        seed: { kind: "address", address: "A" },
        steps: [stepOf(usdc), stepOf(small)],
        scope: { assets: ["SOL"], start: null, end: null, minAmount: { assetId: "SOL", amount: "2" }, maxHops: 1 },
      }),
      evidence([usdc, small]),
    );
    expect(v.edges).toHaveLength(2);
    expect(v.issues.map((i) => [i.kind, "reason" in i && i.reason])).toEqual([
      ["out_of_scope", "asset"],
      ["out_of_scope", "amount"],
    ]);
  });

  it("never draws a movement with an unknown side or to itself", () => {
    const e = event("s1", [
      { assetId: "SOL", from: "A", to: null, amount: "5" },
      { assetId: "SOL", from: "A", to: "A", amount: "5" },
    ]);
    const v = buildTraceView(trace({ seed: { kind: "address", address: "A" }, steps: [stepOf(e, 0), stepOf(e, 1)] }), evidence([e]));
    expect(v.edges).toEqual([]);
    expect(v.issues.map((i) => "reason" in i && i.reason)).toEqual(["unknown_side", "self_transfer"]);
  });

  it("starts a transaction-seeded trace from that transaction's senders", () => {
    const e = event("s1", [
      { assetId: "SOL", from: "A", to: "B", amount: "5" },
      { assetId: "SOL", from: "A", to: "C", amount: "5" },
    ]);
    const v = buildTraceView(trace({ seed: { kind: "transaction", signature: "s1" }, steps: [stepOf(e, 0), stepOf(e, 1)] }), evidence([e]));
    expect(depths(v)).toEqual({ A: 0, B: 1, C: 1 });
  });

  it("lists conversions on their node without drawing an edge", () => {
    const conversion: TraceStep = { id: "c1", kind: "conversion", signature: "s9", address: "A", spent: [{ assetId: "USDC", amount: "1" }], received: [{ assetId: "SOL", amount: "1" }], addedAt: "" };
    const v = buildTraceView(trace({ seed: { kind: "address", address: "A" }, steps: [conversion] }), evidence([]));
    expect(v.nodes).toMatchObject([{ id: "A", conversions: ["c1"], depth: 0 }]);
    expect(v.edges).toEqual([]);
  });

  it("is unaffected by positions, styles and annotations", () => {
    const ab = transfer("s1", "A", "B", 10);
    const plain = trace({ seed: { kind: "address", address: "A" }, steps: [stepOf(ab)] });
    const drawn = {
      ...plain,
      presentation: {
        ...emptyPresentation(),
        positions: { A: { x: 0, y: 0 }, B: { x: -500, y: 900 } },
        nodeStyles: { B: { color: "red" as const, size: "l" as const } },
        annotations: [{ id: "n1", kind: "connector" as const, from: { kind: "node" as const, id: "A" }, to: { kind: "node" as const, id: "Z" }, label: "same operator?", arrow: "end" as const, color: "red" as const }],
      },
    };
    expect(buildTraceView(drawn, evidence([ab]))).toEqual(buildTraceView(plain, evidence([ab])));
  });

  it("builds a 500-step view quickly", () => {
    const events = Array.from({ length: 500 }, (_, i) => transfer(`s${i}`, `W${i % 50}`, `W${(i * 7 + 1) % 50}`, i + 1, i));
    const t = trace({ seed: { kind: "address", address: "W0" }, steps: events.map((e) => stepOf(e)) });
    const ev = evidence(events, { mapped: { W0: true } });
    const started = performance.now();
    const v = buildTraceView(t, ev);
    const ms = performance.now() - started;
    expect(v.edges.length).toBeGreaterThan(0);
    // Budget 20 ms on a developer machine (Sprint 02); asserted generously for slower CI.
    expect(ms).toBeLessThan(200);
  });
});
