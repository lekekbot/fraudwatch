"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, MaximizeIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import { shortenAddress } from "@/lib/solana/address";
import type { WalletState } from "@/lib/state/reconstruct";
import { type EffectSummary, summarizeEffect } from "@/lib/state/summarize";
import { eventAtOrAfter, eventTimes, type SpacingMode, stepEvent } from "@/lib/timeline/layout";
import { type Assets, assetLabel, formatAssetAmount } from "../asset-format";
import { type TimelineHandle, type TimelineItem, TimelineCanvas } from "./timeline-canvas";
import { TimelineMinimap } from "./timeline-minimap";
import { TransactionDetails } from "./transaction-details";

const cardDate = (ms: number) => {
  const d = new Date(ms);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${date} · ${d.toISOString().slice(11, 16)}`;
};

function headline(summary: EffectSummary, state: WalletState, assets: Assets): string {
  const show = (c: { assetId: string; delta: string }) =>
    `${formatAssetAmount(c.delta, c.assetId, state, assets, true)} ${assetLabel(c.assetId, assets)}`;
  if (summary.kind === "SWAP") return `${show(summary.outflows[0])} → ${show(summary.inflows[0])}`;
  const main = summary.kind === "RECEIVE" ? summary.inflows[0] : summary.outflows[0];
  if (main) return show(main);
  return summary.kind === "FAILED" ? "No balance change" : "Fee only";
}

export function WalletTimeline({
  state,
  transactions,
  range,
  assets,
  labels,
}: {
  state: WalletState;
  transactions: Map<string, CanonicalTransaction>;
  range: { start: string; end: string };
  assets: Assets;
  labels: Record<string, string>;
}) {
  const timeline = useRef<TimelineHandle>(null);
  const [mode, setMode] = useState<SpacingMode>("time");
  const [selected, setSelected] = useState<number | null>(null);
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
          lines: [cardDate(times[i]), s.kind, headline(s, state, assets), cp ? `${arrow} ${labels[cp.address] ?? shortenAddress(cp.address, 3)}` : ""],
        };
      }),
    [state, summaries, times, assets, labels],
  );

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

  if (items.length === 0) return <p className="text-sm text-muted-foreground">No transactions to map in this range.</p>;

  const current = selected !== null ? state.effects[selected] : null;

  return (
    <div
      className="flex flex-col gap-3 outline-none"
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Spacing">
          {(["time", "event"] as const).map((m) => (
            <Button key={m} size="xs" variant={mode === m ? "secondary" : "ghost"} onClick={() => setMode(m)} aria-pressed={mode === m}>
              {m === "time" ? "Time spacing" : "Event spacing"}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Zoom out" onClick={() => timeline.current?.zoomBy(1 / 1.6)}>
            <MinusIcon />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Zoom in" onClick={() => timeline.current?.zoomBy(1.6)}>
            <PlusIcon />
          </Button>
          <Button variant="outline" size="sm" onClick={() => timeline.current?.fit()}>
            <MaximizeIcon />
            Fit range
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelected(null);
              setMode("time");
              timeline.current?.fit();
            }}
          >
            <RotateCcwIcon />
            Reset
          </Button>
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Previous transaction" onClick={() => step(-1)}>
            <ChevronLeftIcon />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next transaction" onClick={() => step(1)}>
            <ChevronRightIcon />
          </Button>
        </div>
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
          <Button type="submit" variant="outline" size="sm" disabled={!jumpDate}>
            Jump
          </Button>
        </form>
      </div>

      <div className={current ? "grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]" : ""}>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="overflow-hidden rounded-lg border">
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
          </div>
          <TimelineMinimap
            times={times}
            range={bounds}
            view={view}
            onNavigate={(time) => {
              const span = view ? view.end - view.start : bounds.end - bounds.start;
              timeline.current?.showTimeRange(time - span / 2, time + span / 2, false);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Scroll to zoom, drag to pan, click a cluster to open it. ← and → step between transactions.
          </p>
        </div>
        {current && selected !== null && (
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
          />
        )}
      </div>
    </div>
  );
}
