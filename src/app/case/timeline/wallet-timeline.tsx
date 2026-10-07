"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CircleHelpIcon, MaximizeIcon, MinusIcon, PlusIcon, RotateCcwIcon, StarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { Names } from "@/lib/labels/labels";
import type { BehaviorObservation } from "@/lib/behavior/observations";
import type { SemanticEvent } from "@/lib/semantic/events";
import type { WalletState } from "@/lib/state/reconstruct";
import type { EffectSummary } from "@/lib/state/summarize";
import { eventAtOrAfter, eventTimes, minimapTarget, type SpacingMode, stepEvent } from "@/lib/timeline/layout";
import { mergeLaneEvents } from "@/lib/timeline/lanes";
import { buildRelationships } from "@/lib/timeline/relationships";
import { type Assets, formatAssetAmount } from "../asset-format";
import { SidePanel } from "../panel";
import { type TimelineHandle, type TimelineItem, type TimelineLane, type TimelineObservation, type TimelineSelection, TimelineCanvas } from "./timeline-canvas";
import { TimelineMinimap } from "./timeline-minimap";
import { RelationshipChart, type RelationshipChartHandle } from "./relationship-chart";
import { eventCard } from "./event-card";
import { BEHAVIOR_LABEL, ObservationDetails } from "./observation-details";
import { TransactionDetails } from "./transaction-details";

/** One mapped wallet's lane: its (filtered) effects and summaries, and where its history starts. */
export type WalletLane = {
  wallet: string;
  state: WalletState;
  /** One per `state.effects` entry, NFT-aware; computed by the workspace. */
  summaries: EffectSummary[];
  range: { start: string; end: string };
  label: string;
  sublabel?: string;
  /** Mapped from this wallet at its first interaction. */
  forkFrom?: { wallet: string; time: string };
};

export type WalletTimelineHandle = {
  /** Select and centre a transaction, on `wallet`'s lane if it's there. False if it isn't shown. */
  jumpTo: (signature: string, wallet?: string) => boolean;
  /** Centre the view on a moment, keeping the zoom. */
  showTime: (time: number) => void;
  /** Deselect, so the inspector can show something else picked elsewhere (e.g. a wallet). */
  clearSelection: () => void;
};

/**
 * The case's chronological mapper: one lane per mapped wallet, one semantic
 * event per transaction however many lanes it touches, each lane showing its
 * own side of it. A single wallet is one lane.
 */
