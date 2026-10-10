import { describe, expect, it } from "vitest";
import { createCase, type FraudWatchCase } from "./model";
import type { FraudWatchDB } from "@/lib/db/db";
import { applyPresetToCase, caseOverrides, clearCaseOverrides, setCaseOverride, setCaseOverrides, updateViewSettings } from "./view-settings";

const base = (): FraudWatchCase => ({
  ...createCase({ name: "A", primaryWallet: "W", range: { start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z" } }, { id: "a", now: new Date("2026-01-01") }),
  hideRules: [{ id: "r", name: "dust", enabled: true, kinds: ["RECEIVE"] }],
  hiddenLanes: ["X"],
  bookmarks: [{ id: "b", kind: "wallet", target: "W", createdAt: "2026-01-01" }],
});

describe("case view settings", () => {
  it("sets and clears overrides without touching anything else on the case", () => {
    const c = base();
    const withOverride = { ...c, viewSettings: setCaseOverride(c, "graph.spacing", "wide") };
    expect(caseOverrides(withOverride)).toEqual({ "graph.spacing": "wide" });
    expect({ ...withOverride, viewSettings: c.viewSettings }).toEqual(c);
    const cleared = { ...withOverride, viewSettings: clearCaseOverrides(withOverride, "all") };
    expect(caseOverrides(cleared)).toEqual({});
  });

  it("refuses to override a setting that applies to every case", () => {
    expect(() => setCaseOverride(base(), "appearance.theme" as never, "dark" as never)).toThrow();
    expect(() => setCaseOverrides(base(), { "appearance.theme": "dark" })).toThrow();
  });

  it("reads malformed view settings as no overrides", () => {
    for (const viewSettings of ["x", [], { values: null }, { values: { "graph.spacing": "huge" } }] as never[]) {
      expect(caseOverrides({ viewSettings })).toEqual({});
    }
  });

  it("restores several overrides at once, clearing those set to undefined", () => {
    const c = { ...base(), viewSettings: setCaseOverride(base(), "graph.arrows", "selected") };
    expect(caseOverrides({ viewSettings: setCaseOverrides(c, { "graph.arrows": undefined, "timeline.nft": "hidden" }) })).toEqual({ "timeline.nft": "hidden" });
  });
});

describe("saving case view settings", () => {
  it("applies each change to the case as stored, so quick changes don't overwrite each other", async () => {
    let stored = base();
    // Like Dexie, read-write transactions on one table run one after another.
    let queue = Promise.resolve();
    const db = {
      cases: { get: async () => stored, update: async (_id: string, patch: Partial<FraudWatchCase>) => void (stored = { ...stored, ...patch }) },
      transaction: (_mode: string, _table: unknown, fn: () => Promise<void>) => (queue = queue.then(fn)),
    } as unknown as FraudWatchDB;
    // Both made from the same (stale) copy in the UI; neither should lose the other.
    await Promise.all([updateViewSettings(db, "a", (c) => setCaseOverride(c, "timeline.density", "compact")), updateViewSettings(db, "a", (c) => setCaseOverride(c, "graph.arrows", "selected"))]);
    expect(caseOverrides(stored)).toEqual({ "timeline.density": "compact", "graph.arrows": "selected" });
    expect(stored.hideRules).toEqual(base().hideRules);
  });
});

describe("applying a preset to a case", () => {
  it("copies its values in as overrides, keeps the case's others, and notes where they came from", () => {
    const c = { ...base(), viewSettings: setCaseOverride(base(), "timeline.density", "compact") };
    const next = applyPresetToCase(c, { ref: "forensic", name: "Forensic", values: { "graph.programs": "shown", "appearance.theme": "dark" } as never }, new Date("2026-10-09T00:00:00Z"));
    expect(caseOverrides({ viewSettings: next })).toEqual({ "timeline.density": "compact", "graph.programs": "shown" });
    expect(next.appliedPreset).toEqual({ ref: "forensic", name: "Forensic", at: "2026-10-09T00:00:00.000Z" });
  });

  it("keeps the note while overrides remain, and drops it when they're all cleared", () => {
    const c = { ...base(), viewSettings: applyPresetToCase(base(), { ref: "custom:x", name: "Mine", values: { "graph.spacing": "wide", "graph.arrows": "selected" } }) };
    const one = { ...c, viewSettings: clearCaseOverrides(c, ["graph.spacing"]) };
    expect(one.viewSettings.appliedPreset?.name).toBe("Mine");
    expect(clearCaseOverrides(one, "all").appliedPreset).toBeUndefined();
  });
});
