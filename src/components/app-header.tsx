import Link from "next/link";
import { DatabaseIcon, ShieldIcon } from "lucide-react";
import { RpcStatusBadge } from "@/components/rpc-status-badge";

export function AppHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <ShieldIcon className="size-5" aria-hidden />
          FraudWatch
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/settings/storage/"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <DatabaseIcon className="size-4" aria-hidden />
            Storage
          </Link>
          <RpcStatusBadge />
        </div>
      </div>
    </header>
  );
}
