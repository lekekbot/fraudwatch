/**
 * Every display preference FraudWatch knows: its allowed values, default, and
 * whether a case may override it. Preferences change how evidence is shown,
 * never the evidence. Every setting is an enum, so validation is membership
 * and every control is a list of choices.
 *
 * Defaults (and the Balanced preset) equal how FraudWatch behaved before
 * preferences existed, so nobody's view changes until they change a setting.
 */

/** global: one value for every case. case: a global default that a case may override. */
export type Scope = "global" | "case";

type SettingDef = {
  values: readonly string[];
  default: string;
  scope: Scope;
  /** Set by the detail presets (Minimal / Balanced / Forensic). */
  preset?: true;
  /** Defined and validated but not shown anywhere yet. */
  exposed?: false;
  /** Values allowed besides `values`, by pattern: a saved custom preset's id. */
  pattern?: RegExp;
};

export const SETTINGS = {
  "appearance.theme": { values: ["system", "light", "dark"], default: "system", scope: "global" },
  "appearance.motion": { values: ["system", "reduced", "full"], default: "system", scope: "global" },
  "appearance.addressFormat": { values: ["short", "medium", "full"], default: "short", scope: "global" },
  "appearance.numberFormat": { values: ["full", "compact"], default: "full", scope: "global" },

  "labels.preferNames": { values: ["on", "off"], default: "on", scope: "case" },
  "labels.community": { values: ["shown", "hidden"], default: "shown", scope: "case" },
  "labels.sns": { values: ["shown", "hidden"], default: "shown", scope: "case" },

  "investigation.startView": { values: ["timeline", "graph", "table", "last"], default: "timeline", scope: "global" },
  "investigation.inspector": { values: ["open", "on_selection", "closed"], default: "open", scope: "global" },
  "investigation.detailPreset": { values: ["minimal", "balanced", "forensic"], default: "balanced", scope: "global", pattern: /^custom:[A-Za-z0-9-]{1,64}$/ },

  "graph.nodeLimit": { values: ["10", "25", "50", "100", "all"], default: "25", scope: "case", preset: true },
  "graph.programs": { values: ["hidden", "shown"], default: "hidden", scope: "case", preset: true },
  "graph.knownServices": { values: ["collapsed", "expanded"], default: "collapsed", scope: "case", preset: true },
  "graph.lowValue": { values: ["shown", "faded", "hidden"], default: "shown", scope: "case", preset: true },
  "graph.spacing": { values: ["compact", "normal", "wide", "widest"], default: "normal", scope: "case" },
  "graph.arrows": { values: ["all", "selected"], default: "all", scope: "case" },
  "graph.confirmLarge": { values: ["on", "off"], default: "on", scope: "global" },

  "timeline.density": { values: ["compact", "comfortable", "spacious"], default: "comfortable", scope: "case" },
  "timeline.connectors": { values: ["always", "hover", "selected"], default: "always", scope: "case", preset: true },
  "timeline.programInteractions": { values: ["shown", "hidden"], default: "shown", scope: "case", preset: true },
  "timeline.nft": { values: ["shown", "hidden"], default: "shown", scope: "case" },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;
/** A setting's allowed values; the detail preset can also name a saved preset (`custom:<id>`). */
export type SettingValue<K extends SettingKey> = K extends "investigation.detailPreset"
  ? (typeof SETTINGS)[K]["values"][number] | `custom:${string}`
  : (typeof SETTINGS)[K]["values"][number];
/** Sparse: only values someone chose. A missing key is inherited. */
export type PreferenceValues = { [K in SettingKey]?: SettingValue<K> };

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const PREFERENCES_SCHEMA_VERSION = 1;

export type Category = "appearance" | "labels" | "investigation" | "graph" | "timeline";
export const categoryOf = (key: SettingKey) => key.slice(0, key.indexOf(".")) as Category;
export const keysOfCategory = (category: Category) => SETTING_KEYS.filter((k) => categoryOf(k) === category);
export const isExposed = (key: SettingKey) => (SETTINGS[key] as SettingDef).exposed !== false;
export const isPresetControlled = (key: SettingKey) => (SETTINGS[key] as SettingDef).preset === true;
export const PRESET_KEYS = SETTING_KEYS.filter(isPresetControlled);

const isKey = (key: string): key is SettingKey => Object.hasOwn(SETTINGS, key);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function isValidValue(key: SettingKey, value: unknown): boolean {
  const def = SETTINGS[key] as SettingDef;
  return typeof value === "string" && (def.values.includes(value) || (def.pattern?.test(value) ?? false));
}

/**
 * Stored values, typed. Unknown keys (from a newer version, or removed ones),
 * invalid values, and global-only keys in a case's overrides are left out and
 * nothing throws: a left-out key is simply inherited.
 */
export function readValues(raw: unknown, scope: Scope): { values: PreferenceValues; invalid: string[] } {
  const values: Record<string, string> = {};
  const invalid: string[] = [];
  if (!isObject(raw)) return { values, invalid };
  for (const [key, value] of Object.entries(raw)) {
    if (!isKey(key)) continue;
    if (scope === "case" && SETTINGS[key].scope !== "case") continue;
    if (isValidValue(key, value)) values[key] = value as string;
    else invalid.push(key);
  }
  return { values: values as PreferenceValues, invalid };
}

/**
 * Raw values to store after a change: known keys with invalid values are
 * dropped, unknown keys are kept so a newer version's settings survive an
 * older one writing.
 */
export function sanitizeForWrite(raw: unknown): Record<string, unknown> {
  if (!isObject(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([key, value]) => !isKey(key) || isValidValue(key, value)));
}

/** Steps that bring stored values from one schema version to the next. Empty at version 1. */
const MIGRATIONS: { from: number; migrate: (values: Record<string, unknown>) => Record<string, unknown> }[] = [];

/** Raw stored values brought from `fromVersion` to the current version. Unchanged at the current version or newer. */
export function migrateValues(raw: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  let values = raw;
  for (const step of MIGRATIONS) if (step.from >= fromVersion) values = step.migrate(values);
  return values;
}

/** A stored document's values, migrated; `{}` for anything that isn't a document. */
export function storedValues(doc: unknown): Record<string, unknown> {
  if (!isObject(doc) || !isObject(doc.values)) return {};
  const version = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 1;
  return migrateValues(doc.values, version);
}
