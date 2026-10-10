import type { CaseView } from "@/lib/routing/case-path";
import { PREFERENCES_SCHEMA_VERSION, type PreferenceValues, readValues, sanitizeForWrite, SETTINGS, type SettingKey, type SettingValue, storedValues } from "@/lib/preferences/schema";
import type { FraudWatchDB } from "@/lib/db/db";
import type { CaseViewSettings, FraudWatchCase } from "./model";

/** The case's valid overrides; malformed data reads as none. */
export const caseOverrides = (c: Pick<FraudWatchCase, "viewSettings">): PreferenceValues => readValues(storedValues(c.viewSettings), "case").values;

function withValues(c: FraudWatchCase, change: (values: Record<string, unknown>) => void): CaseViewSettings {
  const values = sanitizeForWrite(storedValues(c.viewSettings));
  change(values);
  const stored = c.viewSettings?.schemaVersion;
  const applied = c.viewSettings?.appliedPreset;
  return {
    schemaVersion: typeof stored === "number" ? Math.max(stored, PREFERENCES_SCHEMA_VERSION) : PREFERENCES_SCHEMA_VERSION,
    values,
    // Which preset the case came from stays until its overrides are all gone.
    ...(applied && Object.keys(values).some((key) => Object.hasOwn(SETTINGS, key)) ? { appliedPreset: applied } : {}),
  };
}

/**
 * The case's view settings with a preset's values copied in as overrides (other
 * overrides are kept), noting which preset it was. Copying means a later edit
 * or deletion of the preset never changes the case.
 */
export function applyPresetToCase(c: FraudWatchCase, preset: { ref: string; name: string; values: PreferenceValues }, now = new Date()): CaseViewSettings {
  const caseValues = Object.fromEntries(Object.entries(preset.values).filter(([key]) => SETTINGS[key as SettingKey].scope === "case")) as PreferenceValues;
  const next = setCaseOverrides(c, caseValues);
  return { ...next, appliedPreset: { ref: preset.ref, name: preset.name, at: now.toISOString() } };
}

/** The case's view settings with one override set. Only case-scoped keys can be overridden. */
export function setCaseOverride<K extends SettingKey>(c: FraudWatchCase, key: K, value: SettingValue<K>): CaseViewSettings {
  if (SETTINGS[key].scope !== "case") throw new Error(`${key} applies to every case and can't be overridden.`);
  if (!(SETTINGS[key].values as readonly string[]).includes(value)) throw new Error(`Not a value for ${key}: ${value}`);
  return withValues(c, (values) => void (values[key] = value));
}

/** The case's view settings with these overrides removed, so they inherit the global values again. */
export function clearCaseOverrides(c: FraudWatchCase, keys: readonly SettingKey[] | "all"): CaseViewSettings {
  return withValues(c, (values) => {
    for (const key of keys === "all" ? Object.keys(SETTINGS) : keys) delete values[key];
  });
}

/** Several overrides at once (`undefined` clears one), e.g. restoring them on Undo. */
export function setCaseOverrides(c: FraudWatchCase, changes: PreferenceValues): CaseViewSettings {
  for (const key of Object.keys(changes) as SettingKey[]) {
    if (SETTINGS[key].scope !== "case") throw new Error(`${key} applies to every case and can't be overridden.`);
  }
  return withValues(c, (values) => {
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete values[key];
      else values[key] = value;
    }
  });
}

/**
 * Applies `change` to the case as stored now, in one transaction, and saves
 * only the view settings field: quick changes can't overwrite each other, nor
 * a hide rule or lane change made meanwhile from an older copy of the case.
 */
export async function updateViewSettings(db: FraudWatchDB, caseId: string, change: (c: FraudWatchCase) => CaseViewSettings | undefined): Promise<void> {
  await db.transaction("rw", db.cases, async () => {
    const current = await db.cases.get(caseId);
    if (!current) throw new Error("That case no longer exists.");
    await db.cases.update(caseId, { viewSettings: change(current) });
  });
}

export async function saveLastView(db: FraudWatchDB, caseId: string, view: CaseView): Promise<void> {
  await db.cases.update(caseId, { lastView: view });
}
