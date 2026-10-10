import type { CustomPreset } from "@/lib/preferences/presets";
import { PREFERENCES_SCHEMA_VERSION, type PreferenceValues, readValues, storedValues } from "@/lib/preferences/schema";
import type { FraudWatchDB } from "./db";
import { setGlobalPreferences } from "./preferences";

/** A saved preset as stored. `values` is untrusted at rest; read it through `toCustomPreset`. */
export type ViewPresetRecord = {
  id: string;
  name: string;
  description?: string;
  schemaVersion: number;
  values: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export const MAX_PRESET_NAME = 60;
export const MAX_PRESET_DESCRIPTION = 280;

/** Only per-case settings a preset may hold survive; anything else in storage is ignored. */
export function toCustomPreset(record: ViewPresetRecord): CustomPreset {
  return { id: record.id, name: record.name, ...(record.description ? { description: record.description } : {}), values: readValues(storedValues(record), "case").values };
}

export async function listViewPresets(db: FraudWatchDB): Promise<CustomPreset[]> {
  const records = await db.view_presets.orderBy("name").toArray();
  return records.map(toCustomPreset);
}

/** A trimmed name, or throws with a message to show: 1–60 characters. */
export function checkPresetName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A preset needs a name.");
  if (trimmed.length > MAX_PRESET_NAME) throw new Error(`Keep the name under ${MAX_PRESET_NAME} characters.`);
  return trimmed;
}

/** `name`, or "name (2)", "name (3)"… so it doesn't repeat one of `taken` (ignoring case). */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) if (!used.has(`${name} (${n})`.toLowerCase())) return `${name} (${n})`;
}

export async function createViewPreset(
  db: FraudWatchDB,
  input: { name: string; description?: string; values: PreferenceValues },
  deps: { id?: string; now?: Date } = {},
): Promise<CustomPreset> {
  const now = (deps.now ?? new Date()).toISOString();
  const record: ViewPresetRecord = {
    id: deps.id ?? crypto.randomUUID(),
    name: checkPresetName(input.name),
    ...(input.description?.trim() ? { description: input.description.trim().slice(0, MAX_PRESET_DESCRIPTION) } : {}),
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    values: { ...input.values },
    createdAt: now,
    updatedAt: now,
  };
  await db.view_presets.put(record);
  return toCustomPreset(record);
}

export async function renameViewPreset(db: FraudWatchDB, id: string, name: string, now = new Date()): Promise<void> {
  const updated = await db.view_presets.update(id, { name: checkPresetName(name), updatedAt: now.toISOString() });
  if (!updated) throw new Error("That preset no longer exists.");
}

/** A copy named "Copy of …", made unique among the saved presets. */
export async function duplicateViewPreset(db: FraudWatchDB, preset: CustomPreset, deps: { id?: string; now?: Date } = {}): Promise<CustomPreset> {
  const taken = (await db.view_presets.toArray()).map((p) => p.name);
  return createViewPreset(db, { name: uniqueName(`Copy of ${preset.name}`.slice(0, MAX_PRESET_NAME), taken), description: preset.description, values: preset.values }, deps);
}

/** Cases it was applied to keep their settings: they were copied in when it was applied. */
export async function deleteViewPreset(db: FraudWatchDB, id: string): Promise<void> {
  await db.view_presets.delete(id);
}

/**
 * Adds imported presets (each renamed if its name is taken, by a saved preset,
 * a built-in one or an earlier one in the file) and, when given, sets the
 * imported settings, all in one transaction. Returns the new presets' ids, for Undo.
 */
export async function importSettings(
  db: FraudWatchDB,
  input: { presets: readonly { name: string; description?: string; values: PreferenceValues }[]; settings?: PreferenceValues | null; reserved?: readonly string[] },
  now = new Date(),
): Promise<string[]> {
  return db.transaction("rw", db.view_presets, db.preferences, async () => {
    const taken = [...(await db.view_presets.toArray()).map((p) => p.name), ...(input.reserved ?? [])];
    const ids: string[] = [];
    for (const preset of input.presets) {
      const name = uniqueName(preset.name, taken);
      taken.push(name);
      ids.push((await createViewPreset(db, { ...preset, name }, { now })).id);
    }
    if (input.settings) await setGlobalPreferences(db, input.settings, now);
    return ids;
  });
}
