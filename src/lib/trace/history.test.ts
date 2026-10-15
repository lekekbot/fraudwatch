import { describe, expect, it } from "vitest";
import { addSteps, removeSteps, renameTrace } from "./edit";
import { emptyHistory, HISTORY_CAP, push, redo, undo } from "./history";
import { event, stepOf, trace } from "./testing";

const base = trace({ seed: { kind: "address", address: "A" } });
const steps = Array.from({ length: 5 }, (_, i) => stepOf(event(`s${i}`, [{ assetId: "SOL", from: "A", to: `B${i}`, amount: "1" }])));

describe("trace history", () => {
  it("undo restores exact records, redo reapplies, a new edit clears redo", () => {
    const added = addSteps(base, steps);
    const removed = removeSteps(added, new Set(steps.map((s) => s.id)));
    let h = push(push(emptyHistory(), base), added);

    const back = undo(h, removed)!;
    expect(back.trace).toEqual(added);
    expect(back.trace.steps.map((s) => s.id)).toEqual(steps.map((s) => s.id));
    h = back.history;
    const forward = redo(h, back.trace)!;
    expect(forward.trace).toEqual(removed);

    h = push(h, added);
    expect(h.future).toEqual([]);
    expect(redo(h, renameTrace(added, "x"))).toBeNull();
    expect(undo(emptyHistory(), base)).toBeNull();
  });

  it("keeps at most the cap", () => {
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_CAP + 10; i++) h = push(h, renameTrace(base, `n${i}`));
    expect(h.past).toHaveLength(HISTORY_CAP);
    expect(h.past[0].name).toBe("n10");
  });
});
