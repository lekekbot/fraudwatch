"use client";

import type { AddressState } from "@/lib/case/address-state";
import type { Names } from "@/lib/labels/labels";
import { cn } from "cn";
import { LookalikeMark } from "./lookalike";
import { PanelSection, ShowMoreList } from "./panel";

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
  return (
    <PanelSection title={`Counterparties (${rows.length})`} defaultCollapsed>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No counterparties in the loaded transactions.</p>
      ) : (
        <ShowMoreList items={rows} limit={SHOWN}>
          {(visible) => (
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
                        <span className="flex min-w-0 items-center gap-1">
                          <span className={cn("block truncate", names.known(r.address) ? "" : "font-mono")}>{names.of(r.address)}</span>
                          {names.lookalikes(r.address).length > 0 && <LookalikeMark count={names.lookalikes(r.address).length} />}
                        </span>
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
        </ShowMoreList>
      )}
    </PanelSection>
  );
}
