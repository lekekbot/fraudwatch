"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_PRESET_DESCRIPTION, MAX_PRESET_NAME } from "@/lib/db/view-presets";

/**
 * Names a preset: saving the current settings as one, or renaming one. The
 * description says what it's for; a preset is a way of showing a case, never a
 * finding about it.
 */
export function PresetNameDialog({
  title,
  description,
  initial = { name: "", description: "" },
  withDescription = true,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: string;
  initial?: { name: string; description?: string };
  withDescription?: boolean;
  submitLabel: string;
  /** Throws with a message to show (an empty name, say). */
  onSubmit: (value: { name: string; description: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [about, setAbout] = useState(initial.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name, description: about });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the preset.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-name">Name</Label>
            <Input id="preset-name" autoFocus value={name} maxLength={MAX_PRESET_NAME} onChange={(e) => setName(e.target.value)} aria-invalid={error ? true : undefined} />
          </div>
          {withDescription && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="preset-description">What it&apos;s for (optional)</Label>
              <Textarea id="preset-description" rows={2} value={about} maxLength={MAX_PRESET_DESCRIPTION} onChange={(e) => setAbout(e.target.value)} />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
