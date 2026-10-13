import { describe, expect, it } from "vitest";
import { addAnnotation, addSteps, duplicateTrace, removeAnnotations, removeSteps, renameTrace, setPositions, setScope } from "./edit";
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
});
