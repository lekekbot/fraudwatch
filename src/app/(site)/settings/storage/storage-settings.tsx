"use client";

import { useEffect, useState } from "react";
import { DatabaseIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocalQuery } from "@/hooks/use-local-db";
import { describeStorageError, getDb } from "@/lib/db/db";
import {
  clearAllLocalData,
  clearTransactionCache,
  formatBytes,
  getStorageEstimate,
  getStorageSummary,
} from "@/lib/db/storage";

type Pending = "cache" | "all" | null;

export function StorageSettings() {
  const summary = useLocalQuery((db) => getStorageSummary(db), []);
  const [estimate, setEstimate] = useState<Awaited<ReturnType<typeof getStorageEstimate>>>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const refreshEstimate = () => void getStorageEstimate().then(setEstimate);
  useEffect(refreshEstimate, []);

  async function confirm() {
    setBusy(true);
    try {
      if (pending === "cache") {
        await clearTransactionCache(getDb());
        toast.success("Transaction cache cleared.");
        refreshEstimate();
      } else if (pending === "all") {
        await clearAllLocalData(getDb());
        // Every open query holds the deleted database, so reload the app rather than navigate client-side.
        window.location.replace(`${window.location.origin}/`);
        return;
      }
      setPending(null);
    } catch (err) {
      toast.error(describeStorageError(err));
    } finally {
      setBusy(false);
    }
  }

  const rows =
    summary.status === "ready"
      ? [
          ["Cases", summary.data.cases],
          ["Cached transactions", summary.data.transactions],
          ["Wallet history index entries", summary.data.walletIndexEntries],
          ["Wallets with cached coverage", summary.data.walletsWithCoverage],
        ]
      : [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <section className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Local storage</h2>
        <p className="text-muted-foreground">
          Everything FraudWatch keeps lives in this browser&apos;s IndexedDB. Nothing is stored on a server.
        </p>
      </section>

      {summary.status === "error" && (
        <Alert variant="destructive">
          <AlertTitle>Local storage unavailable</AlertTitle>
          <AlertDescription>{summary.error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseIcon className="size-4" />
            Cache size
          </CardTitle>
          <CardDescription>
            {estimate
              ? `${formatBytes(estimate.usageBytes)} used of ${formatBytes(estimate.quotaBytes)} available to this site.`
              : "This browser doesn't report storage usage."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between py-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{value.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clear data</CardTitle>
          <CardDescription>To delete a single case, open it and use Delete case.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <p className="font-medium">Clear transaction cache</p>
              <p className="text-muted-foreground">Keeps cases, labels, settings and your RPC endpoint. History is refetched on next load.</p>
            </div>
            <Button variant="outline" onClick={() => setPending("cache")}>
              Clear cache
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <p className="font-medium">Clear all local data</p>
              <p className="text-muted-foreground">Deletes every case, the cache, your settings and your saved RPC endpoint.</p>
            </div>
            <Button variant="destructive" onClick={() => setPending("all")}>
              <Trash2Icon />
              Clear everything
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && !busy && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending === "all" ? "Clear all local data?" : "Clear the transaction cache?"}</DialogTitle>
            <DialogDescription>
              {pending === "all"
                ? "All cases, cached transactions, labels, settings and your RPC endpoint will be deleted from this browser. This can't be undone."
                : "Cached transactions and coverage are deleted. Cases stay, and their history is fetched again from your RPC the next time you load it."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
              {pending === "all" ? "Delete everything" : "Clear cache"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
