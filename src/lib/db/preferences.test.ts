import { describe, expect, it } from "vitest";
import type { FraudWatchDB } from "./db";
import { type GlobalPreferencesRecord, getGlobalPreferences, importLegacyPreferences, LEGACY_SPACING_KEY, resetGlobalPreferences, setGlobalPreference } from "./preferences";

/** Just the preferences table, in memory; `row` exposes what's stored. */
function stubDb(initial?: unknown) {
  const store = { row: initial as GlobalPreferencesRecord | undefined };
  const db = {
    preferences: { get: async () => store.row, put: async (r: GlobalPreferencesRecord) => void (store.row = r) },
    transaction: async (_mode: string, _table: unknown, fn: () => Promise<void>) => fn(),
  } as unknown as FraudWatchDB;
  return { db, store };
}

function stubStorage(values: Record<string, string>) {
  return { getItem: (k: string) => values[k] ?? null, removeItem: (k: string) => void delete values[k], values };
}

describe("global preferences storage", () => {
  it("round-trips a choice, and resets it to inherited", async () => {
    const { db } = stubDb();
    await setGlobalPreference(db, "graph.spacing", "wide");
    await setGlobalPreference(db, "appearance.theme", "dark");
    expect(await getGlobalPreferences(db)).toEqual({ "graph.spacing": "wide", "appearance.theme": "dark" });
    await resetGlobalPreferences(db, ["graph.spacing"]);
    expect(await getGlobalPreferences(db)).toEqual({ "appearance.theme": "dark" });
    await resetGlobalPreferences(db, "all");
    expect(await getGlobalPreferences(db)).toEqual({});
  });

  it("keeps a newer version's unknown settings and schema version when writing", async () => {
    const { db, store } = stubDb({ id: "global", schemaVersion: 3, values: { "trace.direction": "forward" }, updatedAt: "" });
    await setGlobalPreference(db, "graph.arrows", "selected");
    expect(store.row?.values).toEqual({ "trace.direction": "forward", "graph.arrows": "selected" });
    expect(store.row?.schemaVersion).toBe(3);
  });

  it("reads a corrupted row as no choices, leaves it alone, and replaces it cleanly on the next write", async () => {
    const { db, store } = stubDb("garbage");
    expect(await getGlobalPreferences(db)).toEqual({});
    expect(store.row).toBe("garbage");
    await setGlobalPreference(db, "graph.spacing", "compact");
    expect(store.row?.values).toEqual({ "graph.spacing": "compact" });
  });

  it("drops an invalid stored value on the next write", async () => {
    const { db, store } = stubDb({ id: "global", schemaVersion: 1, values: { "graph.nodeLimit": "42" }, updatedAt: "" });
    expect(await getGlobalPreferences(db)).toEqual({});
    await setGlobalPreference(db, "graph.spacing", "wide");
    expect(store.row?.values).toEqual({ "graph.spacing": "wide" });
  });

  it("refuses a value the setting doesn't have", async () => {
    const { db } = stubDb();
    await expect(setGlobalPreference(db, "graph.spacing", "huge" as never)).rejects.toThrow();
  });
});

describe("legacy graph spacing", () => {
  it("imports a valid value once and removes the old key", async () => {
    const { db } = stubDb();
    const storage = stubStorage({ [LEGACY_SPACING_KEY]: "widest" });
    await importLegacyPreferences(db, storage);
    expect(await getGlobalPreferences(db)).toEqual({ "graph.spacing": "widest" });
    expect(storage.values).toEqual({});
    await importLegacyPreferences(db, storage);
    expect(await getGlobalPreferences(db)).toEqual({ "graph.spacing": "widest" });
  });

  it("skips an invalid value, never overrides a global choice, and removes the key either way", async () => {
    const { db } = stubDb();
    const bad = stubStorage({ [LEGACY_SPACING_KEY]: "huge" });
    await importLegacyPreferences(db, bad);
    expect(await getGlobalPreferences(db)).toEqual({});
    expect(bad.values).toEqual({});
    await setGlobalPreference(db, "graph.spacing", "compact");
    const old = stubStorage({ [LEGACY_SPACING_KEY]: "wide" });
    await importLegacyPreferences(db, old);
    expect(await getGlobalPreferences(db)).toEqual({ "graph.spacing": "compact" });
    expect(old.values).toEqual({});
  });
});
