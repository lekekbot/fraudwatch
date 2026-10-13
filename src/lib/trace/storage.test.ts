import { describe, expect, it } from "vitest";
import { event, stepOf, trace } from "./testing";
import { parseTrace } from "./storage";

const saved = () => trace({ seed: { kind: "address", address: "A" }, steps: [stepOf(event("s", [{ assetId: "SOL", from: "A", to: "B", amount: "5" }]))] });

describe("trace storage parsing", () => {
  it("round trips a valid trace and preserves damaged individual steps", () => {
    const original = saved();
    expect(parseTrace(original)).toEqual({ ok: true, trace: original });
    const valid = original.steps[0];
    if (valid.kind !== "movement") throw new Error("Expected movement fixture.");
    const result = parseTrace({ ...original, steps: [valid, { ...valid, id: "bad", ref: { ...valid.ref, amount: "1.5" } }] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trace.steps).toHaveLength(1);
      expect(result.trace.invalidSteps).toHaveLength(1);
    }
  });

  it("rejects missing fields and future versions without changing raw data", () => {
    const original = saved();
    expect(parseTrace(undefined)).toEqual({ ok: false, id: "", reason: "missing" });
    expect(parseTrace({ ...original, scope: null })).toEqual({ ok: false, id: original.id, reason: "invalid", raw: { ...original, scope: null } });
    expect(parseTrace({ ...original, schemaVersion: 99 })).toEqual({ ok: false, id: original.id, reason: "newer_version", raw: { ...original, schemaVersion: 99 } });
  });

  it("migrates v0 pins and sanitizes presentation without losing bad annotations", () => {
    const original = saved();
    const result = parseTrace({ ...original, schemaVersion: 0, presentation: undefined, pins: { A: { x: 11, y: 23 }, B: { x: Infinity, y: 3 } }, invalidAnnotations: [{ id: "old" }] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migratedFrom).toBe(0);
      expect(result.trace.presentation.positions).toEqual({ A: { x: 11, y: 23 } });
      expect(result.trace.invalidAnnotations).toEqual([{ id: "old" }]);
    }
  });
});
