"use client";

import Link from "next/link";
import { useState } from "react";
import { FolderOpenIcon, PencilIcon, PlusIcon, ServerIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocalQuery } from "@/hooks/use-local-db";
import { formatRange } from "@/lib/case/range";
import { listRecentCases } from "@/lib/db/cases";
import { getRpcSettings } from "@/lib/db/rpc-settings";
import { buildCasePath } from "@/lib/routing/case-path";
import { redactRpcUrl } from "@/lib/rpc/url";
import { shortenAddress } from "@/lib/solana/address";
import { CaseNameInput } from "../case/case-name-input";
import { DeleteCaseButton } from "../case/delete-case-button";

export function HomeView() {
  const cases = useLocalQuery((db) => listRecentCases(db), []);
  const rpc = useLocalQuery((db) => getRpcSettings(db), []);
  /** The case whose name is being edited in the list. */
  const [renaming, setRenaming] = useState<string | null>(null);

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

      <div className="grid gap-4 sm:grid-cols-2">
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
          {/* Separated rows with their own margin, instead of dividers running them together. */}
          {cases.status === "ready" && cases.data.length > 0 && (
            <ul className="flex flex-col gap-1">
              {cases.data.map((c) => (
                <li key={c.id} className="group/case flex items-center gap-1 rounded-md border border-transparent pr-2 hover:border-border hover:bg-muted/50">
                  {renaming === c.id ? (
                    // While renaming, the row isn't a link: a click in the field mustn't open the case.
                    <span className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2">
                      <CaseNameInput id={c.id} name={c.name} onDone={() => setRenaming(null)} className="h-8" />
                      <span className="font-mono text-xs text-muted-foreground">
                        {shortenAddress(c.primaryWallet, 6)} · {formatRange(c.range)}
                      </span>
                    </span>
                  ) : (
                    <Link href={buildCasePath(c.id, "timeline")} className="flex min-w-0 flex-1 items-center justify-between gap-4 px-3 py-3">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {shortenAddress(c.primaryWallet, 6)} · {formatRange(c.range)}
                        </span>
                      </span>
                      <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label={`Rename ${c.name}`}
                    title="Rename case"
                    onClick={() => setRenaming(c.id)}
                  >
                    <PencilIcon />
                  </Button>
                  <DeleteCaseButton id={c.id} name={c.name} compact />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
