import { describe, expect, it } from "vitest";
import { activePreset, customisedKeys, DETAIL_PRESETS, findPreset, presetChanges, presetLayer, presetPreview } from "./presets";
import { resolvePreferences } from "./resolve";
import { keysOfCategory, migrateValues, PRESET_KEYS, readValues, sanitizeForWrite, SETTING_KEYS, SETTINGS, storedValues } from "./schema";

describe("settings registry", () => {
  it("has a valid default for every setting, and presets only control case-scoped settings", () => {
    for (const key of SETTING_KEYS) expect(SETTINGS[key].values as readonly string[]).toContain(SETTINGS[key].default);
    for (const key of PRESET_KEYS) expect(SETTINGS[key].scope).toBe("case");
  });

  it("defaults match how FraudWatch behaved before preferences", () => {
    const r = resolvePreferences({ global: {}, preset: {} });
    expect(r.get("graph.nodeLimit")).toBe("25");
    expect(r.get("graph.programs")).toBe("hidden");
    expect(r.get("graph.knownServices")).toBe("collapsed");
    expect(r.get("graph.spacing")).toBe("normal");
    expect(r.get("timeline.connectors")).toBe("always");
    expect(r.get("investigation.startView")).toBe("timeline");
    expect(r.get("appearance.theme")).toBe("system");
  });

  it("groups keys by category", () => {
    expect(keysOfCategory("appearance")).toEqual(["appearance.theme", "appearance.motion", "appearance.addressFormat", "appearance.numberFormat"]);
  });
});

describe("reading stored values", () => {
  it("keeps valid values and reports invalid ones without throwing", () => {
    expect(readValues({ "graph.spacing": "wide", "graph.nodeLimit": "42", "graph.future": "x" }, "global")).toEqual({
      values: { "graph.spacing": "wide" },
      invalid: ["graph.nodeLimit"],
    });
  });

  it("reads anything that isn't an object as no values", () => {
    for (const raw of [null, undefined, "x", 3, ["graph.spacing"]]) expect(readValues(raw, "global").values).toEqual({});
    for (const doc of [null, "x", { values: null }, { values: [] }]) expect(storedValues(doc)).toEqual({});
  });

  it("ignores global-only settings among a case's overrides", () => {
    expect(readValues({ "appearance.theme": "dark", "graph.spacing": "wide" }, "case").values).toEqual({ "graph.spacing": "wide" });
  });

  it("keeps unknown keys on write but drops invalid known ones", () => {
    expect(sanitizeForWrite({ "graph.spacing": "huge", "trace.direction": "forward", "graph.arrows": "selected" })).toEqual({
      "trace.direction": "forward",
      "graph.arrows": "selected",
    });
  });

  it("leaves current-version values as they are", () => {
    const values = { "graph.spacing": "wide" };
    expect(migrateValues(values, 1)).toEqual(values);
  });
});

describe("resolution", () => {
  it("prefers the case, then the global choice, then the preset, then the default, and says where each came from", () => {
    const preset = { "graph.nodeLimit": "100", "graph.programs": "shown" } as const;
    const r = resolvePreferences({ global: { "graph.programs": "hidden", "graph.spacing": "wide" }, preset, caseOverrides: { "graph.spacing": "compact" } });
    expect([r.get("graph.spacing"), r.origin("graph.spacing")]).toEqual(["compact", "case"]);
    expect([r.get("graph.programs"), r.origin("graph.programs")]).toEqual(["hidden", "global"]);
    expect([r.get("graph.nodeLimit"), r.origin("graph.nodeLimit")]).toEqual(["100", "preset"]);
    expect([r.get("graph.arrows"), r.origin("graph.arrows")]).toEqual(["all", "default"]);
  });

  it("never lets a case override, or a preset set, a global-only setting", () => {
    const r = resolvePreferences({ global: {}, preset: { "graph.spacing": "wide", "appearance.theme": "dark" } as never, caseOverrides: { "appearance.theme": "dark" } as never });
    expect(r.origin("appearance.theme")).toBe("default");
    // A saved preset may set any per-case setting.
    expect(r.origin("graph.spacing")).toBe("preset");
  });

  it("follows global changes only where the case doesn't override (case A keeps hover, case B follows)", () => {
    const caseA = { "timeline.connectors": "hover" } as const;
    for (const global of [{ "timeline.connectors": "selected" }, { "timeline.connectors": "always" }] as const) {
      expect(resolvePreferences({ global, preset: {}, caseOverrides: caseA }).get("timeline.connectors")).toBe("hover");
      expect(resolvePreferences({ global, preset: {}, caseOverrides: {} }).get("timeline.connectors")).toBe(global["timeline.connectors"]);
    }
  });
});

