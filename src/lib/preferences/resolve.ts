import { type PreferenceValues, SETTING_KEYS, SETTINGS, type SettingKey, type SettingValue } from "./schema";

/** Where a resolved value came from. */
export type Origin = "default" | "preset" | "global" | "case";

export type Layers = {
  global: PreferenceValues;
  /** What the active detail preset supplies; only preset-controlled keys are read from it. */
  preset: PreferenceValues;
  /** A case's overrides; only case-scoped keys are read from it. */
  caseOverrides?: PreferenceValues;
};

export type Resolved = {
  get<K extends SettingKey>(key: K): SettingValue<K>;
  origin(key: SettingKey): Origin;
};

/**
 * Per key, highest wins: case override > explicit global choice > active preset > default.
 * The preset sits below explicit global choices so a change made after picking
 * a preset sticks (and shows the preset as customised); applying a preset
 * clears those choices instead (see `applyDetailPreset`).
 */
export function resolvePreferences({ global, preset, caseOverrides = {} }: Layers): Resolved {
  const values = {} as Record<SettingKey, string>;
  const origins = {} as Record<SettingKey, Origin>;
  for (const key of SETTING_KEYS) {
    let value: string = SETTINGS[key].default;
    let origin: Origin = "default";
    // Built-in presets set the detail settings; a saved preset may set any per-case setting. Never a global-only one.
    if (SETTINGS[key].scope === "case" && preset[key] !== undefined) [value, origin] = [preset[key], "preset"];
    if (global[key] !== undefined) [value, origin] = [global[key], "global"];
    if (SETTINGS[key].scope === "case" && caseOverrides[key] !== undefined) [value, origin] = [caseOverrides[key], "case"];
    values[key] = value;
    origins[key] = origin;
  }
  return {
    get: <K extends SettingKey>(key: K) => values[key] as SettingValue<K>,
    origin: (key) => origins[key],
  };
}
