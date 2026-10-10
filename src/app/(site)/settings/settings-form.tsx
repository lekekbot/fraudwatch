"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CATEGORY_COPY } from "@/components/setting-copy";
import { SettingControl } from "@/components/setting-control";
import { useLocalQuery } from "@/hooks/use-local-db";
import { type Preferences, usePreferences } from "@/hooks/use-preferences";
import { caseOverrides } from "@/lib/case/view-settings";
import { type Category, isExposed, keysOfCategory, type PreferenceValues, type SettingKey } from "@/lib/preferences/schema";
import { DetailPresetPicker, presetNote } from "./detail-preset-picker";
import { SavedPresets } from "./saved-presets";
import { SectionNav } from "./section-nav";
import { StorageSettings } from "./storage/storage-settings";

const CATEGORIES: Category[] = ["appearance", "labels", "investigation", "graph", "timeline"];
/** The detail preset has its own picker at the top. */
const shownKeys = (category: Category) => keysOfCategory(category).filter((k) => isExposed(k) && k !== "investigation.detailPreset");

/** Puts back explicit choices removed by a reset (keys not chosen before are cleared again). */
const undoReset = (prefs: Preferences, keys: readonly SettingKey[], before: PreferenceValues) => () =>
  void prefs.setManyGlobal(Object.fromEntries(keys.map((k) => [k, before[k]])) as PreferenceValues);

export function SettingsForm() {
  const prefs = usePreferences();
  // How many cases override each setting, so a global change's reach is clear.
  const cases = useLocalQuery((db) => db.cases.toArray(), []);
  const overriddenIn = useMemo(() => {
    const out = new Map<SettingKey, number>();
    for (const c of cases.status === "ready" ? cases.data : []) for (const key of Object.keys(caseOverrides(c)) as SettingKey[]) out.set(key, (out.get(key) ?? 0) + 1);
    return out;
  }, [cases]);
  const noteFor = (key: SettingKey) => {
    const n = overriddenIn.get(key);
    return [presetNote(prefs, key), n ? `${n} case${n === 1 ? "" : "s"} use${n === 1 ? "s" : ""} their own value` : undefined].filter(Boolean).join(" · ") || undefined;
  };
  const [confirmAll, setConfirmAll] = useState(false);

  const reset = (keys: SettingKey[], what: string) => {
    const before = prefs.global;
    void prefs.resetGlobal(keys).then(() => toast.success(`${what} reset.`, { action: { label: "Undo", onClick: undoReset(prefs, keys, before) } }));
  };

  const sections = [
    ...(isExposed("investigation.detailPreset") ? [{ id: "detail", title: "Investigation detail" }, { id: "presets", title: "Saved presets" }] : []),
    ...CATEGORIES.filter((category) => shownKeys(category).length > 0).map((category) => ({ id: category, title: CATEGORY_COPY[category].title })),
    { id: "storage", title: "Local storage" },
  ];

  return (
    <div className="mx-auto grid max-w-2xl gap-10 lg:max-w-none lg:grid-cols-[11rem_minmax(0,42rem)] lg:justify-center">
      <SectionNav sections={sections} />
      <div className="flex min-w-0 flex-col gap-6">
        <section className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            How investigations look in this browser. Changes apply to every case unless a case changes them in its View settings. They only change what&apos;s shown,
            never the transactions themselves.
          </p>
        </section>

        {prefs.status === "error" && (
          <Alert variant="destructive">
            <AlertTitle>Settings can&apos;t be saved</AlertTitle>
            <AlertDescription>{prefs.error} Defaults are used meanwhile.</AlertDescription>
          </Alert>
        )}

        <section id="detail" className="scroll-mt-6">
          <DetailPresetPicker prefs={prefs} />
        </section>
        {isExposed("investigation.detailPreset") && (
          <section id="presets" className="scroll-mt-6">
            <SavedPresets prefs={prefs} casesUsing={(ref) => (cases.status === "ready" ? cases.data.filter((c) => c.viewSettings?.appliedPreset?.ref === ref).length : 0)} />
          </section>
        )}

        {CATEGORIES.map((category) => {
          const keys = shownKeys(category);
          if (keys.length === 0) return null;
          const changed = keys.some((k) => prefs.origin(k) === "global");
          return (
            <Card key={category} id={category} className="scroll-mt-6">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="flex flex-col gap-1.5">
                  <CardTitle>{CATEGORY_COPY[category].title}</CardTitle>
                  {CATEGORY_COPY[category].description && <CardDescription>{CATEGORY_COPY[category].description}</CardDescription>}
                </div>
                {changed && (
                  <Button variant="ghost" size="sm" onClick={() => reset(keys, CATEGORY_COPY[category].title)}>
                    Reset section
                  </Button>
                )}
              </CardHeader>
              <CardContent className="divide-y">
                {keys.map((key) => (
                  <SettingControl
                    key={key}
                    setting={key}
                    value={prefs.get(key)}
                    onChange={(value) => void prefs.setGlobal(key, value)}
                    note={noteFor(key)}
                    onReset={prefs.origin(key) === "global" ? () => void prefs.resetGlobal([key]) : undefined}
                    resetLabel="Use the default"
                  />
                ))}
              </CardContent>
            </Card>
          );
        })}

        <div className="flex justify-end">
          <Button variant="outline" disabled={prefs.status !== "ready"} onClick={() => setConfirmAll(true)}>
            Reset all settings
          </Button>
        </div>

        <section id="storage" className="scroll-mt-6">
          <StorageSettings />
        </section>

        <Dialog open={confirmAll} onOpenChange={setConfirmAll}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset all settings?</DialogTitle>
              <DialogDescription>
                Every setting above goes back to its default. Your RPC endpoint stays, cases keep their own View settings, and no case, transaction or label is touched.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmAll(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setConfirmAll(false);
                  reset(Object.keys(prefs.global) as SettingKey[], "All settings");
                }}
              >
                Reset all
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
