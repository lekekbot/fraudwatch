"use client";

import { useState } from "react";
import Link from "next/link";
import { SlidersHorizontalIcon } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SETTING_COPY } from "@/components/setting-copy";
import { SettingControl } from "@/components/setting-control";
import type { Preferences } from "@/hooks/use-preferences";
import { PresetNameDialog } from "@/components/preset-name-dialog";
import { getDb } from "@/lib/db/db";
import { createViewPreset } from "@/lib/db/view-presets";
import { customRef, DETAIL_PRESETS, findPreset, presetValuesFrom } from "@/lib/preferences/presets";
import type { PreferenceValues, SettingKey } from "@/lib/preferences/schema";

/** How names show, in every view of a case. */
const NAME_KEYS: SettingKey[] = ["labels.preferNames", "labels.community", "labels.sns"];

const optionText = (key: SettingKey, value: string) => SETTING_COPY[key].options[value] ?? value;

/**
 * A view's display settings for this case. Every change is a case override:
 * other cases and the global settings don't change. Each control says when it
 * differs from what every case gets, and can go back. "Use these for all
 * cases" is the one explicit way to make them the global default.
 */
export function ViewSettingsPanel({
  prefs,
  keys,
  title,
  appliedPreset,
}: {
  prefs: Preferences;
  keys: readonly SettingKey[];
  title: string;
  /** The preset this case was last set from, if any. */
  appliedPreset?: { ref: string; name: string };
}) {
  const [saving, setSaving] = useState(false);
  const applyPreset = (ref: string) => {
    const preset = findPreset(ref, prefs.presets);
    if (!preset) return;
    const before = prefs.caseSettings;
    void prefs.applyToCase(preset).then(() =>
      toast.success(`${preset.name} applied to this case.`, { action: { label: "Undo", onClick: () => void prefs.restoreCaseSettings(before) } }),
    );
  };
  const all = [...keys, ...NAME_KEYS];
  const overridden = all.filter((key) => prefs.origin(key) === "case");
  const restore = (values: PreferenceValues) => () => void prefs.setManyForCase(values);
  const current = (list: readonly SettingKey[]) => Object.fromEntries(list.map((key) => [key, prefs.overrides[key]])) as PreferenceValues;

  const promote = () => {
    const values = Object.fromEntries(overridden.map((key) => [key, prefs.get(key)])) as PreferenceValues;
    const beforeGlobal = Object.fromEntries(overridden.map((key) => [key, prefs.global[key]])) as PreferenceValues;
    const beforeCase = current(overridden);
    void Promise.all([prefs.setManyGlobal(values), prefs.resetForCase(overridden)]).then(() =>
      toast.success("Now the default for every case.", {
        action: { label: "Undo", onClick: () => void Promise.all([prefs.setManyGlobal(beforeGlobal), prefs.setManyForCase(beforeCase)]) },
      }),
    );
  };
  const resetAll = () => {
    const before = current(overridden);
    void prefs.resetForCase(overridden).then(() => toast.success("This case uses the settings for all cases again.", { action: { label: "Undo", onClick: restore(before) } }));
  };

  const control = (key: SettingKey) => {
    const overrides = prefs.origin(key) === "case";
    return (
      <SettingControl
        key={key}
        setting={key}
        value={prefs.get(key)}
        onChange={(value) => void prefs.setForCase(key, value)}
        note={overrides ? `This case · all cases: ${optionText(key, prefs.inherited(key))}` : undefined}
        onReset={overrides ? () => void prefs.resetForCase([key]) : undefined}
        resetLabel="Use the setting for all cases"
      />
    );
  };

  const count = overridden.length;
  return (
    <Popover>
      <PopoverTrigger
        className={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} relative`}
        aria-label={count > 0 ? `View settings, ${count} changed for this case` : "View settings"}
        title={count > 0 ? `View settings · ${count} changed for this case` : "View settings"}
      >
        <SlidersHorizontalIcon />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground tabular-nums" aria-hidden>
            {count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">
              {count > 0 ? `This case changes ${count} setting${count === 1 ? "" : "s"}. Changes apply to this case only.` : "Changes apply to this case only."}
            </p>
          </div>
          {count > 0 && (
            <Button variant="ghost" size="sm" onClick={resetAll}>
              Reset all
            </Button>
          )}
        </div>
        <div className="divide-y">{keys.map(control)}</div>
        <p className="mt-3 border-t pt-3 text-xs font-medium text-muted-foreground">Names</p>
        <div className="divide-y">{NAME_KEYS.map(control)}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <label className="sr-only" htmlFor="case-preset">
            Apply a preset to this case
          </label>
          <select
            id="case-preset"
            value=""
            onChange={(event) => event.target.value && applyPreset(event.target.value)}
            className="h-7 max-w-48 rounded-md border bg-transparent px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            title="Copies a preset's settings into this case. Later changes to the preset don't affect the case."
          >
            <option value="">Apply a preset…</option>
            {Object.keys(DETAIL_PRESETS).map((id) => (
              <option key={id} value={id}>
                {DETAIL_PRESETS[id as keyof typeof DETAIL_PRESETS].name}
              </option>
            ))}
            {prefs.presets.map((p) => (
              <option key={p.id} value={customRef(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="sm" onClick={() => setSaving(true)}>
            Save as preset…
          </Button>
          {appliedPreset && (
            <span className="w-full text-xs text-muted-foreground">
              Set from {appliedPreset.name}
              {!findPreset(appliedPreset.ref, prefs.presets) && " (since deleted)"}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <Link href="/settings/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Open Settings
          </Link>
          <Button variant="outline" size="sm" disabled={count === 0} onClick={promote}>
            Use these for all cases
          </Button>
        </div>
      </PopoverContent>
      {saving && (
        <PresetNameDialog
          title="Save this case's settings as a preset"
          description="Saves how the graph, timeline and names are set in this case, to apply to other cases."
          submitLabel="Save preset"
          onSubmit={async ({ name, description }) => {
            const created = await createViewPreset(getDb(), { name, description, values: presetValuesFrom(prefs.get) });
            toast.success(`Saved “${created.name}”.`);
          }}
          onClose={() => setSaving(false)}
        />
      )}
    </Popover>
  );
}
