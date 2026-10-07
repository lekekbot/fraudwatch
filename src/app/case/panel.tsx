"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/** A docked side panel of the case workspace, scrolling independently of the canvas. */
export function SidePanel({ side, label, children }: {
  side: "left" | "right";
  label: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className={cn("flex shrink-0 flex-col overflow-y-auto bg-background", side === "left" ? "w-64 border-r" : "w-80 border-l")}
    >
      {children}
    </aside>
  );
}

/** The header toggles the section open and closed; `defaultCollapsed` is its starting state. */
export function PanelSection({ title, action, defaultCollapsed = false, children }: {
  title: string;
  action?: React.ReactNode;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={!defaultCollapsed} className="group flex flex-col border-b">
      <summary className="flex min-h-6 cursor-pointer list-none items-center justify-between gap-2 p-3 [&::-webkit-details-marker]:hidden">
        <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
        {/* stopPropagation keeps the header's buttons from toggling the section. */}
        <span className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
          {action}
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
        </span>
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-3">{children}</div>
    </details>
  );
}

/** A list cut to its first `limit` items, faded where it's cut, with a "Show +N more" toggle. */
export function ShowMoreList<T>({ items, limit, children }: {
  items: T[];
  limit: number;
  children: (visible: T[]) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const cut = items.length > limit && !expanded;
  return (
    <>
      <div className={cn(cut && "mask-b-from-[calc(100%-4rem)]")}>{children(cut ? items.slice(0, limit) : items)}</div>
      {items.length > limit && (
        <Button variant="ghost" size="xs" className="w-full" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show fewer" : `Show +${(items.length - limit).toLocaleString()} more`}
        </Button>
      )}
    </>
  );
}
