import { describe, expect, it } from "vitest";
import { addAnnotation, addSteps, duplicateTrace, removeAnnotations, removeSteps, renameTrace, reorderAnnotation, setBranchHidden, setCanvasOptions, setDirection, setNodeStyle, setPositions, setScope, setServiceExpanded, updateAnnotation } from "./edit";
import { event, stepOf, trace } from "./testing";

const now = new Date("2026-02-02T00:00:00.000Z");
const step = stepOf(event("s", [{ assetId: "SOL", from: "A", to: "B", amount: "5" }]));
const base = () => trace({ seed: { kind: "address", address: "A" } });

describe("pure trace edits", () => {
  it("guards duplicate movement keys and keeps identity while editing", () => {
    const start = base();
    const added = addSteps(start, [step, { ...step, id: "duplicate" }], now);
    expect(added.steps).toEqual([step]);
    expect(start.steps).toEqual([]);
    expect([added.id, added.caseId, added.createdAt]).toEqual([start.id, start.caseId, start.createdAt]);
    expect(renameTrace(added, "  New  ", now).name).toBe("New");
    expect(() => renameTrace(added, " ", now)).toThrow();
    expect(duplicateTrace(added, { id: "copy", now }).id).toBe("copy");
  });

  it("adds one conversion per signature and address and keeps service placement", () => {
    const conversion = { id: "swap", kind: "conversion" as const, signature: "s", address: "A", spent: [{ assetId: "SOL", amount: "5" }], received: [{ assetId: "USDC", amount: "10" }], addedAt: now.toISOString() };
    const saved = addSteps(base(), [conversion, { ...conversion, id: "swap-again" }], now);
    expect(saved.steps).toEqual([conversion]);
    const positioned = setPositions(addSteps(saved, [step], now), { "entity:binance": { x: 30, y: 40 }, B: { x: 100, y: 20 } }, now);
    expect(removeSteps(positioned, new Set([step.id]), now).presentation.positions).toEqual({ "entity:binance": { x: 30, y: 40 } });
  });

  it("prunes removed nodes but detaches connector ends", () => {
    const added = addSteps(base(), [step], now);
    const positioned = setPositions(added, { A: { x: 0, y: 0 }, B: { x: 200, y: 0 } }, now);
    const connected = addAnnotation(positioned, { id: "line", kind: "connector", from: { kind: "node", id: "B" }, to: { kind: "node", id: "A" }, label: "claim", arrow: "end", color: "default" }, now);
    const removed = removeSteps(connected, new Set([step.id]), now);
    expect(removed.steps).toEqual([]);
    expect(removed.presentation.positions).toEqual({ A: { x: 0, y: 0 } });
    expect(removed.presentation.annotations[0]).toMatchObject({ from: { kind: "point", at: { x: 200, y: 0 } }, to: { kind: "node", id: "A" } });
  });

  it("keeps steps when scope changes and detaches removed annotations", () => {
    const added = addSteps(base(), [step], now);
    expect(setScope(added, { ...added.scope, assets: ["USDC"] }, now).steps).toEqual([step]);
    const note = { id: "note", kind: "note" as const, at: { x: 10, y: 20 }, width: 100, text: "A note", color: "blue" as const };
    const withNote = addAnnotation(added, note, now);
    const connected = addAnnotation(withNote, { id: "line", kind: "connector", from: { kind: "annotation", id: "note" }, to: { kind: "node", id: "A" }, label: "claim", arrow: "end", color: "default" }, now);
    expect(removeAnnotations(connected, new Set(["note"]), now).presentation.annotations[0]).toMatchObject({ from: { kind: "point", at: { x: 60, y: 20 } } });
  });

  it("changes steps only through add and remove", () => {
    const added = addSteps(base(), [step], now);
    const note = { id: "note", kind: "note" as const, at: { x: 0, y: 0 }, width: 100, text: "", color: "blue" as const };
    const edits = [
      (t: typeof added) => setScope(t, { ...t.scope, maxHops: 3 }, now), (t: typeof added) => setDirection(t, "both", now), (t: typeof added) => renameTrace(t, "x", now),
      (t: typeof added) => setPositions(t, { A: { x: 1, y: 1 } }, now), (t: typeof added) => setNodeStyle(t, "A", { color: "red" }, now), (t: typeof added) => addAnnotation(t, note, now),
      (t: typeof added) => updateAnnotation(t, "note", { text: "y" }, now), (t: typeof added) => reorderAnnotation(t, "note", "back", now), (t: typeof added) => removeAnnotations(t, new Set(["note"]), now),
      (t: typeof added) => setCanvasOptions(t, { grid: true }, now), (t: typeof added) => setServiceExpanded(t, "p", true, now), (t: typeof added) => setBranchHidden(t, "B", true, now),
    ];
    let current = added;
    for (const edit of edits) { current = edit(current); expect(current.steps).toBe(added.steps); }
  });
});
