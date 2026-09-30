"use client";

import { ArrowDownLeftIcon, ArrowRightIcon, ArrowUpRightIcon, ChartNoAxesGanttIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { edgeFlow, summarizeRelationship, type GraphEdge } from "@/lib/graph/build";
import type { Names } from "@/lib/labels/labels";
import { type Assets, assetLabel, assetLogo, formatUtc } from "../asset-format";
import { AssetIcon } from "../asset-icon";
import { PanelSection } from "../panel";

/**
 * Inspector for one connection: the wallet pair, then every underlying
 * transaction in time order, each with its real direction, token and amount.
 */
export function EdgePanel({
  edge,
  focusWallet,
  names,
  assets,
  formatAmount,
  onSelectAddress,
  onShowOnTimeline,
  onViewAll,
  onClose,
}: {
  edge: GraphEdge;
  focusWallet: string;
  names: Names;
  assets: Assets;
  /** Base units → display amount for an asset. */
  formatAmount: (amount: string, assetId: string) => string;
  onSelectAddress: (address: string) => void;
  onShowOnTimeline: (signature: string, wallet: string) => void;
  onViewAll: (counterparty: string) => void;
  onClose: () => void;
}) {
  const name = (address: string) => (
    <button
      type="button"
      title={address}
      onClick={() => onSelectAddress(address)}
      className={`min-w-0 truncate text-left underline-offset-4 hover:underline ${names.known(address) ? "" : "font-mono"}`}
    >
      {names.of(address)}
    </button>
  );
  const program = edge.kind === "program";
  const flow = edgeFlow(edge);
  const summary = edge.summary ?? summarizeRelationship(edge);
  const counterparty = edge.a === focusWallet ? edge.b : edge.a;
  const sent = focusWallet === edge.a ? summary.aToB : summary.bToA;
  const received = focusWallet === edge.a ? summary.bToA : summary.aToB;
  const direction = sent === 0 ? "Incoming only" : received === 0 ? "Outgoing only" : sent >= received * 1.5 ? "Mostly outbound" : received >= sent * 1.5 ? "Mostly inbound" : "Reciprocal";
  const representatives = edge.interactions.length <= 6 ? edge.interactions : [edge.interactions[0], ...edge.interactions.slice(-3)];
  const dominantAsset = summary.assets[0];
  const dominantType = summary.transactionTypes[0];

  return (
    <>
      <PanelSection
        title={program ? "Program connection" : "Wallet interaction"}
        action={
          <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
            <XIcon />
          </Button>
        }
      >
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          {name(flow.from)}
          <span className="shrink-0 text-muted-foreground" aria-label={program || flow.forward === 0 || flow.bidirectional ? "interacted with" : "sent to"}>
            {program || flow.forward === 0 || flow.bidirectional ? "↔" : "→"}
          </span>
          {name(flow.to)}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {summary.totalInteractions.toLocaleString()} interactions. {program ? "This relationship consists of program calls." : `${direction}.`}
          {dominantAsset && ` ${assetLabel(dominantAsset.assetId, assets)} appears in ${dominantAsset.txCount.toLocaleString()} interactions.`}
          {dominantType && ` ${dominantType.kind.replaceAll("_", " ").toLowerCase()} is the dominant transaction type.`}
        </p>
      </PanelSection>

      {!program && (
        <PanelSection title="Relationship">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border bg-destructive/5 p-2">
              <span className="flex items-center gap-1 text-destructive"><ArrowUpRightIcon className="size-3.5" /> Sent</span>
              <strong className="mt-1 block text-base tabular-nums text-foreground">{sent.toLocaleString()}</strong>
            </div>
            <div className="rounded-md border bg-emerald-500/5 p-2">
              <span className="flex items-center gap-1 text-emerald-500"><ArrowDownLeftIcon className="size-3.5" /> Received</span>
              <strong className="mt-1 block text-base tabular-nums text-foreground">{received.toLocaleString()}</strong>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <Badge variant="outline">{direction}</Badge>
          </div>
        </PanelSection>
      )}

      {summary.assets.length > 0 && (
        <PanelSection title="Assets">
          <div className="flex flex-col gap-2">
            {summary.assets.slice(0, 4).map((asset) => (
              <div key={asset.assetId} className="flex items-center gap-2 text-xs">
                <AssetIcon label={assetLabel(asset.assetId, assets)} logo={assetLogo(asset.assetId, assets)} className="size-7 text-[8px]" />
                <span>{assetLabel(asset.assetId, assets)}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">{asset.txCount.toLocaleString()} tx</span>
              </div>
            ))}
            {summary.assets.length > 4 && <span className="text-xs text-muted-foreground">+{summary.assets.length - 4} more assets</span>}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Transaction behavior">
        <div className="flex flex-wrap gap-1.5">
          {summary.transactionTypes.slice(0, 4).map((type) => (
            <Badge key={type.kind} variant="outline" className="text-[10px]">{type.kind.replaceAll("_", " ").toLowerCase()} · {type.count}</Badge>
          ))}
        </div>
      </PanelSection>

      <PanelSection title={edge.interactions.length > representatives.length ? "Representative transactions" : "Transactions"}>
        <ol className="-mx-1 flex flex-col">
          {representatives.map((it) => (
            <li key={it.signature} className="flex gap-2 rounded-md px-1 py-1.5 hover:bg-muted/50">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs tabular-nums">{formatUtc(it.time)} UTC</span>
                  <Badge variant="outline" className="text-[10px]">
                    {it.kind.replace("_", " ")}
                  </Badge>
                </div>
                {it.movements.map((m, i) => (
                  <div key={`${m.assetId}:${i}`} className="flex min-w-0 items-center gap-1 text-xs">
                    <span className="min-w-0 max-w-[40%] truncate">{name(m.from)}</span>
                    <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" aria-label="to" />
                    <span className="min-w-0 max-w-[40%] truncate">{name(m.to)}</span>
                    <span className="ml-auto shrink-0 tabular-nums">
                      {formatAmount(m.amount, m.assetId)} <span className="text-muted-foreground">{assetLabel(m.assetId, assets)}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex shrink-0 flex-col">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Show on timeline"
                  title="Show on timeline"
                  onClick={() => onShowOnTimeline(it.signature, it.wallet)}
                >
                  <ChartNoAxesGanttIcon />
                </Button>
                <a
                  href={`https://solscan.io/tx/${it.signature}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Open in explorer"
                  title="Open in explorer"
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ExternalLinkIcon className="size-3" />
                </a>
              </div>
            </li>
          ))}
        </ol>
        {edge.interactions.length > representatives.length && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => onViewAll(counterparty)}>
            View all {edge.interactions.length.toLocaleString()} transactions
          </Button>
        )}
      </PanelSection>
    </>
  );
}
