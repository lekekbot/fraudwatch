"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Names } from "@/lib/labels/labels";
import { registry } from "@/lib/protocols/registry";
import { parseUnits } from "@/lib/solana/amount";
import type { EffectKind } from "@/lib/state/summarize";
import { type FilterableTx, type TxFilter, EMPTY_FILTER, isFilterActive, movedAssets, toggled } from "@/lib/timeline/filter";
import { cn } from "cn";
import { type Assets, assetLabel } from "./asset-format";
import { PanelSection, ShowMoreList } from "./panel";

const KINDS: { kind: EffectKind; label: string; dot: string }[] = [
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

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-1 text-xs text-muted-foreground">{children}</h3>;
}

/** Protocol id → display name, from the registry. */
const protocolName = (id: string) => registry.protocols.get(id)?.name ?? id;

const DAY = 86_400_000;
const SHOWN_ASSETS = 25;
const dateInput = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Left-panel section: choose which transactions appear on the map and in the table. */
export function FilterPanel({ rows, assets, names, decimalsOf, caseRange, filter, shown, onChange }: {
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

      <div className="-mx-1 flex flex-col" role="group" aria-label="Transaction type">
        {KINDS.filter(({ kind }) => kindCounts.has(kind)).map(({ kind, label, dot }) => (
          <Toggle key={kind} on={!filter.hiddenKinds.has(kind)} onClick={() => onChange({ ...filter, hiddenKinds: toggled(filter.hiddenKinds, kind) })}>
            <span className={cn("size-2 shrink-0 rounded-full", dot)} aria-hidden />
            <span className="flex-1">{label}</span>
            <span className="tabular-nums">{kindCounts.get(kind)}</span>
          </Toggle>
        ))}
      </div>

      <Heading>Direction</Heading>
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

      {assetRows.length > 0 && (
        <>
          <Heading>Minimum amount</Heading>
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

          <Heading>Assets moved</Heading>
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
      )}

      {protocolRows.length > 0 && (
        <>
          <Heading>Protocols {filter.protocols.size > 0 && "· only selected"}</Heading>
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
        </>
      )}

      {tagRows.length > 0 && (
        <>
          <Heading>Tags {filter.tags.size > 0 && "· only selected"}</Heading>
          <div className="-mx-1 flex flex-col" role="group" aria-label="Tags">
            {tagRows.map(([tag, count]) => (
              <OnlyToggle key={tag} on={filter.tags.has(tag)} onClick={() => onChange({ ...filter, tags: toggled(filter.tags, tag) })}>
                <span className="flex-1 truncate">{tag}</span>
                <span className="tabular-nums">{count}</span>
              </OnlyToggle>
            ))}
          </div>
        </>
      )}

      <Heading>Dates (UTC)</Heading>
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

      {filter.hiddenSignatures.size > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            {filter.hiddenSignatures.size} hidden individually
          </span>
          <Button variant="ghost" size="xs" onClick={() => onChange({ ...filter, hiddenSignatures: new Set() })}>
            Show all
          </Button>
        </div>
      )}
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
