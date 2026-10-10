"use client";

import { useId } from "react";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { SETTING_COPY } from "@/components/setting-copy";
import { SETTINGS, type SettingKey, type SettingValue } from "@/lib/preferences/schema";

/** On/off settings render as a switch: the first value of these pairs is "on". */
const SWITCHES: Record<string, readonly [string, string]> = { "on,off": ["on", "off"], "shown,hidden": ["shown", "hidden"], "hidden,shown": ["shown", "hidden"] };

/**
 * One setting: its name, a control, and a line saying where its value comes from.
 * The control shows the stored value it's given, never a local copy, so nothing
 * looks applied before it's saved.
 */
export function SettingControl<K extends SettingKey>({
  setting,
  value,
  onChange,
  note,
  onReset,
  resetLabel,
}: {
  setting: K;
  value: SettingValue<K>;
  onChange: (value: SettingValue<K>) => void;
  /** Where the value comes from, e.g. "From Balanced" or "All cases: Hidden". */
  note?: string;
  /** Shown when the value can go back to what it would inherit. */
  onReset?: () => void;
  resetLabel?: string;
}) {
  const id = useId();
  const copy = SETTING_COPY[setting];
  const values = SETTINGS[setting].values as readonly string[] as readonly SettingValue<K>[];
  const pair = SWITCHES[values.join(",")];
  return (
    <div className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 text-sm">
        <p id={id} className="font-medium">
          {copy.label}
        </p>
        {copy.help && <p className="text-muted-foreground">{copy.help}</p>}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onReset && (
          <Button variant="ghost" size="icon-sm" aria-label={resetLabel ?? `Reset ${copy.label}`} title={resetLabel ?? "Reset"} onClick={onReset}>
            <RotateCcwIcon />
          </Button>
        )}
        {pair ? (
          <Switch aria-labelledby={id} checked={value === pair[0]} onCheckedChange={(on) => onChange((on ? pair[0] : pair[1]) as SettingValue<K>)} />
        ) : (
          <Segmented aria-labelledby={id} value={value} onValueChange={onChange} options={values.map((v) => ({ value: v, label: copy.options[v] ?? v }))} />
        )}
      </div>
    </div>
  );
}
