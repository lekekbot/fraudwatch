"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AddressState } from "@/lib/case/address-state";
import type { Names } from "@/lib/labels/labels";
import { cn } from "cn";
import { PanelSection } from "./panel";

export type CounterpartyRow = { address: string; count: number; state: AddressState };

const SHOWN = 30;

const STATE_SHORT: Partial<Record<AddressState, string>> = { OBSERVED: "obs", INFRASTRUCTURE: "infra", MAPPED: "mapped", PRIMARY: "primary" };

/**
 * Left-panel section: addresses on the other side of the selected wallet's
 * transactions, including who sent them. Shown without loading their history.
 */
export function CounterpartyList({ rows, names, selected, onSelect }: {
  rows: CounterpartyRow[];
  names: Names;
  selected: string | null;
  onSelect: (address: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, SHOWN);

  return (
    <PanelSection title={`Counterparties (${rows.length})`}>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No counterparties in the loaded transactions.</p>
      ) : (
        <ul className="-mx-1 flex flex-col">
          {visible.map((r) => {
            const tags = names.label(r.address)?.tags ?? [];
            return (
              <li key={r.address}>
                <button
                  type="button"
                  aria-current={r.address === selected}
                  onClick={() => onSelect(r.address)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs",
                    r.address === selected ? "bg-muted" : "hover:bg-muted/50",
                  )}
                  title={r.address}
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate", names.known(r.address) ? "" : "font-mono")}>{names.of(r.address)}</span>
                    {tags.length > 0 && <span className="block truncate text-muted-foreground">{tags.join(" · ")}</span>}
                  </span>
                  <span className="text-[10px] text-muted-foreground uppercase">{STATE_SHORT[r.state]}</span>
                  <span className="tabular-nums text-muted-foreground">{r.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > SHOWN && (
        <Button variant="ghost" size="xs" className="w-full" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Show fewer" : `Show all ${rows.length}`}
        </Button>
      )}
    </PanelSection>
  );
}
