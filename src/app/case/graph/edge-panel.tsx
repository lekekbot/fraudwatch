"use client";

import { ArrowRightIcon, ChartNoAxesGanttIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { edgeFlow, type GraphEdge } from "@/lib/graph/build";
import type { Names } from "@/lib/labels/labels";
import { type Assets, assetLabel, formatUtc } from "../asset-format";
import { PanelSection } from "../panel";

/**
 * Inspector for one connection: the wallet pair, then every underlying
 * transaction in time order, each with its real direction, token and amount.
 */
export function EdgePanel({
  edge,
  names,
  assets,
  formatAmount,
  onSelectAddress,
  onShowOnTimeline,
  onClose,
}: {
  edge: GraphEdge;
  names: Names;
  assets: Assets;
  /** Base units → display amount for an asset. */
  formatAmount: (amount: string, assetId: string) => string;
  onSelectAddress: (address: string) => void;
  onShowOnTimeline: (signature: string, wallet: string) => void;
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
  const times = edge.interactions.map((it) => it.time).filter((t): t is number => t !== null);
  const program = edge.kind === "program";
  const flow = edgeFlow(edge);

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
        <p className="text-xs text-muted-foreground">
          {edge.interactions.length.toLocaleString()} {program ? "program call" : "transaction"}
          {edge.interactions.length === 1 ? "" : "s"}
          {times.length > 0 && (
            <>
              {" "}
              · {formatUtc(Math.min(...times)).slice(0, 10)}
              {Math.max(...times) !== Math.min(...times) && ` → ${formatUtc(Math.max(...times)).slice(0, 10)}`}
            </>
          )}
        </p>
        {!program && (
          <p className="text-xs text-muted-foreground">Every transaction between the two, in either direction. Amounts are what moved between them.</p>
        )}
      </PanelSection>

      <PanelSection title="Transactions">
        <ol className="-mx-1 flex flex-col">
          {edge.interactions.map((it) => (
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
      </PanelSection>
    </>
  );
}
