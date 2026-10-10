"use client";

import { useRef, useState } from "react";
import { CopyIcon, DownloadIcon, PencilIcon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PresetNameDialog } from "@/components/preset-name-dialog";
import type { Preferences } from "@/hooks/use-preferences";
import { describeStorageError, getDb } from "@/lib/db/db";
import { createViewPreset, deleteViewPreset, duplicateViewPreset, importSettings, renameViewPreset } from "@/lib/db/view-presets";
import { exportDocument, type ParsedImport, parseImport } from "@/lib/preferences/portable";
import { activePreset, type CustomPreset, customRef, DETAIL_PRESETS, presetValuesFrom } from "@/lib/preferences/presets";
import type { PreferenceValues, SettingKey } from "@/lib/preferences/schema";

const run = (work: Promise<unknown>) => work.catch((err) => toast.error(err instanceof Error && !(err.name === "DatabaseClosedError") ? err.message : describeStorageError(err)));

/**
 * Presets the user saved: create from the current settings, rename, duplicate,
 * delete, and move them between browsers as a file. Built-in presets can't be
 * changed; duplicate one to start from it.
 */
export function SavedPresets({ prefs, casesUsing }: { prefs: Preferences; casesUsing: (ref: string) => number }) {
  const [naming, setNaming] = useState<{ mode: "save" } | { mode: "rename"; preset: CustomPreset } | null>(null);
  const [deleting, setDeleting] = useState<CustomPreset | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState<Extract<ParsedImport, { ok: true }> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const active = activePreset(prefs.global, prefs.presets);

  const readFile = async (file: File) => {
    const parsed = parseImport(await file.text());
    if (!parsed.ok) toast.error(parsed.error);
    else setImporting(parsed);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Saved presets</CardTitle>
          <CardDescription>Your own combinations of graph, timeline and name settings, to apply to every case or to one. A preset only changes what&apos;s shown.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {prefs.presets.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet. Save the current settings to start one.</p>
        ) : (
          <ul className="divide-y text-sm">
            {prefs.presets.map((preset) => (
              <li key={preset.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {preset.name}
                    {active.ref === customRef(preset.id) && <span className="font-normal text-muted-foreground"> · in use for every case</span>}
                  </p>
                  <p className="truncate text-muted-foreground">{preset.description ?? `${Object.keys(preset.values).length} settings`}</p>
                </div>
                <div className="flex shrink-0 items-center">
                  <Button variant="ghost" size="icon-sm" aria-label={`Rename ${preset.name}`} title="Rename" onClick={() => setNaming({ mode: "rename", preset })}>
                    <PencilIcon />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Duplicate ${preset.name}`} title="Duplicate" onClick={() => void run(duplicateViewPreset(getDb(), preset))}>
                    <CopyIcon />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${preset.name}`} title="Delete" onClick={() => setDeleting(preset)}>
                    <Trash2Icon />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setNaming({ mode: "save" })}>
            <PlusIcon />
            Save current settings
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExporting(true)}>
            <DownloadIcon />
            Export…
          </Button>
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            <UploadIcon />
            Import…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void readFile(file);
            }}
          />
        </div>
      </CardContent>

      {naming && (
        <PresetNameDialog
          title={naming.mode === "save" ? "Save current settings as a preset" : `Rename “${naming.preset.name}”`}
          description={naming.mode === "save" ? "Saves how the graph, timeline and names are set for every case now." : undefined}
          initial={naming.mode === "rename" ? { name: naming.preset.name } : undefined}
          withDescription={naming.mode === "save"}
          submitLabel={naming.mode === "save" ? "Save preset" : "Rename"}
          onSubmit={async ({ name, description }) => {
            if (naming.mode === "rename") await renameViewPreset(getDb(), naming.preset.id, name);
            else {
              const created = await createViewPreset(getDb(), { name, description, values: presetValuesFrom(prefs.get) });
              toast.success(`Saved “${created.name}”.`);
            }
          }}
          onClose={() => setNaming(null)}
        />
      )}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              {deleting && active.ref === customRef(deleting.id) && "It's in use for every case: its settings stay as your own, so nothing you see changes. "}
              {deleting && casesUsing(customRef(deleting.id)) > 0 &&
                `${casesUsing(customRef(deleting.id))} case${casesUsing(customRef(deleting.id)) === 1 ? " was" : "s were"} set from it and keep their settings. `}
              This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const preset = deleting;
                setDeleting(null);
                if (!preset) return;
                // The preset in use keeps showing the same: its values become explicit settings over Balanced.
                const keep = active.ref === customRef(preset.id) ? ({ ...preset.values, ...prefs.global, "investigation.detailPreset": undefined } as PreferenceValues) : null;
                void run((keep ? prefs.setManyGlobal(keep) : Promise.resolve()).then(() => deleteViewPreset(getDb(), preset.id)));
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {exporting && <ExportDialog prefs={prefs} onClose={() => setExporting(false)} />}
      {importing && <ImportDialog prefs={prefs} parsed={importing} onClose={() => setImporting(null)} />}
    </Card>
  );
}

