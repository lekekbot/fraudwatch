"use client";

import { Button } from "@/components/ui/button";
import type { EffectKind, EffectSummary } from "@/lib/state/summarize";
import { type TxFilter, EMPTY_FILTER, isFilterActive, movedAssets, toggled } from "@/lib/timeline/filter";
import { cn } from "@/lib/utils";
import { type Assets, assetLabel } from "./asset-format";
import { PanelSection } from "./panel";

const KINDS: { kind: EffectKind; label: string; dot: string }[] = [
  { kind: "SEND", label: "Send", dot: "bg-destructive" },
  { kind: "RECEIVE", label: "Receive", dot: "bg-[oklch(0.72_0.16_155)]" },
  { kind: "SWAP", label: "Swap", dot: "bg-[oklch(0.7_0.14_250)]" },
  { kind: "NFT_BUY", label: "NFT buy", dot: "bg-[oklch(0.72_0.16_310)]" },
  { kind: "NFT_SELL", label: "NFT sale", dot: "bg-[oklch(0.72_0.16_310)]" },
  { kind: "NFT_MINT", label: "NFT mint", dot: "bg-[oklch(0.72_0.16_310)]" },
  { kind: "NFT_TRANSFER", label: "NFT transfer", dot: "bg-[oklch(0.72_0.16_310)]" },
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

/** Left-panel section: choose which transactions appear on the map and in the table. */
export function FilterPanel({ summaries, assets, filter, shown, onChange }: {
  summaries: EffectSummary[];
  assets: Assets;
  filter: TxFilter;
  shown: number;
  onChange: (filter: TxFilter) => void;
}) {
  const kindCounts = new Map<EffectKind, number>();
  const assetCounts = new Map<string, number>();
  for (const s of summaries) {
    kindCounts.set(s.kind, (kindCounts.get(s.kind) ?? 0) + 1);
    for (const a of movedAssets(s)) assetCounts.set(a, (assetCounts.get(a) ?? 0) + 1);
  }
  const assetRows = [...assetCounts].sort((a, b) => b[1] - a[1]);

  return (
    <PanelSection
      title="Filters"
      action={
        isFilterActive(filter) && (
          <Button variant="ghost" size="xs" onClick={() => onChange(EMPTY_FILTER)}>
            Reset
          </Button>
        )
      }
    >
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Showing {shown.toLocaleString()} of {summaries.length.toLocaleString()} transactions
      </p>

      <div className="-mx-1 flex flex-col" role="group" aria-label="Transaction type">
        {KINDS.filter(({ kind }) => kindCounts.has(kind)).map(({ kind, label, dot }) => (
          <Toggle key={kind} on={!filter.hiddenKinds.has(kind)} onClick={() => onChange({ ...filter, hiddenKinds: toggled(filter.hiddenKinds, kind) })}>
            <span className={cn("size-2 shrink-0 rounded-full", dot)} aria-hidden />
            <span className="flex-1">{label}</span>
            <span className="tabular-nums">{kindCounts.get(kind)}</span>
          </Toggle>
        ))}
      </div>

      {assetRows.length > 0 && (
        <>
          <h3 className="pt-1 text-xs text-muted-foreground">Assets moved</h3>
          <div className="-mx-1 flex flex-col" role="group" aria-label="Assets">
            {assetRows.map(([assetId, count]) => (
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
          <p className="text-xs text-muted-foreground">A transaction is hidden only when every asset it moves is hidden.</p>
        </>
      )}

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
