"use client";

import { ArrowDownLeftIcon, ArrowUpRightIcon, ChartNoAxesGanttIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BURNED_NODE_ID, entityProtocol, startedBy, type GraphEdge } from "@/lib/graph/build";
import type { Names } from "@/lib/labels/labels";
import { type Assets, assetLabel, formatUtc } from "../asset-format";
import { AssetFlows } from "../asset-flows";
import { PanelSection } from "../panel";
import { kindLabel } from "../filter-panel";

const NFT_RELATED_LABEL = {
  royalty: "Royalty",
  rent: "Rent",
  marketplace_fee: "Marketplace fee",
  unidentified: "Other recipient",
  escrow: "Escrow",
} as const;

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
  onOpenInTimeline,
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
  /** The Timeline, narrowed to exactly this connection's transactions. */
  onOpenInTimeline: () => void;
  onClose: () => void;
}) {
  const name = (address: string) =>
    address === BURNED_NODE_ID ? (
      <span className="min-w-0 truncate">Burned</span>
    ) : (
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
  const summary = edge.summary;
  // Name the sender first when value only went one way.
  const [from, to] = summary.bToA > 0 && summary.aToB === 0 ? [edge.b, edge.a] : [edge.a, edge.b];
  const oneWay = !program && (summary.aToB === 0) !== (summary.bToA === 0);
  // The panel reads from the focused wallet's side; when the focus isn't an endpoint, side with edge.b.
  const you = focusWallet === edge.a ? edge.a : edge.b;
  const counterparty = edge.a === focusWallet ? edge.b : edge.a;
  const sent = focusWallet === edge.a ? summary.aToB : summary.bToA;
  const received = focusWallet === edge.a ? summary.bToA : summary.aToB;
  const direction = sent === 0 ? "Incoming only" : received === 0 ? "Outgoing only" : sent >= received * 1.5 ? "Mostly outbound" : received >= sent * 1.5 ? "Mostly inbound" : "Reciprocal";
  const representatives = edge.interactions.length <= 6 ? edge.interactions : [edge.interactions[0], ...edge.interactions.slice(-3)];

  return (
    <>
      <PanelSection
        title={program ? "Program connection" : "Wallet interaction"}
        collapsible
        action={
          <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
            <XIcon />
          </Button>
        }
      >
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          {name(from)}
          <span className="shrink-0 text-muted-foreground" aria-label={oneWay ? "sent to" : "interacted with"}>
            {oneWay ? "→" : "↔"}
          </span>
          {name(to)}
        </div>
        {program && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {summary.totalInteractions.toLocaleString()} interactions. This relationship consists of program calls.
          </p>
        )}
      </PanelSection>

      {!program && (
        <PanelSection title="Relationship" collapsible>
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
            {/* Types add something only when they're mixed; a single type is already the direction. */}
            {summary.transactionTypes.length > 1 &&
              summary.transactionTypes.slice(0, 4).map((type) => (
                <Badge key={type.kind} variant="outline">{kindLabel(type.kind)} · {type.count}</Badge>
              ))}
          </div>
          {/* Who made the first move: each side's approved (signed) transactions, and any signed by someone else. */}
          <p className="text-xs text-muted-foreground">{startedBy(edge, names)}</p>
        </PanelSection>
      )}

      {summary.assets.length > 0 && (
        <AssetFlows
          // Totals each way, from the focused wallet's side like the Sent/Received cards above.
          flows={summary.assets.map((asset) => ({
            assetId: asset.assetId,
            received: focusWallet === edge.a ? asset.bToA : asset.aToB,
            sent: focusWallet === edge.a ? asset.aToB : asset.bToA,
            txCount: asset.txCount,
          }))}
          assets={assets}
          formatAmount={formatAmount}
        />
      )}

      <PanelSection
        title={edge.interactions.length > representatives.length ? "Representative transactions" : "Transactions"}
        collapsible
      >
        <ol className="-mx-1 flex flex-col">
          {representatives.map((it) => (
            <li key={it.signature} className="flex gap-2 rounded-md px-1 py-1.5 hover:bg-muted/50">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs tabular-nums">{formatUtc(it.time)} UTC</span>
                  <Badge variant="outline" className="text-[10px]">
                    {kindLabel(it.kind)}
                  </Badge>
                </div>
                {it.initiator !== edge.a && it.initiator !== edge.b && (
                  <span className="text-xs text-amber-500">
                    Signed by {name(it.initiator)}, not either side
                  </span>
                )}
                {it.movements.map((m, i) => {
                  // The pair is named in the header; a colored arrow is all a movement line needs.
                  const outgoing = m.from === you;
                  return (
                    <div key={`${m.assetId}:${i}`} className="flex min-w-0 items-center gap-1.5 text-xs">
                      {outgoing ? (
                        <ArrowUpRightIcon className="size-3.5 shrink-0 text-destructive" aria-label="sent" />
                      ) : (
                        <ArrowDownLeftIcon className="size-3.5 shrink-0 text-emerald-500" aria-label="received" />
                      )}
                      <span className="min-w-0 truncate tabular-nums" title={`${names.of(m.from)} → ${names.of(m.to)}`}>
                        {formatAmount(m.amount, m.assetId)} <span className="text-muted-foreground">{assetLabel(m.assetId, assets)}</span>
                      </span>
                      {/* A service's line keeps the real address each movement went through. */}
                      {m.via && <span className="flex min-w-0 gap-1 text-muted-foreground">via {name(m.via)}</span>}
                    </div>
                  );
                })}
                {it.nftRelated && it.nftRelated.length > 0 && (
                  <div className="mt-0.5 flex flex-col gap-1 rounded-md bg-muted/50 p-2">
                    <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                      {it.kind === "NFT_BUY" ? "NFT purchase breakdown" : "NFT trade breakdown"}
                    </span>
                    {it.nftRelated.map((m, i) => {
                      const outgoing = m.from === you;
                      const other = outgoing ? m.to : m.from;
                      return (
                        <div key={`${m.assetId}:${m.from}:${m.to}:${i}`} className="flex min-w-0 items-center gap-1.5 text-xs">
                          {outgoing ? (
                            <ArrowUpRightIcon className="size-3.5 shrink-0 text-destructive" aria-label="sent" />
                          ) : (
                            <ArrowDownLeftIcon className="size-3.5 shrink-0 text-emerald-500" aria-label="received" />
                          )}
                          <span className="shrink-0 tabular-nums">
                            {formatAmount(m.amount, m.assetId)} <span className="text-muted-foreground">{assetLabel(m.assetId, assets)}</span>
                          </span>
                          <span className="text-muted-foreground">· {NFT_RELATED_LABEL[m.role]}</span>
                          <span className="min-w-0">{name(other)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
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
        {counterparty !== BURNED_NODE_ID && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={onOpenInTimeline}>
              Open in Timeline
            </Button>
            {/* The table lists one address's transactions; a service has several, so it opens on the Timeline only. */}
            {edge.interactions.length > representatives.length && !entityProtocol(counterparty) && (
              <Button variant="outline" size="sm" className="flex-1" onClick={() => onViewAll(counterparty)}>
                View all {edge.interactions.length.toLocaleString()}
              </Button>
            )}
          </div>
        )}
      </PanelSection>
    </>
  );
}