export function WalletTimeline({
  lanes,
  transactions,
  events: semanticEvents,
  observations,
  range,
  assets,
  names,
  inspector,
  addressPanel,
  inspectorOpen,
  emptyMessage = "No transactions to map in this range.",
  initialSignature,
  onHide,
  onSelectAddress,
  onSelectLane,
  sharedWith,
  isBookmarked,
  onToggleBookmark,
  onBookmarkTime,
  initialTime,
  onSelectTransaction,
  onShowInGraph,
  onDateRangeChange,
  overviewTimes,
  ref,
}: {
  ref?: React.Ref<WalletTimelineHandle>;
  lanes: WalletLane[];
  transactions: Map<string, CanonicalTransaction>;
  /** The semantic event of every loaded transaction, interpreted once by the workspace. */
  events: ReadonlyMap<string, SemanticEvent>;
  /** Behaviour patterns across each mapped wallet's events, detected once by the workspace. */
  observations: readonly BehaviorObservation[];
  /** The case range: the x axis. */
  range: { start: string; end: string };
  assets: Assets;
  names: Names;
  /** Right-panel content while no transaction is selected. */
  inspector: React.ReactNode;
  /** An address opened from the details; shown over them until dismissed. */
  addressPanel: React.ReactNode;
  onSelectAddress: (address: string) => void;
  /** A lane's name was clicked: show that wallet in the inspector. */
  onSelectLane: (wallet: string) => void;
  /** Selecting a transaction opens the right panel even when it's hidden. */
  inspectorOpen: boolean;
  emptyMessage?: string;
  /** Open on this transaction, selected and centred (e.g. "Show on timeline" from the graph). */
  initialSignature?: string;
  /** Leaves a transaction off the map. */
  onHide: (signature: string) => void;
  /** Other mapped wallets that also have this transaction, seen from `wallet`. */
  sharedWith: (signature: string, wallet: string) => string[];
  isBookmarked: (signature: string) => boolean;
  onToggleBookmark: (signature: string, wallet: string) => void;
  /** Bookmark a moment: the centre of the current view. */
  onBookmarkTime: (time: number) => void;
  /** Open centred on this moment (a date bookmark), keeping the default zoom. */
  initialTime?: number;
  /** A transaction was selected; the inspector should show it over any open address. */
  onSelectTransaction: () => void;
  /** Show the wallets in one event on the Graph. */
  onShowInGraph: (signature: string) => void;
  /** A minimap brush becomes the case's date filter, for every view; resetting the view clears it. */
  onDateRangeChange: (range: { start: number; end: number } | null) => void;
  /** What the minimap draws: activity through every filter but the date range, so it still shows the whole case. */
  overviewTimes?: readonly number[];
}) {
  const timeline = useRef<TimelineHandle>(null);
  const [mode, setMode] = useState<SpacingMode>("time");
  /** Transactions on wallet lanes, or relationships between addresses as bands over time. */
  const [chart, setChart] = useState<"lanes" | "relationships">("lanes");
  const relationshipChart = useRef<RelationshipChartHandle>(null);
  // Tracked by signature and wallet so the selection survives filtering and lane changes.
  const [selection, setSelection] = useState<{ signature: string; wallet: string | null } | null>(
    initialSignature ? { signature: initialSignature, wallet: null } : null,
  );
  const [view, setView] = useState<{ start: number; end: number } | null>(null);
  /** An open behaviour observation; it and a transaction are never selected at once. */
  const [observationId, setObservationId] = useState<string | null>(null);
  /** Observations starting at the same moment as the open one, offered alongside it. */
  const [together, setTogether] = useState<string[]>([]);
  const [showBehavior, setShowBehavior] = useState(true);
  const [jumpDate, setJumpDate] = useState("");

  const bounds = useMemo(() => ({ start: Date.parse(range.start), end: Date.parse(range.end) }), [range.start, range.end]);
  const events = useMemo(
    () =>
      mergeLaneEvents(
        lanes.map((lane) => {
          const times = eventTimes(lane.state.effects.map((e) => e.timestamp), Date.parse(lane.range.start));
          return lane.state.effects.map((e, effectIndex) => ({ signature: e.signature, time: times[effectIndex], effectIndex }));
        }),
      ),
    [lanes],
  );
  const items = useMemo<TimelineItem[]>(
    () =>
      events.map((ev) => ({
        signature: ev.signature,
        time: ev.time,
        entries: ev.entries.map(({ lane, effectIndex }) => {
          const { wallet, state, summaries } = lanes[lane];
          const event = semanticEvents.get(ev.signature);
          // Every loaded transaction has an event; one that somehow doesn't still shows, as unknown.
          if (!event) return { lane, tone: "neutral" as const, label: "Unknown", flow: "none" as const, lines: ["", "UNKNOWN", "", ""] };
          const { tone, label, flow, lines } = eventCard(event, wallet, ev.time, state, summaries[effectIndex], assets, names);
          return { lane, tone, label, flow, lines };
        }),
      })),
    [events, lanes, semanticEvents, assets, names],
  );
  const relationships = useMemo(
    () =>
      chart === "relationships"
        ? buildRelationships(
            lanes.map((lane) => ({
              wallet: lane.wallet,
              signatures: lane.state.effects.map((e) => e.signature),
              times: eventTimes(lane.state.effects.map((e) => e.timestamp), Date.parse(lane.range.start)),
              summaries: lane.summaries,
            })),
          )
        : [],
    [chart, lanes],
  );
  const canvasLanes = useMemo<TimelineLane[]>(() => {
    const index = new Map(lanes.map((l, i) => [l.wallet, i]));
    return lanes.map((l) => ({
      label: l.label,
      sublabel: l.sublabel,
      start: Date.parse(l.range.start),
      end: Date.parse(l.range.end),
      ...(l.forkFrom && index.has(l.forkFrom.wallet)
        ? { fork: { fromLane: index.get(l.forkFrom.wallet)!, time: Date.parse(l.forkFrom.time) } }
        : {}),
    }));
  }, [lanes]);
  const times = useMemo(() => items.map((i) => i.time), [items]);
  // Observations on the shown lanes that still have one of their events in view.
  const laneObservations = useMemo<TimelineObservation[]>(() => {
    const laneOf = new Map(lanes.map((l, i) => [l.wallet, i]));
    const shown = lanes.map((l) => new Set(l.state.effects.map((e) => e.signature)));
    return observations.flatMap((o) => {
      const lane = laneOf.get(o.wallet);
      if (lane === undefined || !o.events.some((e) => shown[lane].has(e.signature))) return [];
      return [{ key: o.id, lane, start: o.start, end: o.end, label: BEHAVIOR_LABEL[o.type] }];
    });
  }, [observations, lanes]);
  const openObservation = observationId ? observations.find((o) => o.id === observationId) : undefined;
  const observationBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of laneObservations) counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([label, n]) => `${n} ${label.toLowerCase()}`).join(" · ");
  }, [laneObservations]);

  /** A transaction's index in `items` (-1 if it isn't shown), and its lane on `wallet` if it's on one. */
  const at = (signature: string, wallet?: string | null) => {
    const index = items.findIndex((i) => i.signature === signature);
    return { index, lane: items[index]?.entries.find((e) => lanes[e.lane].wallet === wallet)?.lane };
  };
  const { index: selectedIndex, lane: selectedLane } = selection ? at(selection.signature, selection.wallet) : { index: -1, lane: undefined };
  const selected: TimelineSelection | null = selectedIndex === -1 ? null : { index: selectedIndex, lane: selectedLane ?? items[selectedIndex].entries[0].lane };
  const setSelected = (index: number | null, lane?: number) => {
    setObservationId(null);
    if (index === null || !items[index]) return setSelection(null);
    // The inspector shows the last thing selected: this transaction now.
    onSelectTransaction();
    const entries = items[index].entries;
    // Stay on the current wallet's lane when stepping, if the transaction is on it.
    const keep = lane ?? entries.find((e) => lanes[e.lane].wallet === selection?.wallet)?.lane ?? entries[0].lane;
    setSelection({ signature: items[index].signature, wallet: lanes[keep].wallet });
  };

  // Selection to centre once the canvas has switched spacing mode.
  const pending = useRef<{ index: number; lane: number } | null>(null);

  const sharesTimestamp = (index: number) =>
    times.some((t, i) => i !== index && Math.abs(t - times[index]) < 1000);

  const select = (index: number | null, lane?: number) => {
    setSelected(index, lane);
    if (index === null) return;
    const targetLane = lane ?? items[index].entries[0].lane;
    if (mode === "time" && sharesTimestamp(index)) {
      pending.current = { index, lane: targetLane };
      setMode("event");
    } else timeline.current?.centerOn(index, targetLane);
  };

  useEffect(() => {
    if (pending.current === null) return;
    timeline.current?.centerOn(pending.current.index, pending.current.lane);
    pending.current = null;
  }, [mode]);

  // Opened on a transaction: it starts selected; centre it once the canvas (a child, so its effects ran first) is set up.
  useEffect(() => {
    if (selected !== null && initialSignature) timeline.current?.centerOn(selected.index, selected.lane);
    else if (initialTime !== undefined) {
      // A date bookmark: show a week around it.
      timeline.current?.showTimeRange(initialTime - 3.5 * 86_400_000, initialTime + 3.5 * 86_400_000, false);
    }
    // Once, on mount: later selection belongs to the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const step = (direction: 1 | -1) => select(stepEvent(items.length, selected?.index ?? null, direction));
  /** Centre the view on a moment, keeping the span shown. */
  const centreOn = (time: number) => {
    const span = view ? view.end - view.start : bounds.end - bounds.start;
    timeline.current?.showTimeRange(time - span / 2, time + span / 2, false);
  };

  useImperativeHandle(ref, () => ({
    jumpTo: (signature, wallet) => {
      const { index, lane } = at(signature, wallet);
      if (index === -1) return false;
      select(index, lane);
      return true;
    },
    clearSelection: () => {
      setSelection(null);
      setObservationId(null);
    },
    showTime: centreOn,
  }));

  const currentLane = selected ? lanes[selected.lane] : null;
  const currentEntry = selected ? events[selected.index].entries.find((e) => e.lane === selected.lane) : undefined;
  const current = currentLane && currentEntry ? currentLane.state.effects[currentEntry.effectIndex] : null;

  const panel = (inspectorOpen || current || addressPanel || openObservation) && (
    <SidePanel side="right" label="Inspector">
      {addressPanel ? (
        addressPanel
      ) : openObservation ? (
        <ObservationDetails
          observation={openObservation}
          events={semanticEvents}
          format={(amount, assetId) => {
            const lane = lanes.find((l) => l.wallet === openObservation.wallet);
            return lane ? formatAssetAmount(amount, assetId, lane.state, assets) : amount;
          }}
          assets={assets}
          names={names}
          onSelectAddress={onSelectAddress}
          onSelectEvent={(signature) => {
            const { index, lane } = at(signature, openObservation.wallet);
            if (index !== -1) select(index, lane);
          }}
          onClose={() => setObservationId(null)}
          together={observations.filter((o) => together.includes(o.id) && o.id !== openObservation.id)}
          onSelectObservation={setObservationId}
        />
      ) : current && selected && currentLane && currentEntry ? (
        <TransactionDetails
          effect={current}
          summary={currentLane.summaries[currentEntry.effectIndex]}
          event={semanticEvents.get(current.signature)}
          wallet={currentLane.wallet}
          tx={transactions.get(current.signature)}
          state={currentLane.state}
          assets={assets}
          position={{ index: selected.index, count: items.length }}
          onPrevious={() => step(-1)}
          onNext={() => step(1)}
          onClose={() => setSelected(null)}
          onHide={() => {
            // Move on to a neighbour so stepping through the timeline isn't interrupted.
            const next = items[selected.index + 1] ?? items[selected.index - 1];
            setSelection(next ? { signature: next.signature, wallet: selection?.wallet ?? null } : null);
            onHide(current.signature);
          }}
          names={names}
          onSelectAddress={onSelectAddress}
          sharedWith={sharedWith(current.signature, currentLane.wallet)}
          walletName={lanes.length > 1 ? currentLane.label : undefined}
          bookmarked={isBookmarked(current.signature)}
          onToggleBookmark={() => onToggleBookmark(current.signature, currentLane.wallet)}
          onShowInGraph={() => onShowInGraph(current.signature)}
          observations={observations.filter((o) => o.events.some((e) => e.signature === current.signature))}
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
        <div className="relative min-h-0 flex-1">
          {/* Lanes scroll vertically when they don't fit; the toolbar floats above them. */}
          {chart === "relationships" && (
            <div className="absolute inset-0">
              <RelationshipChart
                ref={relationshipChart}
                relationships={relationships}
                range={bounds}
                names={names}
                onPick={(signature, wallet) => {
                  const { index, lane } = at(signature, wallet);
                  if (index !== -1) setSelected(index, lane);
                }}
              />
            </div>
          )}
          <div className={chart === "relationships" ? "hidden" : "absolute inset-0 overflow-x-hidden overflow-y-auto"}>
            <TimelineCanvas
              ref={timeline}
              items={items}
              observations={showBehavior ? laneObservations : []}
              selectedObservation={observationId}
              onSelectObservation={(key, keys) => {
                // The inspector shows the last thing picked: this observation now.
                onSelectTransaction();
                setSelection(null);
                setObservationId(key);
                setTogether(keys);
              }}
              lanes={canvasLanes}
              range={bounds}
              mode={mode}
              selected={selected}
              onSelect={select}
              onSelectLane={(lane) => {
                // A lane name is a pick too: show that wallet, not the last transaction.
                setSelection(null);
                onSelectLane(lanes[lane].wallet);
              }}
              onNeedsEventSpacing={(index, lane) => {
                pending.current = { index, lane };
                setSelected(index, lane);
                setMode("event");
              }}
              onViewChange={(start, end) =>
                setView((v) => (v && Math.abs(v.start - start) < 1 && Math.abs(v.end - end) < 1 ? v : { start, end }))
              }
            />
          </div>
          {/* Floating toolbar over the canvas. */}
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
            <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border bg-popover/95 p-1 shadow-lg backdrop-blur">
              <div className="flex" role="group" aria-label="Spacing">
                {(["time", "event"] as const).map((m) => (
                  <Button
                    key={m}
                    size="xs"
                    variant={chart === "lanes" && mode === m ? "secondary" : "ghost"}
                    onClick={() => {
                      setChart("lanes");
                      setMode(m);
                    }}
                    aria-pressed={chart === "lanes" && mode === m}
                  >
                    {m === "time" ? "Time" : "Events"}
                  </Button>
                ))}
                <Button
                  size="xs"
                  variant={chart === "relationships" ? "secondary" : "ghost"}
                  title="Who dealt with whom, over time: one band per relationship"
                  onClick={() => setChart("relationships")}
                  aria-pressed={chart === "relationships"}
                >
                  Relationships
                </Button>
              </div>
              <Button
                size="xs"
                variant={showBehavior && chart === "lanes" ? "secondary" : "ghost"}
                title={`Behaviour observations: patterns across events, read by fixed rules. Click to ${showBehavior ? "hide" : "show"} them.\n${observationBreakdown}`}
                aria-pressed={showBehavior}
                disabled={chart !== "lanes"}
                onClick={() => setShowBehavior((v) => !v)}
              >
                ◆ {laneObservations.length}
              </Button>
              <Divider />
              <Button variant="ghost" size="icon-sm" aria-label="Zoom out" title="Zoom out" onClick={() => (chart === "relationships" ? relationshipChart.current : timeline.current)?.zoomBy(1 / 1.6)}>
                <MinusIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Zoom in" title="Zoom in" onClick={() => (chart === "relationships" ? relationshipChart.current : timeline.current)?.zoomBy(1.6)}>
                <PlusIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Fit range" title="Fit range" onClick={() => (chart === "relationships" ? relationshipChart.current : timeline.current)?.fit()}>
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
                  onDateRangeChange(null);
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
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Bookmark this moment"
                title="Bookmark this moment (the centre of the view)"
                onClick={() => onBookmarkTime(view ? (view.start + view.end) / 2 : (bounds.start + bounds.end) / 2)}
              >
                <StarIcon />
              </Button>
              <span
                className="flex size-7 items-center justify-center text-muted-foreground"
                title="Scroll to zoom, drag to pan, click a cluster to open it. ← and → step between transactions."
              >
                <CircleHelpIcon className="size-4" aria-hidden />
              </span>
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t px-2 pt-2 pb-3">
          <TimelineMinimap
            times={overviewTimes ?? times}
            range={bounds}
            view={view}
            onNavigate={(time) => {
              // Zoomed out, a click zooms in around it; zoomed in, it re-centres.
              const target = minimapTarget(time, view, bounds);
              timeline.current?.showTimeRange(target.start, target.end, false);
            }}
            onPan={centreOn}
            onSelectRange={(start, end) => {
              onDateRangeChange({ start, end });
              timeline.current?.showTimeRange(start, end, false);
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
