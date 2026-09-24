import Link from "next/link";
import { ShieldIcon } from "lucide-react";
import { RpcStatusBadge } from "@/components/rpc-status-badge";

export function AppHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <ShieldIcon className="size-5" aria-hidden />
          FraudWatch
        </Link>
        <RpcStatusBadge />
      </div>
    </header>
  );
}
