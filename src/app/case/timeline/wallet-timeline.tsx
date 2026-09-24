"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CircleHelpIcon, MaximizeIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { Names } from "@/lib/labels/labels";
import type { WalletState } from "@/lib/state/reconstruct";
import { describeAction, type EffectSummary, summarizeEffect } from "@/lib/state/summarize";
import { eventAtOrAfter, eventTimes, type SpacingMode, stepEvent } from "@/lib/timeline/layout";
import { type Assets, assetLabel, formatAssetAmount } from "../asset-format";
import { SidePanel } from "../panel";
import { type TimelineHandle, type TimelineItem, TimelineCanvas } from "./timeline-canvas";
import { TimelineMinimap } from "./timeline-minimap";
import { TransactionDetails } from "./transaction-details";

const cardDate = (ms: number) => {
  const d = new Date(ms);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${date} · ${d.toISOString().slice(11, 16)}`;
};

function headline(summary: EffectSummary, state: WalletState, assets: Assets, names: Names): string {
  const show = (c: { assetId: string; delta: string }) =>
    `${formatAssetAmount(c.delta, c.assetId, state, assets, true)} ${assetLabel(c.assetId, assets)}`;
  if (summary.kind === "SWAP") return `${show(summary.outflows[0])} → ${show(summary.inflows[0])}`;
  const main = summary.kind === "RECEIVE" ? summary.inflows[0] : summary.outflows[0];
  if (main) return show(main);
  return summary.kind === "FAILED" ? "No balance change" : describeAction(summary.action, summary.action ? names.known(summary.action.programId) : undefined);
}

export function WalletTimeline({
  state,
  transactions,
  range,
  assets,
  names,
  inspector,
  addressPanel,
  inspectorOpen,
  emptyMessage = "No transactions to map in this range.",
  onHide,
  onSelectAddress,
}: {
  state: WalletState;
  transactions: Map<string, CanonicalTransaction>;
  range: { start: string; end: string };
  assets: Assets;
  names: Names;
  /** Right-panel content while no transaction is selected. */
  inspector: React.ReactNode;
  /** An address opened from the details; shown over them until dismissed. */
  addressPanel: React.ReactNode;
  onSelectAddress: (address: string) => void;
  /** Selecting a transaction opens the right panel even when it's hidden. */
  inspectorOpen: boolean;
  emptyMessage?: string;
  /** Leaves a transaction off the map. */
  onHide: (signature: string) => void;
}) {
  const timeline = useRef<TimelineHandle>(null);
  const [mode, setMode] = useState<SpacingMode>("time");
  // Tracked by signature so the selection survives filtering.
  const [selectedSignature, setSelectedSignature] = useState<string | null>(null);
  const [view, setView] = useState<{ start: number; end: number } | null>(null);
  const [jumpDate, setJumpDate] = useState("");

  const bounds = useMemo(() => ({ start: Date.parse(range.start), end: Date.parse(range.end) }), [range.start, range.end]);
  const summaries = useMemo(
    () => state.effects.map((e) => summarizeEffect(e, transactions.get(e.signature))),
    [state, transactions],
  );
  const times = useMemo(() => eventTimes(state.effects.map((e) => e.timestamp), bounds.start), [state, bounds.start]);
  const items = useMemo<TimelineItem[]>(
    () =>
      state.effects.map((e, i) => {
        const s = summaries[i];
        const cp = s.counterparties[0];
        const arrow = s.kind === "RECEIVE" ? "←" : "→";
        return {
          signature: e.signature,
          time: times[i],
          kind: s.kind,
          lines: [
            cardDate(times[i]),
            s.kind,
            headline(s, state, assets, names),
            cp ? `${arrow} ${names.of(cp.address, 3)}` : s.actor ? `by ${names.of(s.actor, 3)}` : "",
          ],
        };
      }),
    [state, summaries, times, assets, names],
  );
  const selectedIndex = selectedSignature === null ? -1 : items.findIndex((i) => i.signature === selectedSignature);
  const selected = selectedIndex === -1 ? null : selectedIndex;
  const setSelected = (index: number | null) => setSelectedSignature(index === null ? null : (items[index]?.signature ?? null));

  // Selection to centre once the canvas has switched spacing mode.
  const pending = useRef<number | null>(null);

  const sharesTimestamp = (index: number) =>
    times.some((t, i) => i !== index && Math.abs(t - times[index]) < 1000);

  const select = (index: number | null) => {
    setSelected(index);
    if (index === null) return;
    if (mode === "time" && sharesTimestamp(index)) {
      pending.current = index;
      setMode("event");
    } else timeline.current?.centerOn(index);
  };

  useEffect(() => {
    if (pending.current === null) return;
    timeline.current?.centerOn(pending.current);
    pending.current = null;
  }, [mode]);
  const step = (direction: 1 | -1) => select(stepEvent(items.length, selected, direction));

  const current = selected !== null ? state.effects[selected] : null;

  const panel = (inspectorOpen || current || addressPanel) && (
    <SidePanel side="right" label="Inspector">
      {addressPanel ? (
        addressPanel
      ) : current && selected !== null ? (
        <TransactionDetails
          effect={current}
          summary={summaries[selected]}
          tx={transactions.get(current.signature)}
          state={state}
          assets={assets}
          position={{ index: selected, count: items.length }}
          onPrevious={() => step(-1)}
          onNext={() => step(1)}
          onClose={() => setSelected(null)}
          onHide={() => {
            // Move on to a neighbour so stepping through the timeline isn't interrupted.
            const next = items[selected + 1] ?? items[selected - 1];
            setSelectedSignature(next?.signature ?? null);
            onHide(current.signature);
          }}
          names={names}
          onSelectAddress={onSelectAddress}
        />
      ) : (
        inspector
      )}
    </SidePanel>
  );

  if (items.length === 0) {
    return (
      <>
        <div className="flex min-w-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
        {panel}
      </>
    );
  }

  return (
    <>
      <div
        className="flex min-w-0 flex-1 flex-col outline-none"
        tabIndex={0}
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).tagName === "INPUT") return;
          if (event.key === "ArrowRight") step(1);
          else if (event.key === "ArrowLeft") step(-1);
          else if (event.key === "Escape") setSelected(null);
          else return;
          event.preventDefault();
        }}
      >
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <TimelineCanvas
            ref={timeline}
            items={items}
            range={bounds}
            mode={mode}
            selected={selected}
            onSelect={select}
            onNeedsEventSpacing={(index) => {
              pending.current = index;
              setSelected(index);
              setMode("event");
            }}
            onViewChange={(start, end) =>
              setView((v) => (v && Math.abs(v.start - start) < 1 && Math.abs(v.end - end) < 1 ? v : { start, end }))
            }
          />
          {/* Floating toolbar over the canvas. */}
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
            <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border bg-popover/95 p-1 shadow-lg backdrop-blur">
              <div className="flex" role="group" aria-label="Spacing">
                {(["time", "event"] as const).map((m) => (
                  <Button key={m} size="xs" variant={mode === m ? "secondary" : "ghost"} onClick={() => setMode(m)} aria-pressed={mode === m}>
                    {m === "time" ? "Time" : "Events"}
                  </Button>
                ))}
              </div>
              <Divider />
              <Button variant="ghost" size="icon-sm" aria-label="Zoom out" title="Zoom out" onClick={() => timeline.current?.zoomBy(1 / 1.6)}>
                <MinusIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Zoom in" title="Zoom in" onClick={() => timeline.current?.zoomBy(1.6)}>
                <PlusIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Fit range" title="Fit range" onClick={() => timeline.current?.fit()}>
                <MaximizeIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Reset"
                title="Reset"
                onClick={() => {
                  setSelected(null);
                  setMode("time");
                  timeline.current?.fit();
                }}
              >
                <RotateCcwIcon />
              </Button>
              <Divider />
              <Button variant="ghost" size="icon-sm" aria-label="Previous transaction" title="Previous transaction (←)" onClick={() => step(-1)}>
                <ChevronLeftIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next transaction" title="Next transaction (→)" onClick={() => step(1)}>
                <ChevronRightIcon />
              </Button>
              <Divider />
              <form
                className="flex items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  const ms = Date.parse(`${jumpDate}T00:00:00Z`);
                  if (Number.isNaN(ms)) return;
                  select(eventAtOrAfter(times, ms));
                }}
              >
                <Input
                  type="date"
                  aria-label="Jump to date (UTC)"
                  className="h-7 w-36 text-xs"
                  value={jumpDate}
                  min={range.start.slice(0, 10)}
                  max={range.end.slice(0, 10)}
                  onChange={(event) => setJumpDate(event.target.value)}
                />
                <Button type="submit" variant="ghost" size="sm" disabled={!jumpDate}>
                  Jump
                </Button>
              </form>
              <span
                className="flex size-7 items-center justify-center text-muted-foreground"
                title="Scroll to zoom, drag to pan, click a cluster to open it. ← and → step between transactions."
              >
                <CircleHelpIcon className="size-4" aria-hidden />
              </span>
            </div>
          </div>
        </div>
        <div className="border-t p-2">
          <TimelineMinimap
            times={times}
            range={bounds}
            view={view}
            onNavigate={(time) => {
              const span = view ? view.end - view.start : bounds.end - bounds.start;
              timeline.current?.showTimeRange(time - span / 2, time + span / 2, false);
            }}
          />
        </div>
      </div>
      {panel}
    </>
  );
}

function Divider() {
  return <div className="mx-0.5 h-5 w-px bg-border" aria-hidden />;
}
