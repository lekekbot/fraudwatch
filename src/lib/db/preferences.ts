import { isValidValue, PREFERENCES_SCHEMA_VERSION, type PreferenceValues, readValues, sanitizeForWrite, SETTINGS, type SettingKey, type SettingValue, storedValues } from "@/lib/preferences/schema";
import type { FraudWatchDB } from "./db";

/** The one row of global preferences. `values` is sparse and untrusted at rest; read it through `readValues`. */
export type GlobalPreferencesRecord = { id: "global"; schemaVersion: number; values: Record<string, unknown>; updatedAt: string };

/** Before preferences existed, the graph kept its spacing here. */
export const LEGACY_SPACING_KEY = "fraudwatch:graph-spacing";

const ID = "global";

/** Valid global values; an unreadable row reads as no choices at all. */
export async function getGlobalPreferences(db: FraudWatchDB): Promise<PreferenceValues> {
  return readValues(storedValues(await db.preferences.get(ID)), "global").values;
}

/**
 * Read, change, write in one transaction so quick changes to different keys
 * don't lose each other. Unknown keys and the higher schema version are kept.
 */
async function update(db: FraudWatchDB, change: (values: Record<string, unknown>) => void, now: Date): Promise<void> {
  await db.transaction("rw", db.preferences, async () => {
    const stored = await db.preferences.get(ID);
    const values = sanitizeForWrite(storedValues(stored));
    change(values);
    const version = typeof stored?.schemaVersion === "number" ? Math.max(stored.schemaVersion, PREFERENCES_SCHEMA_VERSION) : PREFERENCES_SCHEMA_VERSION;
    await db.preferences.put({ id: ID, schemaVersion: version, values, updatedAt: now.toISOString() });
  });
}

export async function setGlobalPreference<K extends SettingKey>(db: FraudWatchDB, key: K, value: SettingValue<K>, now = new Date()): Promise<void> {
  if (!isValidValue(key, value)) throw new Error(`Not a value for ${key}: ${value}`);
  await update(db, (values) => void (values[key] = value), now);
}

/** Several keys at once, e.g. restoring them on Undo. `undefined` removes a key (inherited again). */
export async function setGlobalPreferences(db: FraudWatchDB, changes: PreferenceValues, now = new Date()): Promise<void> {
  for (const [key, value] of Object.entries(changes)) {
    if (value !== undefined && !isValidValue(key as SettingKey, value)) throw new Error(`Not a value for ${key}: ${value}`);
  }
  await update(
    db,
    (values) => {
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) delete values[key];
        else values[key] = value;
      }
    },
    now,
  );
}

/** Removes the keys, so they're inherited again. Touches nothing outside the preferences row. */
export async function resetGlobalPreferences(db: FraudWatchDB, keys: readonly SettingKey[] | "all", now = new Date()): Promise<void> {
  await update(
    db,
    (values) => {
      for (const key of keys === "all" ? Object.keys(SETTINGS) : keys) delete values[key];
    },
    now,
  );
}

/**
 * One-time move of the graph spacing chosen before preferences existed. A
 * valid value is imported unless a global spacing is already set; the old key
 * is removed either way. Safe to run more than once.
 */
export async function importLegacyPreferences(db: FraudWatchDB, storage: Pick<Storage, "getItem" | "removeItem"> | null): Promise<void> {
  const spacing = storage?.getItem(LEGACY_SPACING_KEY);
  if (spacing == null) return;
  const current = await getGlobalPreferences(db);
  if (current["graph.spacing"] === undefined && (SETTINGS["graph.spacing"].values as readonly string[]).includes(spacing)) {
    await setGlobalPreference(db, "graph.spacing", spacing as SettingValue<"graph.spacing">);
  }
  storage?.removeItem(LEGACY_SPACING_KEY);
}

const imported = new WeakMap<FraudWatchDB, Promise<void>>();

/** `importLegacyPreferences`, once per database connection. */
export function ensureLegacyPreferencesImported(db: FraudWatchDB): Promise<void> {
  let pending = imported.get(db);
  if (!pending) {
    pending = importLegacyPreferences(db, typeof localStorage === "undefined" ? null : localStorage);
    pending.catch(() => imported.delete(db));
    imported.set(db, pending);
  }
  return pending;
}
