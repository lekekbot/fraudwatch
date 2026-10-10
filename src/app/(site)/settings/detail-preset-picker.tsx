"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SETTING_COPY } from "@/components/setting-copy";
import type { Preferences } from "@/hooks/use-preferences";
import { type ActivePreset, activePreset, customisedKeys, customRef, DETAIL_PRESETS, type DetailPresetId, findPreset, presetChanges, presetPreview } from "@/lib/preferences/presets";
import { isExposed, type PreferenceValues, type SettingKey } from "@/lib/preferences/schema";
import { cn } from "cn";

const IDS = Object.keys(DETAIL_PRESETS) as DetailPresetId[];
const optionLabel = (key: SettingKey, value: string) => `${SETTING_COPY[key].label}: ${SETTING_COPY[key].options[value] ?? value}`;

/** Where a value the active preset controls comes from, for the line under its control. */
export function presetNote(prefs: Preferences, key: SettingKey): string | undefined {
  if (!isExposed("investigation.detailPreset")) return undefined;
  const preset = activePreset(prefs.global, prefs.presets);
  if (!preset.controls.includes(key)) return undefined;
  if (prefs.origin(key) === "preset") return `From ${preset.name}`;
  const presetValue = preset.values[key];
  if (prefs.origin(key) === "global" && presetValue !== undefined && presetValue !== prefs.get(key)) {
    return `Changed from ${preset.name} (${SETTING_COPY[key].options[presetValue] ?? presetValue})`;
  }
  return undefined;
}

/** Selects a preset for every case, clearing your global choices for the settings it controls; Undo puts them back. */
export function applyGlobally(prefs: Preferences, preset: ActivePreset) {
  const changes = presetChanges(preset);
  const before = Object.fromEntries(Object.keys(changes).map((k) => [k, prefs.global[k as SettingKey]])) as PreferenceValues;
  void prefs.setManyGlobal(changes).then(() => toast.success(`${preset.name} applied.`, { action: { label: "Undo", onClick: () => void prefs.setManyGlobal(before) } }));
}

/**
 * Minimal, Balanced, Forensic, and any saved presets. Applying one clears your
 * global choices for the settings it controls, so its values show; Undo puts
 * them back. Case View settings are left alone.
 */
export function DetailPresetPicker({ prefs }: { prefs: Preferences }) {
  if (!isExposed("investigation.detailPreset")) return null;
  const active = activePreset(prefs.global, prefs.presets);
  const customised = customisedKeys(prefs.global, prefs.presets);
  const pick = (ref: string) => {
    const preset = findPreset(ref, prefs.presets);
    if (preset) applyGlobally(prefs, preset);
  };
  const option = (ref: string, className: string, body: (preset: ActivePreset, changes: string) => React.ReactNode) => {
    const preset = findPreset(ref, prefs.presets)!;
    const isActive = ref === active.ref;
    const changes = presetPreview(preset, prefs.get);
    const changeText =
      isActive && customised.length === 0 ? "" : changes.length > 0 ? `${isActive ? "Reapplying changes: " : "Changes: "}${changes.map((c) => optionLabel(c.key, c.to)).join(" · ")}` : "";
    return (
      <Radio.Root
        key={ref}
        value={ref}
        // Choosing the active preset again goes back to it, dropping customisations.
        onClick={() => isActive && applyGlobally(prefs, preset)}
        className={cn(
          "rounded-lg border text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50",
          isActive && "border-primary",
          className,
        )}
      >
        {body(preset, changeText)}
      </Radio.Root>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Investigation detail</CardTitle>
        <CardDescription>
          {active.missing ? "The preset you chose was deleted, so Balanced is used" : active.name}
          {customised.length > 0 && ` · customised (${customised.length})`}. Sets how much the graph and timeline show; each setting below can still be changed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <RadioGroup aria-label="Investigation detail" value={active.ref} onValueChange={(ref) => pick(ref as string)} className="flex flex-col gap-2">
          <div className="grid gap-2 sm:grid-cols-3">
            {IDS.map((id) =>
              option(id, "flex flex-col gap-1 p-3", (preset, changes) => (
                <>
                  <span className="font-medium">
                    {preset.name}
                    {id === active.ref && customised.length > 0 && <span className="font-normal text-muted-foreground"> · customised</span>}
                  </span>
                  <span className="text-muted-foreground">{DETAIL_PRESETS[id].summary}</span>
                  {changes && <span className="text-xs text-muted-foreground">{changes}</span>}
                </>
              )),
            )}
          </div>
          {prefs.presets.map((saved) =>
            option(customRef(saved.id), "flex flex-col gap-0.5 px-3 py-2", (preset, changes) => (
              <>
                <span className="font-medium">
                  {preset.name}
                  {preset.ref === active.ref && customised.length > 0 && <span className="font-normal text-muted-foreground"> · customised</span>}
                </span>
                {saved.description && <span className="text-muted-foreground">{saved.description}</span>}
                {changes && <span className="text-xs text-muted-foreground">{changes}</span>}
              </>
            )),
          )}
        </RadioGroup>
        {customised.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {customised.map((key) => (
              <li key={key} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{optionLabel(key, prefs.get(key))}</span>
                <Button variant="ghost" size="sm" onClick={() => void prefs.resetGlobal([key])}>
                  Use {active.name}&apos;s value
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
