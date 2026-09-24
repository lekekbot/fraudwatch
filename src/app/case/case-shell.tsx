"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { CopyIcon, ExternalLinkIcon, Link2Icon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocalQuery } from "@/hooks/use-local-db";
import { formatRange } from "@/lib/case/range";
import { getCase, touchCase } from "@/lib/db/cases";
import { getDb } from "@/lib/db/db";
import { getRpcSettings } from "@/lib/db/rpc-settings";
import { buildMapSearch } from "@/lib/routing/map-params";
import { shortenAddress } from "@/lib/solana/address";
import { IngestionPanel } from "./ingestion-panel";

export function CaseShell() {
  const id = useSearchParams().get("id") ?? "";
  const fwCase = useLocalQuery((db) => getCase(db, id), [id]);
  const rpc = useLocalQuery((db) => getRpcSettings(db), []);
  const found = fwCase.status === "ready" && fwCase.data !== undefined;

  useEffect(() => {
    if (found) void touchCase(getDb(), id).catch(() => {});
  }, [found, id]);

  if (fwCase.status === "loading") return <p className="text-sm text-muted-foreground">Loading case…</p>;
  if (fwCase.status === "error" || !fwCase.data) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-2xl">
        <AlertTitle>Case not found</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>
            {fwCase.status === "error"
              ? fwCase.error
              : "This case isn't in this browser's local storage. Cases don't sync between browsers or devices."}
          </span>
          <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Back to cases
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  const c = fwCase.data;
  const shareSearch = buildMapSearch({ wallet: c.primaryWallet, range: c.range });

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied.`);
    } catch {
      toast.error("Clipboard unavailable.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
        <p className="text-muted-foreground">
          <span className="font-mono">{shortenAddress(c.primaryWallet, 6)}</span> · {formatRange(c.range)}
        </p>
      </section>

      {rpc.status === "ready" && !rpc.data && (
        <Alert>
          <AlertTitle>No RPC configured</AlertTitle>
          <AlertDescription>
            Loading transactions needs your own Solana RPC endpoint.{" "}
            <Link href="/settings/rpc/" className="underline underline-offset-4">
              Add one in RPC settings
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Mapped wallets</CardTitle>
          <CardDescription>Only mapped wallets get a full history load. Counterparties stay shallow until you map them.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {c.mappedWallets.map((w) => (
              <li key={w.address} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="flex min-w-0 items-center gap-2">
                  <Badge variant={w.role === "primary" ? "default" : "secondary"}>{w.role}</Badge>
                  <span className="truncate font-mono text-sm">{c.labels[w.address] ?? w.address}</span>
                </span>
                <span className="flex gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label="Copy address" onClick={() => copy(w.address, "Address")}>
                    <CopyIcon />
                  </Button>
                  <a
                    href={`https://solscan.io/account/${w.address}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label="Open in explorer"
                    className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                  >
                    <ExternalLinkIcon />
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <IngestionPanel c={c} rpc={rpc.status === "ready" ? rpc.data : undefined} />

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>The chronological map arrives in a later sprint.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => copy(`${window.location.origin}/map/?${shareSearch}`, "Startup link")}>
            <Link2Icon />
            Copy startup link
          </Button>
          <span className="text-xs text-muted-foreground">Contains only the wallet and dates. Never labels or RPC settings.</span>
        </CardContent>
      </Card>
    </div>
  );
}
