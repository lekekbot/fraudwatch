import { describe, expect, it } from "vitest";
import type { SemanticEvent } from "@/lib/semantic/events";
import { branchOf, focusPath, hideBranches, summarizeBranch } from "./branches";
import { removeSteps, setBranchHidden } from "./edit";
import { stepOf, trace, transfer } from "./testing";
import { buildTraceView, type TraceEvidence } from "./view";

const evidence = (events: SemanticEvent[]): TraceEvidence => ({
  events: new Map(events.map((e) => [e.signature, e])),
  coverage: () => null,
  addressState: () => "OBSERVED",
  isCustodial: () => false,
});

/** Synthetic: `[from, to, amount]` transfers in slot order, seeded at A. */
function build(moves: [string, string, number][]) {
  const events = moves.map(([from, to, amount], i) => transfer(`s${i}`, from, to, amount, i + 1));
  const t = trace({ seed: { kind: "address", address: "A" }, steps: events.map((e) => stepOf(e)) });
  return { trace: t, view: buildTraceView(t, evidence(events)) };
}

describe("trace branches", () => {
  it("F6: a cycle terminates and the return target stays outside the branch", () => {
    const { view } = build([["A", "B", 10], ["B", "C", 6], ["C", "A", 4]]);
    const b = branchOf(view, "B", "forward");
    expect([...b.nodes]).toEqual(["C"]);
    expect([...b.edges].sort()).toEqual(["B->C", "C->A"]);
    expect(summarizeBranch(view, b)).toMatchObject({ steps: 2, nodes: 1, returnsTo: ["A"], totals: [{ assetId: "SOL", amount: "10" }] });
  });

  it("synthetic ring of 5: hiding a branch never loops and keeps every step", () => {
    const { trace: t, view } = build([["A", "B", 1], ["B", "C", 1], ["C", "D", 1], ["D", "E", 1], ["E", "A", 1]]);
    const hidden = hideBranches(view, ["B"]);
    // D and E are also one and two hops behind the seed (E → A), so they stay drawn; only C is behind B alone.
    expect(hidden.view.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "D", "E"]);
    expect(hidden.counts.get("B")).toBe(2);
    expect(hidden.anchors.get("C")).toBe("B");
    expect(setBranchHidden(t, "B", true).steps).toBe(t.steps);
  });

  it("a merge counts each step once and keeps a node reached by a visible path", () => {
    const { view } = build([["A", "B", 5], ["A", "D", 7], ["B", "C", 3], ["D", "C", 2]]);
    const b = branchOf(view, "B", "forward");
    expect(summarizeBranch(view, b).totals).toEqual([{ assetId: "SOL", amount: "3" }]);
    const hidden = hideBranches(view, ["B"]);
    expect(hidden.view.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C", "D"]);
    expect(hidden.view.edges.map((e) => e.id).sort()).toEqual(["A->B", "A->D", "B->C", "D->C"]);
    expect(hidden.counts.get("B")).toBe(0);
  });

  it("synthetic fan-out 1→200 and fan-in 200→1 summarise once per step", () => {
    const out = build([["A", "B", 500], ...Array.from({ length: 200 }, (_, i): [string, string, number] => ["B", `X${i}`, 1])]);
    expect(summarizeBranch(out.view, branchOf(out.view, "B", "forward"))).toMatchObject({ steps: 200, nodes: 200, totals: [{ assetId: "SOL", amount: "200" }] });
    const fanIn = build([["A", "H", 1], ...Array.from({ length: 200 }, (_, i): [string, string, number] => [`Y${i}`, "Z", 2]), ["H", "Z", 3]]);
    const hub = branchOf(fanIn.view, "H", "forward");
    expect(summarizeBranch(fanIn.view, hub).steps).toBe(1);
  });

  it("synthetic repeated pair with 50 movements is one bundled edge, summed once", () => {
    const { view } = build([["A", "B", 1], ...Array.from({ length: 50 }, (): [string, string, number] => ["B", "C", 2])]);
    expect(view.edges.find((e) => e.id === "B->C")?.steps).toHaveLength(50);
    expect(summarizeBranch(view, branchOf(view, "B", "forward"))).toMatchObject({ steps: 50, totals: [{ assetId: "SOL", amount: "100" }] });
  });

  it("backward branches mirror forward ones", () => {
    const { view } = build([["P", "Q", 4], ["Q", "A", 3], ["A", "B", 1]]);
    const q = branchOf(view, "Q", "backward");
    expect([...q.nodes]).toEqual(["P"]);
    expect(hideBranches(view, ["Q"]).view.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "Q"]);
  });

  it("ignores the seed and unknown nodes as roots", () => {
    const { view } = build([["A", "B", 1]]);
    expect(hideBranches(view, ["A", "nope"]).view).toBe(view);
  });

  it("focus path is the shortest by steps and deterministic", () => {
    const { view } = build([["A", "B", 1], ["B", "C", 1], ["A", "D", 1], ["D", "C", 1], ["C", "E", 1]]);
    const path = focusPath(view, "E")!;
    expect([...path.nodes].sort()).toEqual(["A", "B", "C", "E"]);
    expect([...path.edges].sort()).toEqual(["A->B", "B->C", "C->E"]);
    expect(focusPath(view, "E")).toEqual(path);
    expect(focusPath(view, "missing")).toBeNull();
  });

  it("removing a branch root's steps prunes the hidden entry", () => {
    const { trace: t } = build([["A", "B", 1], ["B", "C", 1]]);
    const hidden = setBranchHidden(t, "B", true);
    expect(removeSteps(hidden, new Set(hidden.steps.map((s) => s.id))).presentation.hiddenBranches).toEqual([]);
  });
});
