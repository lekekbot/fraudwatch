import type { CustomPreset } from "./presets";
import { migrateValues, PREFERENCES_SCHEMA_VERSION, type PreferenceValues, readValues } from "./schema";

/**
 * Settings and saved presets as a file, to move them between browsers or share
 * them. It holds display settings only: no cases, labels, transactions or RPC
 * endpoint.
 */
export const PORTABLE_FORMAT = "fraudwatch-settings";
export const PORTABLE_FORMAT_VERSION = 1;
/** Larger files are refused before parsing. */
export const MAX_IMPORT_BYTES = 1_000_000;

export type PortableDocument = {
  format: typeof PORTABLE_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  exportedAt: string;
  settings?: { values: PreferenceValues };
  presets: { name: string; description?: string; values: PreferenceValues }[];
};

export function exportDocument(input: { settings?: PreferenceValues; presets: readonly CustomPreset[] }, now = new Date()): PortableDocument {
  return {
    format: PORTABLE_FORMAT,
    formatVersion: PORTABLE_FORMAT_VERSION,
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    // A saved preset's id means nothing in another browser, so a custom detail preset isn't carried.
    ...(input.settings ? { settings: { values: withoutCustomPreset(input.settings) } } : {}),
    presets: input.presets.map((p) => ({ name: p.name, ...(p.description ? { description: p.description } : {}), values: p.values })),
  };
}

const withoutCustomPreset = (values: PreferenceValues): PreferenceValues => {
  const { "investigation.detailPreset": preset, ...rest } = values;
  return preset && !preset.startsWith("custom:") ? { ...rest, "investigation.detailPreset": preset } : rest;
};

export type ParsedImport =
  | {
      ok: true;
      settings: PreferenceValues | null;
      presets: { name: string; description?: string; values: PreferenceValues }[];
      /** What was left out, in words: unknown or invalid settings, unreadable presets. */
      skipped: string[];
    }
  | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Reads a settings file. Everything is validated: unknown settings and invalid
 * values are left out and listed, presets with nothing usable are skipped, and
 * nothing here writes anything.
 */
export function parseImport(text: string): ParsedImport {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: "That file is too large to be a FraudWatch settings file." };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  if (!isObject(doc) || doc.format !== PORTABLE_FORMAT) return { ok: false, error: "That isn't a FraudWatch settings file." };
  if (typeof doc.formatVersion !== "number" || doc.formatVersion > PORTABLE_FORMAT_VERSION) {
    return { ok: false, error: "That file was made by a newer FraudWatch. Update FraudWatch to import it." };
  }
  const schemaVersion = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 1;
  const skipped: string[] = [];
  /** The valid values, and a line naming what was left out (null if nothing). */
  const read = (raw: unknown, scope: "global" | "case", where: string) => {
    const values = isObject(raw) ? migrateValues(raw, schemaVersion) : {};
    const { values: valid, invalid } = readValues(values, scope);
    const ignored = Object.keys(values).filter((key) => !(key in valid));
    return { valid, note: ignored.length > 0 ? `${where}: ${ignored.join(", ")}${invalid.length > 0 ? " (unknown or invalid)" : " (unknown)"}` : null };
  };

  let settings: PreferenceValues | null = null;
  if (isObject(doc.settings)) {
    const { valid, note } = read(doc.settings.values, "global", "Settings");
    settings = withoutCustomPreset(valid);
    if (note) skipped.push(note);
  }

  const presets: { name: string; description?: string; values: PreferenceValues }[] = [];
  for (const [i, raw] of (Array.isArray(doc.presets) ? doc.presets : []).entries()) {
    const name = isObject(raw) && typeof raw.name === "string" ? raw.name.trim().slice(0, 60) : "";
    if (!isObject(raw) || !name) {
      skipped.push(`Preset ${i + 1}: no name`);
      continue;
    }
    const { valid: values, note } = read(raw.values, "case", `“${name}”`);
    if (Object.keys(values).length === 0) {
      skipped.push(`“${name}”: no settings this version can use`);
      continue;
    }
    if (note) skipped.push(note);
    presets.push({ name, ...(typeof raw.description === "string" && raw.description.trim() ? { description: raw.description.trim().slice(0, 280) } : {}), values });
  }
  if (!settings && presets.length === 0) return { ok: false, error: "That file has no settings or presets this version of FraudWatch can use." };
  return { ok: true, settings, presets, skipped };
}
