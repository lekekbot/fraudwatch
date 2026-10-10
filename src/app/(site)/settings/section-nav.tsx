"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { cn } from "cn";

/**
 * The settings page's sections, kept beside the page as it scrolls (wide screens only).
 * The section at the top of the window is highlighted.
 */
export function SectionNav({ sections }: { sections: readonly { id: string; title: string }[] }) {
  const [current, setCurrent] = useState<string | null>(null);

  // Re-subscribed only when the list of sections changes, not on every render.
  const ids = sections.map((section) => section.id).join(",");
  useEffect(() => {
    const list = ids.split(",");
    const onScroll = () => {
      // The last section whose top has reached the upper part of the window; the last one at the bottom of the page.
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const passed = list.filter((id) => (document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= 120);
      setCurrent(atBottom ? (list.at(-1) ?? null) : (passed.at(-1) ?? list[0] ?? null));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [ids]);

  return (
    <nav aria-label="Settings sections" className="hidden lg:block">
      <div className="sticky top-8 flex flex-col gap-1 text-sm">
        <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">On this page</p>
        {sections.map(({ id, title }) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={current === id ? "location" : undefined}
            className={cn(
              "rounded-md px-2 py-1 text-muted-foreground transition-colors hover:text-foreground",
              current === id && "bg-muted font-medium text-foreground",
            )}
          >
            {title}
          </a>
        ))}
        <Link href="/settings/rpc/" className="mt-2 flex items-center gap-1 rounded-md border-t px-2 pt-3 pb-1 text-muted-foreground hover:text-foreground">
          RPC endpoint
          <ArrowUpRightIcon className="size-3.5" aria-hidden />
        </Link>
      </div>
    </nav>
  );
}
