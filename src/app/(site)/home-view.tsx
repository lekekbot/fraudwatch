"use client";

import Link from "next/link";
import { FolderOpenIcon, PlusIcon, ServerIcon, UploadIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocalQuery } from "@/hooks/use-local-db";
import { formatRange } from "@/lib/case/range";
import { listRecentCases } from "@/lib/db/cases";
import { getRpcSettings } from "@/lib/db/rpc-settings";
import { redactRpcUrl } from "@/lib/rpc/url";
import { shortenAddress } from "@/lib/solana/address";

export function HomeView() {
  const cases = useLocalQuery((db) => listRecentCases(db), []);
  const rpc = useLocalQuery((db) => getRpcSettings(db), []);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Cases</h1>
        <p className="text-muted-foreground">
          Everything stays in this browser. FraudWatch has no server and no account; transactions come from your own
          RPC.
        </p>
      </section>

      {cases.status === "error" && (
        <Alert variant="destructive">
          <AlertTitle>Local storage unavailable</AlertTitle>
          <AlertDescription>{cases.error} FraudWatch needs IndexedDB to keep cases on this device.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/cases/new/" className={buttonVariants({ size: "lg", className: "h-auto justify-start gap-3 py-4" })}>
          <PlusIcon />
          New case
        </Link>
        <Link
          href="/settings/rpc/"
          className={buttonVariants({ variant: "outline", size: "lg", className: "h-auto justify-start gap-3 py-4" })}
        >
          <ServerIcon />
          <span className="flex flex-col items-start">
            RPC settings
            <span className="text-xs font-normal text-muted-foreground">
              {rpc.status === "ready" ? (rpc.data ? redactRpcUrl(rpc.data.url) : "Not configured") : "…"}
            </span>
          </span>
        </Link>
        <Button variant="outline" size="lg" className="h-auto justify-start gap-3 py-4" disabled title="Arrives in Sprint 10">
          <UploadIcon />
          <span className="flex flex-col items-start">
            Import case
            <span className="text-xs font-normal text-muted-foreground">Coming soon</span>
          </span>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent local cases</CardTitle>
          <CardDescription>Stored in this browser&apos;s IndexedDB.</CardDescription>
        </CardHeader>
        <CardContent>
          {cases.status === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
          {cases.status === "ready" && cases.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No cases yet. Create one to get started.</p>
          )}
          {cases.status === "ready" && cases.data.length > 0 && (
            <ul className="divide-y">
              {cases.data.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/case/?id=${encodeURIComponent(c.id)}`}
                    className="flex items-center justify-between gap-4 py-3 hover:bg-muted/50"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {shortenAddress(c.primaryWallet, 6)} · {formatRange(c.range)}
                      </span>
                    </span>
                    <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
