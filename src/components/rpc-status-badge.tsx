"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { useLocalQuery } from "@/hooks/use-local-db";
import { getRpcSettings } from "@/lib/db/rpc-settings";
import { redactRpcUrl } from "@/lib/rpc/url";

export function RpcStatusBadge() {
  const settings = useLocalQuery((db) => getRpcSettings(db), []);

  if (settings.status !== "ready") return null;
  const rpc = settings.data;

  return (
    <Link href="/settings/rpc/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
      {rpc ? (
        <>
          <span className="hidden truncate sm:inline">{redactRpcUrl(rpc.url)}</span>
          <Badge variant={rpc.lastTest?.ok ? "secondary" : "outline"}>{rpc.lastTest?.ok ? "RPC ok" : "RPC untested"}</Badge>
        </>
      ) : (
        <Badge variant="destructive">No RPC configured</Badge>
      )}
    </Link>
  );
}
