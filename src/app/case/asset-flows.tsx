"use client";

import { Tooltip } from "@base-ui/react/tooltip";
import { ArrowDownLeftIcon, ArrowUpRightIcon, LayoutGridIcon, ListIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type Assets, assetLabel, assetLogo } from "./asset-format";
import { AssetIcon } from "./asset-icon";
import { PanelSection, ShowMoreList } from "./panel";

/** What moved of one asset, in base units, from the inspected side. */
export type AssetFlow = { assetId: string; received: string; sent: string; txCount: number };

/** Inspector "Assets" section: per-asset received/sent, as a list or a grid of token icons with hover details. */
export function AssetFlows({ flows, assets, formatAmount }: {
  flows: AssetFlow[];
  assets: Assets;
  /** Base units → display amount for an asset. */
  formatAmount: (amount: string, assetId: string) => string;
}) {
  const [view, setView] = useState<"list" | "icons">("list");
  return (
    <PanelSection
      title="Assets"
      collapsible
      action={
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Asset view">
          <Button size="icon-xs" variant={view === "list" ? "secondary" : "ghost"} aria-label="List" aria-pressed={view === "list"} onClick={() => setView("list")}>
            <ListIcon />
          </Button>
          <Button size="icon-xs" variant={view === "icons" ? "secondary" : "ghost"} aria-label="Icons" aria-pressed={view === "icons"} onClick={() => setView("icons")}>
            <LayoutGridIcon />
          </Button>
        </div>
      }
    >
      <ShowMoreList items={flows} limit={view === "list" ? 4 : 32}>
        {(visible) =>
          view === "icons" ? (
            <Tooltip.Provider delay={100}>
              <div className="flex flex-wrap gap-1.5">
                {visible.map((flow) => {
                  const label = assetLabel(flow.assetId, assets);
                  return (
                    <Tooltip.Root key={flow.assetId}>
                      <Tooltip.Trigger className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={label}>
                        <AssetIcon label={label} logo={assetLogo(flow.assetId, assets)} className="size-7 text-[8px]" />
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Positioner sideOffset={6} className="z-50">
                          <Tooltip.Popup className="flex flex-col gap-0.5 rounded-md border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-md">
                            <span className="font-medium">{label}</span>
                            <span className="tabular-nums text-emerald-500">
                              <ArrowDownLeftIcon className="mr-0.5 inline size-3" aria-label="received" />
                              {formatAmount(flow.received, flow.assetId)}
                            </span>
                            <span className="tabular-nums text-destructive">
                              <ArrowUpRightIcon className="mr-0.5 inline size-3" aria-label="sent" />
                              {formatAmount(flow.sent, flow.assetId)}
                            </span>
                            <span className="tabular-nums text-muted-foreground">{flow.txCount.toLocaleString()} tx</span>
                          </Tooltip.Popup>
                        </Tooltip.Positioner>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  );
                })}
              </div>
            </Tooltip.Provider>
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map((flow) => {
                const received = formatAmount(flow.received, flow.assetId);
                const sent = formatAmount(flow.sent, flow.assetId);
                return (
                  <div key={flow.assetId} className="flex items-center gap-2 text-xs" title={`${received} received · ${sent} sent`}>
                    <AssetIcon label={assetLabel(flow.assetId, assets)} logo={assetLogo(flow.assetId, assets)} className="size-7 text-[8px]" />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate" title={flow.assetId}>
                        {assetLabel(flow.assetId, assets)}
                      </span>
                      <span className="flex gap-2 text-[11px] tabular-nums">
                        <span className="min-w-0 truncate text-emerald-500">
                          <ArrowDownLeftIcon className="mr-0.5 inline size-3" aria-label="received" />
                          {received}
                        </span>
                        <span className="min-w-0 truncate text-destructive">
                          <ArrowUpRightIcon className="mr-0.5 inline size-3" aria-label="sent" />
                          {sent}
                        </span>
                      </span>
                    </div>
                    <span className="ml-auto shrink-0 self-start tabular-nums text-muted-foreground">{flow.txCount.toLocaleString()} tx</span>
                  </div>
                );
              })}
            </div>
          )
        }
      </ShowMoreList>
    </PanelSection>
  );
}
