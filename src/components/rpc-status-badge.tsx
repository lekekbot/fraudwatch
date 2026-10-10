"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { useLocalQuery } from "@/hooks/use-local-db";
import { getRpcSettings } from "@/lib/db/rpc-settings";

export function RpcStatusBadge() {
  const settings = useLocalQuery((db) => getRpcSettings(db), []);

  if (settings.status !== "ready") return null;
  const rpc = settings.data;

  return (
    <Link href="/settings/rpc/" title="RPC settings" className="flex items-center rounded-md outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring">
      {rpc ? (
        <Badge
          variant={!rpc.lastTest ? "outline" : rpc.lastTest.ok ? "secondary" : "destructive"}
          title={
            rpc.lastTest
              ? `${rpc.lastTest.ok ? "Working" : "Failed"} when last ${rpc.lastTest.source === "load" ? "used to load transactions" : "tested"}, ${new Date(rpc.lastTest.at).toLocaleString()}`
              : "Not used or tested yet"
          }
        >
          {!rpc.lastTest ? "RPC untested" : rpc.lastTest.ok ? "RPC ok" : "RPC error"}
        </Badge>
      ) : (
        <Badge variant="destructive">No RPC configured</Badge>
      )}
    </Link>
  );
}
