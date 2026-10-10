import { isExposed, PRESET_KEYS, type PreferenceValues, SETTING_KEYS, SETTINGS, type SettingKey, type SettingValue } from "./schema";

export type DetailPresetId = SettingValue<"investigation.detailPreset">;

/**
 * How much each investigation view shows by default. Presets only set the
 * preset-controlled keys; Balanced equals the defaults, which equal how
 * FraudWatch behaved before preferences. Forensic stops short of drawing
 * everything: 100 addresses, not all, and the big-graph confirmation stays on.
 * Anything a preset hides is counted on screen and can be shown again.
 */
export const DETAIL_PRESETS: Record<DetailPresetId, { name: string; summary: string; values: PreferenceValues }> = {
  minimal: {
    name: "Minimal",
    summary: "The main movements between wallets. Program calls and dust are hidden, and only the busiest addresses are drawn.",
    values: {
      "graph.nodeLimit": "10",
      "graph.programs": "hidden",
      "graph.knownServices": "collapsed",
      "graph.lowValue": "hidden",
      "timeline.connectors": "selected",
      "timeline.programInteractions": "hidden",
    },
  },
  balanced: {
    name: "Balanced",
    summary: "Recommended. Every movement, with services grouped and program calls kept off the graph.",
    values: {
      "graph.nodeLimit": "25",
      "graph.programs": "hidden",
      "graph.knownServices": "collapsed",
      "graph.lowValue": "shown",
      "timeline.connectors": "always",
      "timeline.programInteractions": "shown",
    },
  },
  forensic: {
    name: "Forensic",
    summary: "Program calls, service addresses and low-value movements, with up to 100 addresses on the graph.",
    values: {
      "graph.nodeLimit": "100",
      "graph.programs": "shown",
      "graph.knownServices": "expanded",
      "graph.lowValue": "shown",
      "timeline.connectors": "always",
      "timeline.programInteractions": "shown",
    },
  },
};

/** A preset the user saved: any per-case settings, under their own name. Referenced as `custom:<id>`. */
export type CustomPreset = { id: string; name: string; description?: string; values: PreferenceValues };

/** What `investigation.detailPreset` can hold: a built-in preset, or a saved one. */
export type PresetRef = DetailPresetId | `custom:${string}`;
export const customRef = (id: string): PresetRef => `custom:${id}`;
const isBuiltIn = (ref: string): ref is DetailPresetId => Object.hasOwn(DETAIL_PRESETS, ref);

export type ActivePreset = { ref: PresetRef; name: string; values: PreferenceValues; builtIn: boolean; controls: SettingKey[] };

/** The preset `ref` names, or null when it's a saved preset that no longer exists. */
export function findPreset(ref: string, customs: readonly CustomPreset[]): ActivePreset | null {
  if (isBuiltIn(ref)) return { ref, name: DETAIL_PRESETS[ref].name, values: DETAIL_PRESETS[ref].values, builtIn: true, controls: PRESET_KEYS };
  const custom = ref.startsWith("custom:") ? customs.find((p) => customRef(p.id) === ref) : undefined;
  return custom ? { ref: customRef(custom.id), name: custom.name, values: custom.values, builtIn: false, controls: Object.keys(custom.values) as SettingKey[] } : null;
}

/** The active preset; a missing saved preset (deleted, or not loaded yet) reads as Balanced, with `missing` set. */
export function activePreset(global: PreferenceValues, customs: readonly CustomPreset[] = []): ActivePreset & { missing: boolean } {
  const ref = global["investigation.detailPreset"] ?? "balanced";
  const found = findPreset(ref, customs);
  return found ? { ...found, missing: false } : { ...findPreset("balanced", customs)!, missing: true };
}

/** What the active preset supplies. */
export function presetLayer(global: PreferenceValues, customs: readonly CustomPreset[] = []): PreferenceValues {
  return activePreset(global, customs).values;
}

/** Settings the active preset controls that the user has set globally to something else. */
export function customisedKeys(global: PreferenceValues, customs: readonly CustomPreset[] = []): SettingKey[] {
  const { controls, values } = activePreset(global, customs);
  return controls.filter((key) => global[key] !== undefined && global[key] !== values[key]);
}

/**
 * The global changes that apply a preset: select it, and clear the explicit
 * global choices for the settings it controls so its values show. Case
 * overrides are never part of this.
 */
export function presetChanges(preset: ActivePreset): PreferenceValues {
  return { "investigation.detailPreset": preset.ref, ...Object.fromEntries(preset.controls.map((key) => [key, undefined])) } as PreferenceValues;
}

/** How applying a preset would change the current resolved values, for the preview. Only settings a view uses are listed. */
export function presetPreview(preset: ActivePreset, current: (key: SettingKey) => string): { key: SettingKey; from: string; to: string }[] {
  return preset.controls.filter(isExposed).flatMap((key) => {
    const to = preset.values[key] ?? SETTINGS[key].default;
    return current(key) === to ? [] : [{ key, from: current(key), to }];
  });
}

/** The settings a saved preset may hold: everything a case can override that a view uses. */
export const PRESETTABLE_KEYS = SETTING_KEYS.filter((key) => SETTINGS[key].scope === "case" && isExposed(key));

/** The resolved values of every setting a preset can hold: what saving the current settings captures. */
export const presetValuesFrom = (get: (key: SettingKey) => string): PreferenceValues =>
  Object.fromEntries(PRESETTABLE_KEYS.map((key) => [key, get(key)])) as PreferenceValues;
