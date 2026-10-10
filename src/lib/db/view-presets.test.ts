import { describe, expect, it } from "vitest";
import type { FraudWatchDB } from "./db";
import type { GlobalPreferencesRecord } from "./preferences";
import { checkPresetName, importSettings, toCustomPreset, uniqueName, type ViewPresetRecord } from "./view-presets";

function stubDb() {
  const presets = new Map<string, ViewPresetRecord>();
  let prefs: GlobalPreferencesRecord | undefined;
  const db = {
    view_presets: { toArray: async () => [...presets.values()], put: async (r: ViewPresetRecord) => void presets.set(r.id, r) },
    preferences: { get: async () => prefs, put: async (r: GlobalPreferencesRecord) => void (prefs = r) },
    transaction: async (...args: unknown[]) => (args.at(-1) as () => Promise<unknown>)(),
  } as unknown as FraudWatchDB;
  return { db, presets, prefs: () => prefs };
}

describe("saved preset storage", () => {
  it("names: trimmed, required, and made unique ignoring case", () => {
    expect(checkPresetName("  Token flow ")).toBe("Token flow");
    expect(() => checkPresetName("   ")).toThrow();
    expect(uniqueName("Forensic", ["forensic"])).toBe("Forensic (2)");
    expect(uniqueName("A", ["A", "A (2)"])).toBe("A (3)");
    expect(uniqueName("New", ["Old"])).toBe("New");
  });

  it("reads only the per-case settings a preset may hold", () => {
    const record: ViewPresetRecord = { id: "p", name: "P", schemaVersion: 1, values: { "graph.spacing": "wide", "appearance.theme": "dark", "graph.nodeLimit": "7" }, createdAt: "", updatedAt: "" };
    expect(toCustomPreset(record).values).toEqual({ "graph.spacing": "wide" });
  });

  it("imports presets with clashing names renamed, and settings only when asked", async () => {
    const { db, presets, prefs } = stubDb();
    const ids = await importSettings(db, {
      presets: [
        { name: "Forensic", values: { "graph.arrows": "selected" } },
        { name: "Mine", values: { "graph.spacing": "wide" } },
        { name: "Mine", values: { "graph.spacing": "compact" } },
      ],
      settings: null,
      reserved: ["Minimal", "Balanced", "Forensic"],
    });
    expect(ids).toHaveLength(3);
    expect([...presets.values()].map((p) => p.name)).toEqual(["Forensic (2)", "Mine", "Mine (2)"]);
    expect(prefs()).toBeUndefined();
    await importSettings(db, { presets: [], settings: { "appearance.theme": "dark" } });
    expect(prefs()?.values).toEqual({ "appearance.theme": "dark" });
  });
});
