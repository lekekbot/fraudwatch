"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useLocalQuery } from "@/hooks/use-local-db";
import type { FraudWatchCase } from "@/lib/case/model";
import { applyPresetToCase, caseOverrides, clearCaseOverrides, setCaseOverride, setCaseOverrides, updateViewSettings } from "@/lib/case/view-settings";
import { describeStorageError, getDb } from "@/lib/db/db";
import { ensureLegacyPreferencesImported, getGlobalPreferences, resetGlobalPreferences, setGlobalPreference, setGlobalPreferences } from "@/lib/db/preferences";
import { type CustomPreset, presetLayer } from "@/lib/preferences/presets";
import { listViewPresets } from "@/lib/db/view-presets";
import { resolvePreferences } from "@/lib/preferences/resolve";
import type { PreferenceValues, SettingKey, SettingValue } from "@/lib/preferences/schema";

const EMPTY: PreferenceValues = {};
const NO_PRESETS: CustomPreset[] = [];

async function report(write: Promise<void>): Promise<void> {
  try {
    await write;
  } catch (err) {
    toast.error(describeStorageError(err));
  }
}

/**
 * Resolved display preferences: the case's overrides, then the global
 * choices, then the active detail preset, then the defaults. While loading or
 * when storage is unavailable, `get` returns those defaults; work that would
 * otherwise run twice (laying out the graph) should wait for `status`.
 *
 * Pass individual values (`get("graph.spacing")`) into memo dependencies, not
 * the whole result, so an unrelated change doesn't re-run them.
 */
export function usePreferences(fwCase?: FraudWatchCase) {
  useEffect(() => {
    void ensureLegacyPreferencesImported(getDb()).catch(() => {});
  }, []);
  const stored = useLocalQuery((db) => getGlobalPreferences(db), []);
  const global = stored.status === "ready" ? stored.data : EMPTY;
  const savedPresets = useLocalQuery((db) => listViewPresets(db), []);
  const presets = savedPresets.status === "ready" ? savedPresets.data : NO_PRESETS;
  const overrides = useMemo(() => (fwCase ? caseOverrides(fwCase) : EMPTY), [fwCase]);
  const preset = useMemo(() => presetLayer(global, presets), [global, presets]);
  const resolved = useMemo(() => resolvePreferences({ global, preset, caseOverrides: overrides }), [global, preset, overrides]);
  // What every case gets: the value a case override replaces.
  const inherited = useMemo(() => resolvePreferences({ global, preset }), [global, preset]);

  const setForCase = useCallback(
    <K extends SettingKey>(key: K, value: SettingValue<K>) => (fwCase ? report(updateViewSettings(getDb(), fwCase.id, (c) => setCaseOverride(c, key, value))) : Promise.resolve()),
    [fwCase],
  );
  const setManyForCase = useCallback(
    (changes: PreferenceValues) => (fwCase ? report(updateViewSettings(getDb(), fwCase.id, (c) => setCaseOverrides(c, changes))) : Promise.resolve()),
    [fwCase],
  );
  const resetForCase = useCallback(
    (keys: readonly SettingKey[] | "all") => (fwCase ? report(updateViewSettings(getDb(), fwCase.id, (c) => clearCaseOverrides(c, keys))) : Promise.resolve()),
    [fwCase],
  );

  /** Puts back a case's exact earlier view settings (for Undo); `undefined` removes them. */
  const restoreCaseSettings = useCallback(
    (viewSettings: FraudWatchCase["viewSettings"]) => (fwCase ? report(updateViewSettings(getDb(), fwCase.id, () => viewSettings)) : Promise.resolve()),
    [fwCase],
  );
  const applyToCase = useCallback(
    (preset: { ref: string; name: string; values: PreferenceValues }) =>
      fwCase ? report(updateViewSettings(getDb(), fwCase.id, (c) => applyPresetToCase(c, preset))) : Promise.resolve(),
    [fwCase],
  );

  return {
    // Ready once both the settings and the saved presets are read, so a saved preset never resolves as Balanced for a moment.
    status: stored.status === "ready" && savedPresets.status === "loading" ? "loading" : stored.status,
    error: stored.status === "error" ? stored.error : undefined,
    get: resolved.get,
    origin: resolved.origin,
    /** The value without this case's override: what every case gets. */
    inherited: inherited.get,
    /** The explicit global choices, for showing what a case override replaces and for Undo. */
    global,
    overrides,
    setGlobal: <K extends SettingKey>(key: K, value: SettingValue<K>) => report(setGlobalPreference(getDb(), key, value)),
    setManyGlobal: (changes: PreferenceValues) => report(setGlobalPreferences(getDb(), changes)),
    resetGlobal: (keys: readonly SettingKey[] | "all") => report(resetGlobalPreferences(getDb(), keys)),
    setForCase,
    setManyForCase,
    resetForCase,
    /** Copies a preset's values into this case's overrides. */
    applyToCase,
    restoreCaseSettings,
    /** This case's view settings as stored, for Undo. */
    caseSettings: fwCase?.viewSettings,
    /** Presets the user saved, by name. */
    presets,
  };
}

export type Preferences = ReturnType<typeof usePreferences>;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const subscribeReducedMotion = (onChange: () => void) => {
  const query = matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** Whether to skip animation: the motion preference, or the OS setting while it's "system". */
export function useReducedMotion(prefs: Pick<Preferences, "get">): boolean {
  const osReduced = useSyncExternalStore(subscribeReducedMotion, () => matchMedia(REDUCED_MOTION).matches, () => false);
  const motion = prefs.get("appearance.motion");
  return motion === "reduced" || (motion === "system" && osReduced);
}