function ExportDialog({ prefs, onClose }: { prefs: Preferences; onClose: () => void }) {
  const [withSettings, setWithSettings] = useState(true);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(prefs.presets.map((p) => p.id)));
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const nothing = !withSettings && chosen.size === 0;

  const download = () => {
    const doc = exportDocument({ settings: withSettings ? prefs.global : undefined, presets: prefs.presets.filter((p) => chosen.has(p.id)) });
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `fraudwatch-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export settings</DialogTitle>
          <DialogDescription>A file to import in another browser or share with a colleague. It holds display settings only: no cases, labels, transactions or RPC endpoint.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2.5">
            <Checkbox checked={withSettings} onCheckedChange={(v) => setWithSettings(v === true)} />
            Your settings for every case
          </label>
          {prefs.presets.map((p) => (
            <label key={p.id} className="flex items-center gap-2.5">
              <Checkbox checked={chosen.has(p.id)} onCheckedChange={() => toggle(p.id)} />
              Preset: {p.name}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={nothing} onClick={download}>
            <DownloadIcon />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ prefs, parsed, onClose }: { prefs: Preferences; parsed: Extract<ParsedImport, { ok: true }>; onClose: () => void }) {
  const settingCount = parsed.settings ? Object.keys(parsed.settings).length : 0;
  // Replacing your own settings is opt-in; adding presets never changes anything else.
  const [withSettings, setWithSettings] = useState(false);

  const confirm = () => {
    const settings = withSettings ? parsed.settings : null;
    const before = settings ? (Object.fromEntries(Object.keys(settings).map((k) => [k, prefs.global[k as SettingKey]])) as PreferenceValues) : null;
    const reserved = Object.values(DETAIL_PRESETS).map((p) => p.name);
    onClose();
    void run(
      importSettings(getDb(), { presets: parsed.presets, settings, reserved }).then((ids) =>
        toast.success(`Imported ${[parsed.presets.length > 0 && `${parsed.presets.length} preset${parsed.presets.length === 1 ? "" : "s"}`, settings && "your settings"].filter(Boolean).join(" and ")}.`, {
          action: {
            label: "Undo",
            onClick: () => void run(Promise.all([...ids.map((id) => deleteViewPreset(getDb(), id)), ...(before ? [prefs.setManyGlobal(before)] : [])])),
          },
        }),
      ),
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import settings</DialogTitle>
          <DialogDescription>Nothing changes until you import. Cases, labels and transactions are never touched.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          {parsed.presets.length > 0 && (
            <div>
              <p className="font-medium">
                {parsed.presets.length} preset{parsed.presets.length === 1 ? "" : "s"} to add
              </p>
              <p className="text-muted-foreground">{parsed.presets.map((p) => p.name).join(", ")}. A name you already use gets a number.</p>
            </div>
          )}
          {settingCount > 0 && (
            <label className="flex items-start gap-2.5">
              <Checkbox className="mt-0.5" checked={withSettings} onCheckedChange={(v) => setWithSettings(v === true)} />
              <span>
                Also replace {settingCount} of your settings with the file&apos;s
                <span className="block text-muted-foreground">Only the settings in the file change; Undo puts yours back.</span>
              </span>
            </label>
          )}
          {parsed.skipped.length > 0 && (
            <details className="text-muted-foreground">
              <summary className="cursor-pointer">{parsed.skipped.length} thing{parsed.skipped.length === 1 ? "" : "s"} left out</summary>
              <ul className="mt-1 list-disc pl-5">
                {parsed.skipped.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={parsed.presets.length === 0 && !withSettings} onClick={confirm}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
