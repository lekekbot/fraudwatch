"use client";

import { useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { ChevronRightIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { Names } from "@/lib/labels/labels";
import { registry } from "@/lib/protocols/registry";
import { parseUnits } from "@/lib/solana/amount";
import type { EffectKind } from "@/lib/state/summarize";
import { type FilterableTx, type TxFilter, EMPTY_FILTER, isFilterActive, movedAssets, toggled } from "@/lib/timeline/filter";
import { cn } from "cn";
import { type Assets, assetLabel } from "./asset-format";
import { PanelSection, ShowMoreList } from "./panel";

export const KINDS: { kind: EffectKind; label: string; dot: string }[] = [
  { kind: "SEND", label: "Send", dot: "bg-destructive" },
  { kind: "RECEIVE", label: "Receive", dot: "bg-[oklch(0.72_0.16_155)]" },
  { kind: "SWAP", label: "Swap", dot: "bg-[oklch(0.7_0.14_250)]" },
  { kind: "NFT_BUY", label: "NFT buy", dot: "bg-[oklch(0.72_0.16_310)]" },
  { kind: "NFT_SELL", label: "NFT sale", dot: "bg-[oklch(0.72_0.16_310)]" },
  { kind: "NFT_MINT", label: "NFT mint", dot: "bg-[oklch(0.72_0.16_310)]" },
  { kind: "NFT_SWAP", label: "NFT swap", dot: "bg-[oklch(0.72_0.16_310)]" },
  { kind: "NFT_TRANSFER", label: "NFT transfer", dot: "bg-[oklch(0.72_0.16_310)]" },
  { kind: "BURN", label: "Burn", dot: "bg-[oklch(0.72_0.17_50)]" },
  { kind: "APPROVAL", label: "Approval", dot: "bg-[oklch(0.8_0.15_80)]" },
  { kind: "STAKE", label: "Stake", dot: "bg-muted-foreground" },
  { kind: "ACCOUNT", label: "Account setup", dot: "bg-muted-foreground" },
  { kind: "PROGRAM", label: "Program call", dot: "bg-muted-foreground" },
  { kind: "FAILED", label: "Failed", dot: "border border-destructive" },
];

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs",
        on ? "hover:bg-muted/50" : "text-muted-foreground line-through opacity-60 hover:bg-muted/50",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A collapsible filter group. Groups start closed unless `open`, and open
 * themselves when they hold an active filter, whose count shows in the header.
 * They never close themselves: clearing the last filter mustn't fold the list
 * away under the cursor.
 */
function FilterGroup({ title, active, open = false, children }: { title: string; active: number; open?: boolean; children: React.ReactNode }) {
  return (
    <details
      ref={(el) => {
        if (el && (open || active > 0)) el.open = true;
      }}
      className="group/filter"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-sm py-0.5 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3 shrink-0 transition-transform group-open/filter:rotate-90" aria-hidden />
        <span className="flex-1">{title}</span>
        {active > 0 && <span className="rounded-full bg-secondary px-1.5 text-[10px] text-foreground tabular-nums">{active}</span>}
      </summary>
      <div className="flex flex-col gap-2 pt-1.5">{children}</div>
    </details>
  );
}

/** Protocol id → display name, from the registry. */
export const protocolName = (id: string) => registry.protocols.get(id)?.name ?? id;

const DAY = 86_400_000;
const SHOWN_ASSETS = 8;
const dateInput = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const tabClass =
  "flex-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-active:bg-secondary data-active:text-foreground";

/** Left-panel section: choose which transactions appear on the map and in the table. */
export function FilterPanel({ rows, assets, names, decimalsOf, caseRange, filter, shown, onChange, hide, decoyCount = 0 }: {
  /** Every transaction the views could show, one per wallet side. */
  rows: FilterableTx[];
  assets: Assets;
  names: Names;
  /** Decimals of an asset, for reading a typed minimum amount. */
  decimalsOf: (assetId: string) => number;
  caseRange: { start: string; end: string };
  filter: TxFilter;
  shown: number;
  onChange: (filter: TxFilter) => void;
  /** Hide what the filters show, or what they take out of view (once per transaction each); filters are then cleared. */
  hide?: { shown: { count: number; run: () => void }; filteredOut: { count: number; run: () => void } };
  /** Likely dust decoys (address-poisoning look-alikes) in the case; offers a filter to leave them out. */
  decoyCount?: number;
}) {
  const kindCounts = new Map<EffectKind, number>();
  const assetCounts = new Map<string, number>();
  const protocolCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  for (const row of rows) {
    kindCounts.set(row.summary.kind, (kindCounts.get(row.summary.kind) ?? 0) + 1);
    for (const a of movedAssets(row.summary)) assetCounts.set(a, (assetCounts.get(a) ?? 0) + 1);
    for (const p of row.protocols) protocolCounts.set(p, (protocolCounts.get(p) ?? 0) + 1);
    const tags = new Set(row.addresses.flatMap((a) => names.label(a)?.tags ?? []));
    for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const assetRows = [...assetCounts].sort((a, b) => b[1] - a[1]);
  const protocolRows = [...protocolCounts].sort((a, b) => b[1] - a[1]);
  const tagRows = [...tagCounts].sort((a, b) => b[1] - a[1]);

  // Minimum amount: typed text and asset, applied when it parses.
  const [minText, setMinText] = useState("");
  const [minAsset, setMinAsset] = useState<string>(filter.minAmount?.assetId ?? assetRows[0]?.[0] ?? "SOL");
  const applyMin = (text: string, assetId: string) => {
    setMinText(text);
    setMinAsset(assetId);
    const amount = text.trim() ? parseUnits(text, decimalsOf(assetId)) : null;
    if (!text.trim()) onChange({ ...filter, minAmount: null });
    else if (amount !== null) onChange({ ...filter, minAmount: { assetId, amount } });
  };
  const minInvalid = minText.trim() !== "" && parseUnits(minText, decimalsOf(minAsset)) === null;

  return (
    <PanelSection
      title="Filters"
      collapsible
      action={
        isFilterActive(filter) && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setMinText("");
              onChange(EMPTY_FILTER);
            }}
          >
            Reset
          </Button>
        )
      }
    >
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Showing {shown.toLocaleString()} of {rows.length.toLocaleString()} transactions
      </p>

      {filter.address && (
        <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs">
          <span className="min-w-0 flex-1 truncate">
            Only with <span className={names.known(filter.address) ? "" : "font-mono"}>{names.of(filter.address)}</span>
          </span>
          <Button variant="ghost" size="icon-xs" aria-label="Clear address filter" onClick={() => onChange({ ...filter, address: null })}>
            <XIcon />
          </Button>
        </div>
      )}

      {filter.relationship && (
        <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs">
          <span className="min-w-0 flex-1 truncate" title={filter.relationship.label}>
            Only {filter.relationship.label}
          </span>
          <Button variant="ghost" size="icon-xs" aria-label="Clear relationship filter" onClick={() => onChange({ ...filter, relationship: null })}>
            <XIcon />
          </Button>
        </div>
      )}

      <FilterGroup title="Type" active={filter.hiddenKinds.size} open>
        <div className="-mx-1 flex flex-col" role="group" aria-label="Transaction type">
          {KINDS.filter(({ kind }) => kindCounts.has(kind)).map(({ kind, label, dot }) => (
            <Toggle key={kind} on={!filter.hiddenKinds.has(kind)} onClick={() => onChange({ ...filter, hiddenKinds: toggled(filter.hiddenKinds, kind) })}>
              <span className={cn("size-2 shrink-0 rounded-full", dot)} aria-hidden />
              <span className="flex-1">{label}</span>
              <span className="tabular-nums">{kindCounts.get(kind)}</span>
            </Toggle>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="Direction" active={filter.direction === "any" ? 0 : 1} open>
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Direction">
          {(["any", "in", "out"] as const).map((d) => (
            <Button
              key={d}
              size="xs"
              className="flex-1"
              variant={filter.direction === d ? "secondary" : "ghost"}
              aria-pressed={filter.direction === d}
              title={d === "in" ? "Value came into the wallet (swaps count as both)" : d === "out" ? "Value left the wallet (swaps count as both)" : undefined}
              onClick={() => onChange({ ...filter, direction: d })}
            >
              {d === "any" ? "Any" : d === "in" ? "Incoming" : "Outgoing"}
            </Button>
          ))}
        </div>
      </FilterGroup>

      {assetRows.length > 0 && (
        <FilterGroup title="Minimum amount" active={filter.minAmount ? 1 : 0}>
          <div className="flex gap-1">
            <Input
              inputMode="decimal"
              aria-label="Minimum amount"
              aria-invalid={minInvalid || undefined}
              placeholder="0"
              className="h-7 min-w-0 flex-1 text-xs"
              value={minText}
              onChange={(event) => applyMin(event.target.value, minAsset)}
            />
            <select
              aria-label="Asset for the minimum amount"
              className="h-7 max-w-28 truncate rounded-md border bg-transparent px-1 text-xs dark:bg-input/30"
              value={minAsset}
              onChange={(event) => applyMin(minText, event.target.value)}
            >
              {assetRows.map(([assetId]) => (
                <option key={assetId} value={assetId}>
                  {assetLabel(assetId, assets)}
                </option>
              ))}
            </select>
          </div>
          {minInvalid && <p className="text-xs text-destructive">Not a valid amount for this asset.</p>}
        </FilterGroup>
      )}

      {(assetRows.length > 0 || protocolRows.length > 0) && (
        <FilterGroup
          title={assetRows.length > 0 && protocolRows.length > 0 ? "Assets & protocols" : assetRows.length > 0 ? "Assets moved" : "Protocols"}
          active={filter.hiddenAssets.size + filter.protocols.size}
        >
          {(() => {
            // Both lists present share one tabbed section; either alone stands on its own.
            const assetsMoved =
              assetRows.length > 0 ? (
                <>
                  <ShowMoreList items={assetRows} limit={SHOWN_ASSETS}>
                    {(visible) => (
                      <div className="-mx-1 flex flex-col" role="group" aria-label="Assets">
                        {visible.map(([assetId, count]) => (
                          <Toggle
                            key={assetId}
                            on={!filter.hiddenAssets.has(assetId)}
                            onClick={() => onChange({ ...filter, hiddenAssets: toggled(filter.hiddenAssets, assetId) })}
                          >
                            <span className="flex-1 truncate" title={assetId}>
                              {assetLabel(assetId, assets)}
                            </span>
                            <span className="tabular-nums">{count}</span>
                          </Toggle>
                        ))}
                      </div>
                    )}
                  </ShowMoreList>
                  <p className="text-xs text-muted-foreground">A transaction is hidden only when every asset it moves is hidden.</p>
                </>
              ) : null;
            const protocols =
              protocolRows.length > 0 ? (
                <div className="-mx-1 flex flex-col" role="group" aria-label="Protocols">
                  {protocolRows.map(([id, count]) => (
                    <OnlyToggle
                      key={id}
                      on={filter.protocols.has(id)}
                      onClick={() => onChange({ ...filter, protocols: toggled(filter.protocols, id) })}
                    >
                      <span className="flex-1 truncate">{protocolName(id)}</span>
                      <span className="tabular-nums">{count}</span>
                    </OnlyToggle>
                  ))}
                </div>
              ) : null;
            if (assetsMoved && protocols) {
              return (
                <Tabs.Root defaultValue="assets" className="flex flex-col gap-1.5">
                  <Tabs.List className="flex rounded-lg border p-0.5" aria-label="Assets and protocols">
                    <Tabs.Tab value="assets" className={tabClass}>
                      Assets
                    </Tabs.Tab>
                    <Tabs.Tab value="protocols" className={tabClass}>
                      Protocols{filter.protocols.size > 0 ? " · selected" : ""}
                    </Tabs.Tab>
                  </Tabs.List>
                  <Tabs.Panel value="assets">{assetsMoved}</Tabs.Panel>
                  <Tabs.Panel value="protocols">{protocols}</Tabs.Panel>
                </Tabs.Root>
              );
            }
            return (
              <>
                {assetsMoved}
                {protocols}
              </>
            );
          })()}
        </FilterGroup>
      )}

      {tagRows.length > 0 && (
        <FilterGroup title={`Tags${filter.tags.size > 0 ? " · only selected" : ""}`} active={filter.tags.size}>
          <div className="-mx-1 flex flex-col" role="group" aria-label="Tags">
            {tagRows.map(([tag, count]) => (
              <OnlyToggle key={tag} on={filter.tags.has(tag)} onClick={() => onChange({ ...filter, tags: toggled(filter.tags, tag) })}>
                <span className="flex-1 truncate">{tag}</span>
                <span className="tabular-nums">{count}</span>
              </OnlyToggle>
            ))}
          </div>
        </FilterGroup>
      )}

      {decoyCount > 0 && (
        <FilterGroup title="Look-alikes" active={filter.hideDecoys ? 1 : 0}>
          <label className="flex cursor-pointer items-center gap-2 px-1 text-xs">
            <Checkbox checked={filter.hideDecoys} onCheckedChange={(checked) => onChange({ ...filter, hideDecoys: checked === true })} />
            <span className="flex-1">Hide likely dust decoys</span>
            <span className="tabular-nums text-muted-foreground">{decoyCount}</span>
          </label>
          <p className="text-[11px] text-muted-foreground">
            Leaves out transactions with addresses that imitate another in the case and only move dust.
          </p>
        </FilterGroup>
      )}

      <FilterGroup title="Dates (UTC)" active={filter.dateRange ? 1 : 0}>
        <div className="flex items-center gap-1 text-xs">
          <Input
            type="date"
            aria-label="From date"
            className="h-7 min-w-0 flex-1 px-1 text-xs"
            min={caseRange.start.slice(0, 10)}
            max={dateInput(Date.parse(caseRange.end) - 1)}
            value={filter.dateRange ? dateInput(filter.dateRange.start) : ""}
            onChange={(event) => {
              const start = event.target.value ? Date.parse(`${event.target.value}T00:00:00Z`) : null;
              const end = filter.dateRange?.end ?? Date.parse(caseRange.end);
              onChange({ ...filter, dateRange: start === null ? (filter.dateRange && filter.dateRange.end < Date.parse(caseRange.end) ? { start: Date.parse(caseRange.start), end } : null) : { start, end } });
            }}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="date"
            aria-label="To date (inclusive)"
            className="h-7 min-w-0 flex-1 px-1 text-xs"
            min={caseRange.start.slice(0, 10)}
            max={dateInput(Date.parse(caseRange.end) - 1)}
            value={filter.dateRange && filter.dateRange.end < Date.parse(caseRange.end) ? dateInput(filter.dateRange.end - DAY) : ""}
            onChange={(event) => {
              const end = event.target.value ? Date.parse(`${event.target.value}T00:00:00Z`) + DAY : null;
              const start = filter.dateRange?.start ?? Date.parse(caseRange.start);
              onChange({ ...filter, dateRange: end === null ? (filter.dateRange && filter.dateRange.start > Date.parse(caseRange.start) ? { start, end: Date.parse(caseRange.end) } : null) : { start, end } });
            }}
          />
        </div>
      </FilterGroup>

      {hide && isFilterActive(filter) && (() => {
        // Unticking a type or asset takes noise out of view, so that's what to hide; the other filters zoom in on it.
        const excluding = filter.hiddenKinds.size > 0 || filter.hiddenAssets.size > 0 || filter.hideDecoys;
        const options = [
          { key: "out", label: `Hide the ${hide.filteredOut.count.toLocaleString()} filtered out`, ...hide.filteredOut },
          { key: "shown", label: `Hide the ${hide.shown.count.toLocaleString()} shown`, ...hide.shown },
        ].filter((o) => o.count > 0);
        if (!excluding) options.reverse();
        const run = (go: () => void) => {
          go();
          setMinText("");
          onChange(EMPTY_FILTER);
        };
        return (
          options.length > 0 && (
            <div className="mt-1 flex flex-col items-start gap-0.5" title="Leaves them off the map for good (undo from the message, or unhide later in the table). Filters are then cleared.">
              <Button variant="outline" size="xs" onClick={() => run(options[0].run)}>
                {options[0].label}
              </Button>
              {options[1] && (
                <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => run(options[1].run)}>
                  or {options[1].label.charAt(0).toLowerCase() + options[1].label.slice(1)} instead
                </Button>
              )}
            </div>
          )
        );
      })()}
    </PanelSection>
  );
}

/** A toggle for "only these" lists: highlighted when selected, never struck through. */
function OnlyToggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs", on ? "bg-muted font-medium" : "hover:bg-muted/50")}
    >
      {children}
    </button>
  );
}
