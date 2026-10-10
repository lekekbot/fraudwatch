import { describe, expect, it } from "vitest";
import { exportDocument, MAX_IMPORT_BYTES, parseImport } from "./portable";

const preset = { id: "p1", name: "Token flow", description: "Big movements only", values: { "graph.nodeLimit": "10", "graph.lowValue": "hidden" } } as const;

describe("settings files", () => {
  it("round-trips settings and presets", () => {
    const doc = exportDocument({ settings: { "appearance.theme": "dark", "graph.spacing": "wide" }, presets: [preset] }, new Date("2026-10-09T00:00:00Z"));
    const parsed = parseImport(JSON.stringify(doc));
    expect(parsed).toEqual({
      ok: true,
      settings: { "appearance.theme": "dark", "graph.spacing": "wide" },
      presets: [{ name: "Token flow", description: "Big movements only", values: { "graph.nodeLimit": "10", "graph.lowValue": "hidden" } }],
      skipped: [],
    });
  });

  it("never carries a saved preset's id, which means nothing in another browser", () => {
    const doc = exportDocument({ settings: { "investigation.detailPreset": "custom:abc", "graph.spacing": "wide" }, presets: [] });
    expect(doc.settings?.values).toEqual({ "graph.spacing": "wide" });
    expect(exportDocument({ settings: { "investigation.detailPreset": "forensic" }, presets: [] }).settings?.values).toEqual({ "investigation.detailPreset": "forensic" });
  });

  it("refuses files that aren't FraudWatch settings, or are too new or too big", () => {
    expect(parseImport("not json")).toMatchObject({ ok: false });
    expect(parseImport(JSON.stringify({ format: "something-else", presets: [] }))).toMatchObject({ ok: false });
    expect(parseImport(JSON.stringify({ format: "fraudwatch-settings", formatVersion: 99, presets: [] }))).toMatchObject({ ok: false, error: expect.stringMatching(/newer/) });
    expect(parseImport(" ".repeat(MAX_IMPORT_BYTES + 1))).toMatchObject({ ok: false, error: expect.stringMatching(/too large/) });
    expect(parseImport(JSON.stringify({ format: "fraudwatch-settings", formatVersion: 1, presets: [] }))).toMatchObject({ ok: false });
  });

  it("leaves out unknown and invalid settings, and presets with nothing usable, and says so", () => {
    const parsed = parseImport(
      JSON.stringify({
        format: "fraudwatch-settings",
        formatVersion: 1,
        schemaVersion: 1,
        settings: { values: { "graph.spacing": "huge", "appearance.theme": "dark", "trace.direction": "forward" } },
        presets: [
          { name: "Good", values: { "graph.arrows": "selected", "appearance.theme": "dark" } },
          { name: "Empty", values: { "graph.spacing": "huge" } },
          { values: { "graph.arrows": "all" } },
        ],
      }),
    );
    expect(parsed.ok && parsed.settings).toEqual({ "appearance.theme": "dark" });
    // Presets hold per-case settings only: the theme is left out of one.
    expect(parsed.ok && parsed.presets).toEqual([{ name: "Good", values: { "graph.arrows": "selected" } }]);
    expect(parsed.ok && parsed.skipped.length).toBe(4);
  });
});
