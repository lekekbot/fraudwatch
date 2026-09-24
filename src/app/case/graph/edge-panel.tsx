"use client";

import { ArrowRightIcon, ChartNoAxesGanttIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GraphEdge } from "@/lib/graph/build";
import type { Names } from "@/lib/labels/labels";
import type { WalletState, WalletTransactionEffect } from "@/lib/state/reconstruct";
import type { EffectSummary } from "@/lib/state/summarize";
import { type Assets, assetLabel, formatAssetAmount, formatUtc } from "../asset-format";
import { PanelSection } from "../panel";

const KIND_TEXT: Record<GraphEdge["kind"], string> = {
  flow: "Value transfer",
  sent_by: "Sent transactions for the wallet",
  program: "Program called by the wallet",
};

const MAX_ROWS = 100;

/** Inspector for one graph edge: the pair, what moved, and the transactions behind it. */
export function EdgePanel({
  edge,
  names,
  state,
  assets,
  rows,
  onSelectAddress,
  onShowOnTimeline,
  onClose,
}: {
  edge: GraphEdge;
  names: Names;
  state: WalletState;
  assets: Assets;
  /** The edge's transactions, chronological. */
  rows: { effect: WalletTransactionEffect; summary: EffectSummary }[];
  onSelectAddress: (address: string) => void;
  onShowOnTimeline: (signature: string) => void;
  onClose: () => void;
}) {
  const endpoint = (address: string) =>
    address === state.wallet ? (
      <span className="truncate text-xs font-medium">{names.of(address)}</span>
    ) : (
      <button
        type="button"
        title={address}
        onClick={() => onSelectAddress(address)}
        className={`truncate text-left text-xs underline-offset-4 hover:underline ${names.known(address) ? "" : "font-mono"}`}
      >
        {names.of(address)}
      </button>
    );

  return (
    <>
      <PanelSection
        title={KIND_TEXT[edge.kind]}
        action={
          <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
            <XIcon />
          </Button>
        }
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {endpoint(edge.source)}
          <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {endpoint(edge.target)}
        </div>
        <p className="text-xs text-muted-foreground">
          {edge.signatures.length.toLocaleString()} transaction{edge.signatures.length === 1 ? "" : "s"}
          {edge.first !== null && edge.last !== null && (
            <>
              {" "}
              · {formatUtc(edge.first).slice(0, 10)}
              {edge.last !== edge.first && ` → ${formatUtc(edge.last).slice(0, 10)}`}
            </>
          )}
        </p>
        {edge.totals.length > 0 && (
          <dl className="text-sm">
            {edge.totals.map((t) => (
              <div key={t.assetId} className="flex justify-between gap-4 py-0.5">
                <dt className="text-muted-foreground" title={t.assetId}>
                  {assetLabel(t.assetId, assets)}
                </dt>
                <dd className="tabular-nums">{formatAssetAmount(t.amount, t.assetId, state, assets)}</dd>
              </div>
            ))}
          </dl>
        )}
        {edge.kind === "flow" && (
          <p className="text-xs text-muted-foreground">Totals are what the counterparty&apos;s own balances did.</p>
        )}
      </PanelSection>

      <PanelSection title="Transactions">
        <ul className="-mx-1 flex flex-col">
          {rows.slice(0, MAX_ROWS).map(({ effect, summary }) => (
            <li key={effect.signature} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
              <span className="min-w-0 flex-1">
                <span className="block text-xs tabular-nums">{formatUtc(effect.timestamp)}</span>
                <Badge variant="outline" className="mt-0.5 text-[10px]">
                  {summary.kind.replace("_", " ")}
                </Badge>
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Show on timeline"
                title="Show on timeline"
                onClick={() => onShowOnTimeline(effect.signature)}
              >
                <ChartNoAxesGanttIcon />
              </Button>
              <a
                href={`https://solscan.io/tx/${effect.signature}`}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="Open in explorer"
                title="Open in explorer"
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ExternalLinkIcon className="size-3" />
              </a>
            </li>
          ))}
        </ul>
        {rows.length > MAX_ROWS && (
          <p className="text-xs text-muted-foreground">
            Showing the first {MAX_ROWS} of {rows.length.toLocaleString()}.
          </p>
        )}
      </PanelSection>
    </>
  );
}
