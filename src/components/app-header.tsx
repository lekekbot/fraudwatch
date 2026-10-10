import Link from "next/link";
import { SettingsIcon, ShieldIcon } from "lucide-react";
import { RpcStatusBadge } from "@/components/rpc-status-badge";

export function AppHeader() {
  return (
    <header className="border-b">
      <div className="flex h-14 items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <ShieldIcon className="size-5" aria-hidden />
          FraudWatch
        </Link>
        <div className="flex items-center gap-3">
          <RpcStatusBadge />
          <Link
            href="/settings/"
            aria-label="Settings"
            title="Settings"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <SettingsIcon className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </header>
  );
}
