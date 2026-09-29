"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Remote token artwork with a readable symbol fallback when metadata is absent or broken. */
export function AssetIcon({ label, logo, className }: { label: string; logo?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      title={label}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-[8px] font-semibold text-muted-foreground",
        className,
      )}
    >
      {logo && !failed ? (
        // Runtime token metadata can point at any HTTPS host, so next/image cannot enumerate the domains.
        <img src={logo} alt={label} className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        label.slice(0, 4)
      )}
    </span>
  );
}
