"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteCase } from "@/lib/db/cases";
import { describeStorageError, getDb } from "@/lib/db/db";

/** `compact`: an icon-only button for lists; it stays on the page after deleting instead of going home. */
export function DeleteCaseButton({ id, name, compact = false }: { id: string; name: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await deleteCase(getDb(), id);
      toast.success("Case deleted.");
      if (compact) setOpen(false);
      else router.replace("/");
    } catch (err) {
      toast.error(describeStorageError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {compact ? (
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${name}`} title="Delete case" onClick={() => setOpen(true)}>
          <Trash2Icon />
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setOpen(true)}>
          <Trash2Icon />
          Delete case
        </Button>
      )}
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{name}&rdquo;?</DialogTitle>
            <DialogDescription>
              The case, its mapped wallets, labels, and tags are removed from this browser. Cached transactions are kept,
              because other cases may use them; clear them in Storage settings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
              Delete case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
