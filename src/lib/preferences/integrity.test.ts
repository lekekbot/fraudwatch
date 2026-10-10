import { describe, expect, it } from "vitest";
import { createCase, type FraudWatchCase } from "@/lib/case/model";
import { applyPresetToCase, setCaseOverride, updateViewSettings } from "@/lib/case/view-settings";
import type { FraudWatchDB } from "@/lib/db/db";
import { resetGlobalPreferences, setGlobalPreference, setGlobalPreferences } from "@/lib/db/preferences";
import { createViewPreset, deleteViewPreset, duplicateViewPreset, importSettings, renameViewPreset } from "@/lib/db/view-presets";
import { findPreset, presetChanges } from "./presets";

/**
 * Settings only change how evidence is shown. Every write path here runs
 * against a database that has only the settings tables and a case table whose
 * writes are recorded: touching transactions, wallet states, labels or anything
 * else throws, and a case write may only change `viewSettings`.
 */
function guardedDb(fwCase: FraudWatchCase) {
  const caseWrites: Partial<FraudWatchCase>[] = [];
  const tables = new Map<string, Map<string, unknown>>([["preferences", new Map()], ["view_presets", new Map()]]);
  const table = (name: string) => ({
    get: async (key: string) => tables.get(name)!.get(key),
    put: async (row: { id: string }) => void tables.get(name)!.set(row.id, row),
    update: async (key: string, patch: object) => {
      if (!tables.get(name)!.has(key)) return 0;
      tables.get(name)!.set(key, { ...(tables.get(name)!.get(key) as object), ...patch });
      return 1;
    },
    delete: async (key: string) => void tables.get(name)!.delete(key),
    toArray: async () => [...tables.get(name)!.values()],
  });
  const target = {
    preferences: table("preferences"),
    view_presets: table("view_presets"),
    cases: {
      get: async () => fwCase,
      update: async (_id: string, patch: Partial<FraudWatchCase>) => {
        caseWrites.push(patch);
        return 1;
      },
    },
    transaction: async (...args: unknown[]) => (args.at(-1) as () => Promise<unknown>)(),
  };
  const db = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop as keyof typeof t];
      throw new Error(`A settings write touched "${String(prop)}"`);
    },
  }) as unknown as FraudWatchDB;
  return { db, caseWrites };
}

describe("settings never touch evidence", () => {
  it("global settings, presets, import and case overrides write only settings", async () => {
    const fwCase = createCase({ name: "A", primaryWallet: "W", range: { start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z" } }, { id: "a" });
    const { db, caseWrites } = guardedDb(fwCase);

    await setGlobalPreference(db, "graph.spacing", "wide");
    await setGlobalPreferences(db, presetChanges(findPreset("forensic", [])!));
    await resetGlobalPreferences(db, "all");
    const preset = await createViewPreset(db, { name: "P", values: { "graph.arrows": "selected" } });
    await renameViewPreset(db, preset.id, "Q");
    await duplicateViewPreset(db, preset);
    await importSettings(db, { presets: [{ name: "Q", values: { "timeline.nft": "hidden" } }], settings: { "appearance.theme": "dark" } });
    await deleteViewPreset(db, preset.id);
    await updateViewSettings(db, "a", (c) => setCaseOverride(c, "timeline.density", "compact"));
    await updateViewSettings(db, "a", (c) => applyPresetToCase(c, { ref: "forensic", name: "Forensic", values: { "graph.programs": "shown" } }));

    expect(caseWrites.length).toBe(2);
    for (const patch of caseWrites) expect(Object.keys(patch)).toEqual(["viewSettings"]);
  });
});
