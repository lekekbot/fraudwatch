"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { MAX_CASE_NAME_LENGTH } from "@/lib/case/model";
import { renameCase } from "@/lib/db/cases";
import { describeStorageError, getDb } from "@/lib/db/db";

/**
 * Inline case-name editor. Enter or leaving the field saves; Escape cancels.
 * Enter is handled on the field itself rather than relying on form submission.
 */
export function CaseNameInput({ id, name, onDone, className }: { id: string; name: string; onDone: () => void; className?: string }) {
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

  return (
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
          setFinished(true);
          onDone();
        }
      }}
      onBlur={() => void save()}
    />
  );
}