describe("detail presets", () => {
  it("each preset sets every preset-controlled setting and nothing else", () => {
    for (const preset of Object.values(DETAIL_PRESETS)) expect(Object.keys(preset.values).sort()).toEqual([...PRESET_KEYS].sort());
  });

  it("Balanced is the defaults", () => {
    for (const key of PRESET_KEYS) expect(DETAIL_PRESETS.balanced.values[key]).toBe(SETTINGS[key].default);
  });

  it("Forensic never draws every address", () => {
    expect(DETAIL_PRESETS.forensic.values["graph.nodeLimit"]).not.toBe("all");
  });

  it("resolves from the active preset, below explicit global choices and case overrides", () => {
    const global = { "investigation.detailPreset": "forensic" } as const;
    const r = resolvePreferences({ global, preset: presetLayer(global) });
    expect([r.get("graph.programs"), r.origin("graph.programs")]).toEqual(["shown", "preset"]);
    const changed = { ...global, "graph.programs": "hidden" } as const;
    expect(resolvePreferences({ global: changed, preset: presetLayer(changed) }).origin("graph.programs")).toBe("global");
    const inCase = resolvePreferences({ global, preset: presetLayer(global), caseOverrides: { "graph.nodeLimit": "10" } });
    expect([inCase.get("graph.nodeLimit"), inCase.origin("graph.nodeLimit")]).toEqual(["10", "case"]);
  });

  it("reads an unknown preset as Balanced", () => {
    expect(presetLayer({ "investigation.detailPreset": "gone" as never })).toEqual(DETAIL_PRESETS.balanced.values);
  });

  it("counts only changes that differ from the active preset as customised", () => {
    expect(customisedKeys({ "investigation.detailPreset": "minimal", "graph.nodeLimit": "10" })).toEqual([]);
    expect(customisedKeys({ "investigation.detailPreset": "minimal", "graph.nodeLimit": "50", "graph.spacing": "wide" })).toEqual(["graph.nodeLimit"]);
  });

  it("applying a preset selects it and clears only the settings it controls", () => {
    const changes = presetChanges(findPreset("forensic", [])!);
    expect(changes["investigation.detailPreset"]).toBe("forensic");
    expect(Object.keys(changes).filter((k) => k !== "investigation.detailPreset").sort()).toEqual([...PRESET_KEYS].sort());
    expect(Object.values(changes).filter((v) => v !== undefined)).toEqual(["forensic"]);
  });

  it("previews only the settings that would change", () => {
    const r = resolvePreferences({ global: {}, preset: presetLayer({}) });
    expect(presetPreview(findPreset("balanced", [])!, r.get)).toEqual([]);
    expect(presetPreview(findPreset("forensic", [])!, r.get).map((c) => c.key)).toEqual(["graph.nodeLimit", "graph.programs", "graph.knownServices"]);
  });
});

describe("saved presets", () => {
  const saved = { id: "abc", name: "Token flow", values: { "graph.spacing": "wide", "graph.nodeLimit": "10" } } as const;

  it("resolves a saved preset's per-case settings, even ones the built-in presets don't set", () => {
    const global = { "investigation.detailPreset": "custom:abc" } as const;
    const r = resolvePreferences({ global, preset: presetLayer(global, [saved]) });
    expect([r.get("graph.spacing"), r.origin("graph.spacing")]).toEqual(["wide", "preset"]);
    expect([r.get("graph.programs"), r.origin("graph.programs")]).toEqual(["hidden", "default"]);
  });

  it("falls back to Balanced, and says so, when the saved preset is gone", () => {
    const missing = activePreset({ "investigation.detailPreset": "custom:gone" }, [saved]);
    expect([missing.ref, missing.missing]).toEqual(["balanced", true]);
  });

  it("applying a saved preset clears only the settings it controls", () => {
    const changes = presetChanges(findPreset("custom:abc", [saved])!);
    expect(Object.keys(changes).sort()).toEqual(["graph.nodeLimit", "graph.spacing", "investigation.detailPreset"]);
    expect(customisedKeys({ "investigation.detailPreset": "custom:abc", "graph.spacing": "compact", "graph.programs": "shown" }, [saved])).toEqual(["graph.spacing"]);
  });

  it("accepts a saved preset's id as the detail preset, and nothing else outside the list", () => {
    expect(readValues({ "investigation.detailPreset": "custom:abc" }, "global").values).toEqual({ "investigation.detailPreset": "custom:abc" });
    expect(readValues({ "investigation.detailPreset": "custom:" }, "global").values).toEqual({});
    expect(readValues({ "investigation.detailPreset": "aml-review" }, "global").values).toEqual({});
  });
});
