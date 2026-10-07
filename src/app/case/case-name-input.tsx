"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_CASE_NAME_LENGTH } from "@/lib/case/model";
import { renameCase } from "@/lib/db/cases";
import { describeStorageError, getDb } from "@/lib/db/db";

/**
 * Inline case-name editor. Enter or leaving the field saves; Escape cancels.
 * Enter is handled on the field itself rather than relying on form submission.
 * With `confirmButtons`, a tick saves and a cross cancels.
 */
export function CaseNameInput({ id, name, onDone, className, confirmButtons }: { id: string; name: string; onDone: () => void; className?: string; confirmButtons?: boolean }) {
  const [value, setValue] = useState(name);
  // Escape and Enter both end editing; blur that follows must not save a second time (or save a cancelled edit).
  const [finished, setFinished] = useState(false);

  async function save() {
    if (finished) return;
    setFinished(true);
    if (value.trim() === name) return onDone();
    try {
      await renameCase(getDb(), id, value);
      toast.success("Case renamed.");
    } catch (err) {
      toast.error(describeStorageError(err));
    }
    onDone();
  }

  function cancel() {
    setFinished(true);
    onDone();
  }

  const input = (
    <Input
      autoFocus
      aria-label="Case name"
      maxLength={MAX_CASE_NAME_LENGTH}
      value={value}
      className={className}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void save();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      onBlur={(event) => {
        // Tabbing to the tick or cross isn't leaving the editor.
        if (event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-case-name-actions]")) return;
        void save();
      }}
    />
  );
  if (!confirmButtons) return input;

  // Pressing a button mustn't blur the field first: that would save before the cross could cancel.
  const keepFocus = (event: MouseEvent) => event.preventDefault();
  return (
    <span className="flex min-w-0 items-center gap-1">
      {input}
      <span data-case-name-actions className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Save name" title="Save name" onMouseDown={keepFocus} onClick={() => void save()}>
          <CheckIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Cancel renaming" title="Cancel renaming" onMouseDown={keepFocus} onClick={cancel}>
          <XIcon />
        </Button>
      </span>
    </span>
  );
}
