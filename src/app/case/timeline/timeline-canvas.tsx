"use client";

import { type ScaleLinear, type ScaleTime, scaleLinear, scaleUtc } from "d3-scale";
import { select } from "d3-selection";
import { type ZoomBehavior, type ZoomTransform, zoomIdentity } from "d3-zoom";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { connectors, type Flow, mergeConnectors, type Trunk } from "@/lib/timeline/lanes";
import { horizontalZoom, readPalette, sizeCanvas } from "../canvas";
import type { Tone } from "./event-card";
import {
  chooseBucket,
  fitTransform,
  type Group,
  groupEvents,
  mergeOverlapping,
  placeCards,
  type SpacingMode,
  splitByBucket,
} from "@/lib/timeline/layout";

/** One lane's view of a transaction's semantic event. */
export type LaneEntry = {
  lane: number;
  tone: Tone;
  /** What it was ("Swap", "NFT purchase"), for cluster breakdowns. */
  label: string;
  /** Card text, top to bottom: date, event type, amount, counterparty or protocol. */
  lines: string[];
  /** Which way value moved for this lane's wallet; orients connectors between lanes. */
  flow: Flow;
  /** Who or what the card's last line names; the same one seen again gets a chip. */
  party?: string;
};

/** One transaction, drawn once at one x, with an entry on every lane it touches. */
export type TimelineItem = { signature: string; time: number; entries: LaneEntry[] };

export type TimelineLane = {
  label: string;
  sublabel?: string;
  /** When this wallet's loaded history starts and ends (ms). */
  start: number;
  end: number;
  /** Mapped from another lane at its first interaction: drawn as a branch off that lane. */
  fork?: { fromLane: number; time: number };
};

export type TimelineSelection = { index: number; lane: number };

/** A behaviour observation drawn over a lane: a pattern across events, not an event itself. */
export type TimelineObservation = { key: string; lane: number; start: number; end: number; label: string };

export type TimelineHandle = {
  fit: () => void;
  zoomBy: (factor: number) => void;
  /** Centres a transaction, zooming until it stands on its own, and scrolls its lane into view. */
  centerOn: (index: number, lane?: number) => void;
  /** Show [start, end] in ms of case time, whatever the spacing mode. `padded` adds a margin around it. */
  showTimeRange: (start: number, end: number, padded?: boolean) => void;
};

type Props = {
  ref?: React.Ref<TimelineHandle>;
  items: TimelineItem[];
  observations?: TimelineObservation[];
  selectedObservation?: string | null;
  /** One observation picked; `together` lists any others that start at the same moment and can't be zoomed apart. */
  onSelectObservation?: (key: string, together: string[]) => void;
  lanes: TimelineLane[];
  range: { start: number; end: number };
  mode: SpacingMode;
  selected: TimelineSelection | null;
  onSelect: (index: number, lane: number) => void;
  onSelectLane: (lane: number) => void;
  /** Visible window in case time, for the minimap. */
  onViewChange: (start: number, end: number) => void;
  /** Events that share a timestamp can't be separated by time; the parent switches to event spacing. */
  onNeedsEventSpacing: (index: number, lane: number) => void;
};

/** Below this span, a time-spaced cluster can't be opened any further. */
const UNRESOLVABLE_MS = 1000;

/** Shortest the canvas gets: room for a card tier on each side of the lane plus the axis. */
const MIN_HEIGHT = 280;
const PAD = 28;
const CARD_W = 150;
const CARD_H = 64;
const CARD_GAP = 22;
const DOT_GAP = 12;
/** Connectors closer than this (px) between the same lanes merge into one arrow with a count. */
const CONNECTOR_MERGE = 40;
const PILL_GAP = 6;
/** Narrowest bucket a dense period is split into, in px; fits a two-line pill. */
const BUCKET_MIN = 84;
const PILL_H = 32;
/** Stacked lanes: room above the first for the floating toolbar, and each lane's band (a card tier, the lane, its label). */
const LANES_TOP = 60;
const LANE_BAND = CARD_GAP + CARD_H + 48;
const AXIS_SPACE = 44;

type Hit =
  | { type: "event"; x0: number; y0: number; x1: number; y1: number; first: number; last: number; lane: number; label?: string }
  | { type: "lane"; x0: number; y0: number; x1: number; y1: number; lane: number }
  | { type: "observation"; x0: number; y0: number; x1: number; y1: number; keys: string[]; start: number; end: number; label: string };

const PALETTE: Record<"fg" | "muted" | "border" | "card" | "bg" | "behavior" | "party1" | "party2" | "party3" | Tone, string> = {
  fg: "--foreground",
  muted: "--muted-foreground",
  border: "--border",
  card: "--card",
  bg: "--background",
  send: "--destructive",
  receive: "--tone-receive",
  swap: "--tone-swap",
  nft: "--tone-nft",
  defi: "--tone-defi",
  behavior: "--tone-behavior",
  bridge: "--tone-bridge",
  burn: "--tone-burn",
  approval: "--tone-approval",
  neutral: "--muted-foreground",
  failed: "--destructive",
  party1: "--party-1",
  party2: "--party-2",
  party3: "--party-3",
};

const formatUtc = (options: Intl.DateTimeFormatOptions) => {
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options });
  return (date: Date) => formatter.format(date);
};
const dayFormat = formatUtc({ day: "numeric", month: "short" });
const dayWithYear = formatUtc({ day: "numeric", month: "short", year: "numeric" });
const currentYear = new Date().getUTCFullYear();
/** Node label: the year only when it isn't this one, so current cases stay compact. */
const nodeDay = (date: Date) => (date.getUTCFullYear() === currentYear ? dayFormat(date) : dayWithYear(date));

/** Axis labels in 24-hour UTC, coarsest unit that the tick doesn't round to. */
const axisFormats = {
  second: (date: Date) => `:${date.getUTCSeconds().toString().padStart(2, "0")}`,
  minute: formatUtc({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  day: dayFormat,
  month: formatUtc({ month: "short", year: "numeric" }),
};
function axisLabel(date: Date): string {
  if (date.getUTCSeconds() !== 0) return axisFormats.second(date);
  if (date.getUTCMinutes() !== 0 || date.getUTCHours() !== 0) return axisFormats.minute(date);
  if (date.getUTCDate() !== 1) return axisFormats.day(date);
  return axisFormats.month(date);
}
const timeFormat = axisFormats.minute;
const contextDay = formatUtc({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
const contextYear = formatUtc({ year: "numeric" });

/**
 * Text widths by font and string. Pill labels ("12 tx", "3 Sep") repeat across
 * lanes and frames, so measuring each once keeps dense frames cheap.
 */
const widthCache = new Map<string, number>();
function textWidth(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  const key = `${font}|${text}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    if (widthCache.size > 20_000) widthCache.clear();
    ctx.font = font;
    w = ctx.measureText(text).width;
    widthCache.set(key, w);
  }
  return w;
}

/** `text` cut with an ellipsis to fit `max` px, found by binary search. */
function fitText(ctx: CanvasRenderingContext2D, font: string, text: string, max: number): string {
  if (textWidth(ctx, font, text) <= max) return text;
  let lo = 1;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(ctx, font, `${text.slice(0, mid)}…`) <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

/**
 * Wallet lanes on a canvas: one lane per mapped wallet, stacked. X is time (or
 * event order, shared by every lane); zoom stretches the axis instead of
 * magnifying cards, so dense periods open up as you zoom in. A transaction
 * several lanes share is drawn once at one x, joined across lanes.
 */
export function TimelineCanvas({ ref, items, lanes, range, mode, selected, onSelect, onSelectLane, onViewChange, onNeedsEventSpacing, observations, selectedObservation, onSelectObservation }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const widthRef = useRef(800);
  const heightRef = useRef(MIN_HEIGHT);
  /** Visible part of the canvas when lanes overflow and the container scrolls. */
  const viewportRef = useRef({ top: 0, height: MIN_HEIGHT });
  const hitsRef = useRef<Hit[]>([]);
  const frameRef = useRef<number | null>(null);
  const latest = useRef({ items, lanes, range, mode, selected, onViewChange, observations, selectedObservation });
  useLayoutEffect(() => {
    latest.current = { items, lanes, range, mode, selected, onViewChange, observations, selectedObservation };
  });

  const stacked = () => latest.current.lanes.length > 1;
  /** y of each lane's line. A single lane sits in the middle, with cards above and below. */
  const laneY = useCallback((lane: number) => {
    if (latest.current.lanes.length <= 1) return Math.round((heightRef.current - 18 - 14) / 2);
    return LANES_TOP + lane * LANE_BAND + CARD_GAP + CARD_H;
  }, []);
  const contentHeight = (laneCount: number) => (laneCount <= 1 ? MIN_HEIGHT : LANES_TOP + laneCount * LANE_BAND + AXIS_SPACE);

  /** Base (unzoomed) x for an item, in the current spacing mode. */
  const baseScale = useCallback(() => {
    const { items, range, mode } = latest.current;
    const width = widthRef.current;
    return mode === "time"
      ? scaleUtc().domain([range.start, range.end]).range([PAD, width - PAD])
      : scaleLinear().domain([-0.5, Math.max(0.5, items.length - 0.5)]).range([PAD, width - PAD]);
  }, []);

  const draw = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { items, lanes, range, mode, selected, observations = [], selectedObservation } = latest.current;
    const width = widthRef.current;
    const height = heightRef.current;
    const multi = lanes.length > 1;
    // The axis stays at the bottom of what's visible, even when the lanes scroll.
    const viewport = viewportRef.current;
    const axisY = multi ? viewport.top + viewport.height - 18 : height - 18;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const p = readPalette(canvas, PALETTE);

    const base = baseScale();
    const scale = transformRef.current.rescaleX(base);
    const xOf = (i: number) => (mode === "time" ? scale(items[i].time) : scale(i));
    const xs = items.map((_, i) => xOf(i));

    // Visible window in case time, for the minimap.
    if (mode === "time") {
      const s = scale as ScaleTime<number, number>;
      latest.current.onViewChange(+s.invert(PAD), +s.invert(width - PAD));
    } else if (items.length > 0) {
      const s = scale as ScaleLinear<number, number>;
      const i0 = Math.max(0, Math.min(items.length - 1, Math.ceil(s.invert(PAD))));
      const i1 = Math.max(0, Math.min(items.length - 1, Math.floor(s.invert(width - PAD))));
      latest.current.onViewChange(items[i0].time, items[Math.max(i0, i1)].time);
    }

    // Each lane's events, as global item indices in order.
    const laneIndex: number[][] = lanes.map(() => []);
    items.forEach((item, i) => {
      for (const e of item.entries) laneIndex[e.lane]?.push(i);
    });
    const entryOf = (i: number, lane: number) => items[i].entries.find((e) => e.lane === lane)!;
    // Counterparties on more than one card, busiest first: the top three get a colour, the rest a ring.
    const partyCount = new Map<string, number>();
    for (const item of items) for (const e of item.entries) if (e.party) partyCount.set(e.party, (partyCount.get(e.party) ?? 0) + 1);
    const repeated = [...partyCount].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const partyRank = new Map(repeated.map(([party], i) => [party, i]));
    const partyColors = [p.party1, p.party2, p.party3];
    const hits: Hit[] = [];
    // Cluster pills, so marks painted after them can keep out of them.
    const pills: { x0: number; x1: number; lane: number }[] = [];
    const pillAt = (x: number, lane: number) => pills.find((pl) => pl.lane === lane && x > pl.x0 && x < pl.x1);
    const clipOutPills = () => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-50, -50, width + 100, height + 100);
      for (const pl of pills) ctx.roundRect(pl.x0, laneY(pl.lane) - PILL_H / 2, pl.x1 - pl.x0, PILL_H, 10);
      ctx.clip("evenodd");
    };

    // Lanes with OPEN and CLOSE bookends, and a branch where a lane was mapped from another.
    const firstAtOrAfter = (time: number) => {
      const i = items.findIndex((it) => it.time >= time);
      return i === -1 ? items.length : i;
    };
    const openXOf = (lane: TimelineLane) => (mode === "time" ? scale(lane.start) : scale(firstAtOrAfter(lane.start) - 0.5));
    const closeX = mode === "time" ? undefined : scale(items.length - 0.5);
    // `edge` is where the lane starts or ends: a bar across the lane marks it exactly, the label names it.
    const lifecycle: { text: string; x: number; y: number; align: CanvasTextAlign; edge: number; laneY: number }[] = [];
    lanes.forEach((lane, l) => {
      const y = laneY(l);
      const openX = openXOf(lane);
      const endX = closeX ?? scale(lane.end);
      ctx.strokeStyle = p.muted;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.max(openX, -10), y);
      ctx.lineTo(Math.min(endX, width + 10), y);
      ctx.stroke();
      // Above where a pill would sit, and painted after the events, so a pill at the lane's end can't hide it.
      const labelY = y - (multi ? PILL_H / 2 + 4 : 22);
      // A lane too short for both labels inside it puts them outside its ends instead of on top of each other.
      ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
      const outward = endX - openX < ctx.measureText("OPEN").width + ctx.measureText("CLOSE").width + 16;
      if (openX >= -40 && openX <= width) lifecycle.push({ text: "OPEN", x: outward ? openX - 4 : openX + 4, y: labelY, align: outward ? "right" : "left", edge: openX, laneY: y });
      if (endX >= 0 && endX <= width + 40) lifecycle.push({ text: "CLOSE", x: outward ? endX + 4 : endX - 4, y: labelY, align: outward ? "left" : "right", edge: endX, laneY: y });
      if (lane.fork && lanes[lane.fork.fromLane]) {
        const x0 = mode === "time" ? scale(lane.fork.time) : scale(firstAtOrAfter(lane.fork.time));
        const y0 = laneY(lane.fork.fromLane);
        ctx.strokeStyle = p.muted;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.bezierCurveTo(x0, (y0 + y) / 2, openX, (y0 + y) / 2, openX, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (multi) {
        // Lane name, pinned to the left edge so it stays readable while panning.
        const labelY = y + 30;
        ctx.textAlign = "left";
        ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
        const main = lane.label;
        const mainW = ctx.measureText(main).width;
        ctx.font = "11px ui-monospace, monospace";
        const subW = lane.sublabel ? ctx.measureText(lane.sublabel).width + 8 : 0;
        ctx.fillStyle = p.bg;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(4, labelY - 13, mainW + subW + 12, 18);
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.fg;
        ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(main, 10, labelY);
        if (lane.sublabel) {
          ctx.fillStyle = p.muted;
          ctx.font = "11px ui-monospace, monospace";
          ctx.fillText(lane.sublabel, 10 + mainW + 8, labelY);
        }
        hits.push({ type: "lane", x0: 4, y0: labelY - 14, x1: 16 + mainW + subW, y1: labelY + 5, lane: l });
      }
    });

    // Shared transactions: one x, joined across the lanes involved, arrowed the way value moved.
    // Nearby ones merge into one trunk with a count, whichever lanes they join, so zoomed out they don't comb the view;
    // the selected transaction always keeps its own, highlighted.
    const selectedSignature = selected ? items[selected.index]?.signature : undefined;
    const links: { x: number; connectors: ReturnType<typeof connectors> }[] = [];
    let selectedLink: (typeof links)[number] | null = null;
    items.forEach((item, i) => {
      if (item.entries.length < 2) return;
      const x = xs[i];
      if (x < -20 || x > width + 20) return;
      const link = { x, connectors: connectors(item.entries) };
      if (item.signature === selectedSignature) selectedLink = link;
      else links.push(link);
    });
    const drawTrunk = (t: Trunk, on: boolean) => {
      const top = laneY(t.lanes[0]);
      const bottom = laneY(t.lanes[t.lanes.length - 1]);
      const tipY = t.direction === 1 ? bottom - 9 : top + 9;
      ctx.strokeStyle = on ? p.fg : p.muted;
      ctx.fillStyle = on ? p.fg : p.muted;
      // Heavier with more transactions behind it, within reason.
      ctx.lineWidth = on ? 2 : Math.min(3.5, 1.25 + Math.log2(t.count) * 0.5);
      ctx.beginPath();
      ctx.moveTo(t.x, t.direction === -1 ? tipY : top + 7);
      ctx.lineTo(t.x, t.direction === 1 ? tipY : bottom - 7);
      ctx.stroke();
      if (t.direction) {
        const d = t.direction;
        ctx.beginPath();
        ctx.moveTo(t.x, tipY + d * 2);
        ctx.lineTo(t.x - 4, tipY - d * 5);
        ctx.lineTo(t.x + 4, tipY - d * 5);
        ctx.closePath();
        ctx.fill();
      }
      // Lanes it passes through mid-way get a small dot, so a crossing reads apart from a stop.
      for (const l of t.lanes.slice(1, -1)) {
        ctx.beginPath();
        ctx.arc(t.x, laneY(l), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (t.count > 1) {
        // The count sits beside the line, a third of the way along its first span, clear of the lane cards at either end.
        const label = `×${t.count.toLocaleString()}`;
        ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
        const w = ctx.measureText(label).width + 8;
        const y = top + (laneY(t.lanes[1]) - top) / 3;
        ctx.fillStyle = p.bg;
        ctx.fillRect(t.x + 4, y - 7, w, 14);
        ctx.fillStyle = p.muted;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, t.x + 8, y + 0.5);
        ctx.textBaseline = "alphabetic";
      }
    };
    for (const t of mergeConnectors(links, CONNECTOR_MERGE)) drawTrunk(t, false);
    if (selectedLink) for (const t of mergeConnectors([selectedLink], 0)) drawTrunk(t, true);

    // Events per lane: natural clusters first, then dense runs split into calendar buckets that fit a pill.
    const DAY = 86_400_000;
    let keyOfGlobal: (i: number) => number;
    let bucketMs = DAY;
    if (mode === "time") {
      const t0 = range.start;
      const pxPerMs = Math.max(1e-12, (scale(t0 + DAY) - scale(t0)) / DAY);
      const bucket = chooseBucket(pxPerMs, BUCKET_MIN);
      bucketMs = bucket.ms;
      keyOfGlobal = (i) => +bucket.interval.floor(new Date(items[i].time));
    } else {
      const pxPerEvent = Math.max(1e-9, scale(1) - scale(0));
      const chunk = Math.max(1, Math.ceil(BUCKET_MIN / pxPerEvent));
      keyOfGlobal = (i) => Math.floor(i / chunk);
    }
    // Merging asks for the same pills' labels many times per frame; format each once.
    const pillCache = new Map<string, [string, string]>();
    const pillLines = (firstGlobal: number, lastGlobal: number, count: number): [string, string] => {
      const key = `${firstGlobal}:${lastGlobal}:${count}`;
      const cached = pillCache.get(key);
      if (cached) return cached;
      const t0 = new Date(items[firstGlobal].time);
      const t1 = new Date(items[lastGlobal].time);
      const sameDay = nodeDay(t0) === nodeDay(t1);
      const when = sameDay
        ? bucketMs < DAY
          ? `${nodeDay(t0)} ${timeFormat(t0)}`
          : nodeDay(t0)
        : `${nodeDay(t0)} – ${nodeDay(t1)}`;
      const lines: [string, string] = [`${count.toLocaleString()} tx`, when];
      pillCache.set(key, lines);
      return lines;
    };
    const inView = (x0: number, x1: number) => x1 >= -CARD_W && x0 <= width + CARD_W;

    laneIndex.forEach((indices, l) => {
      const y = laneY(l);
      const lxs = indices.map((i) => xs[i]);
      const pillWidth = (g: Group) => {
        const [count, when] = pillLines(indices[g.first], indices[g.last], g.count);
        return Math.max(textWidth(ctx, "600 11px ui-sans-serif, system-ui, sans-serif", count), textWidth(ctx, "10px ui-sans-serif, system-ui, sans-serif", when)) + 18;
      };
      const groups = mergeOverlapping(
        splitByBucket(groupEvents(lxs, DOT_GAP), lxs, (k) => keyOfGlobal(indices[k])),
        (g) => (g.count > 1 ? pillWidth(g) : 14),
        PILL_GAP,
      );
      const placements = placeCards(groups, CARD_W, 8, multi ? 1 : 2);
      // Position of the selection within this lane, if it's on this lane.
      const selectedPos = selected && selected.lane === l ? indices.indexOf(selected.index) : -1;
      // The same transaction selected on another lane is echoed here.
      const echoPos = selectedSignature ? indices.findIndex((i) => items[i].signature === selectedSignature) : -1;

      groups.forEach((g, gi) => {
        if (!inView(g.x0, g.x1)) return;
        const first = indices[g.first];
        const last = indices[g.last];
        const isSelected = selectedPos >= g.first && selectedPos <= g.last && selectedPos !== -1;
        const isEcho = !isSelected && echoPos !== -1 && echoPos >= g.first && echoPos <= g.last;

        if (g.count > 1) {
          const [count, when] = pillLines(first, last, g.count);
          const w = pillWidth(g);
          const x = g.x - w / 2;
          // What's inside, by type: a composition bar along the bottom and a hover breakdown.
          const kinds = new Map<string, { n: number; tone: Tone }>();
          for (let k = g.first; k <= g.last; k++) {
            const { label, tone } = entryOf(indices[k], l);
            kinds.set(label, { n: (kinds.get(label)?.n ?? 0) + 1, tone });
          }
          const breakdown = [...kinds].sort((a, b) => b[1].n - a[1].n);
          ctx.beginPath();
          ctx.roundRect(x, y - PILL_H / 2, w, PILL_H, 10);
          ctx.fillStyle = p.card;
          ctx.fill();
          ctx.save();
          ctx.clip();
          let bx = x;
          for (const [, { n, tone }] of breakdown) {
            const bw = (n / g.count) * w;
            ctx.fillStyle = p[tone];
            ctx.fillRect(bx, y + PILL_H / 2 - 3, bw, 3);
            bx += bw;
          }
          ctx.restore();
          ctx.beginPath();
          ctx.roundRect(x, y - PILL_H / 2, w, PILL_H, 10);
          ctx.lineWidth = isSelected ? 2 : 1;
          ctx.strokeStyle = isSelected || isEcho ? p.fg : p.muted;
          ctx.stroke();
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = p.fg;
          ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(count, g.x, y - 6);
          ctx.fillStyle = p.muted;
          ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(when, g.x, y + 7);
          ctx.textBaseline = "alphabetic";
          const label = `${count} · ${when}\n${breakdown.map(([label, { n }]) => `${n} ${label.toLowerCase()}`).join(" · ")}\nClick to open`;
          hits.push({ type: "event", x0: x, y0: y - PILL_H / 2, x1: x + w, y1: y + PILL_H / 2, first, last, lane: l, label });
          pills.push({ x0: x, x1: x + w, lane: l });
          return;
        }

        const entry = entryOf(first, l);
        const color = p[entry.tone];
        const placement = placements[gi];
        if (placement) {
          const top = placement.tier === 0 ? y - CARD_GAP - CARD_H : y + CARD_GAP;
          // The card slides to stay inside the canvas; its stem still starts at the event's own dot.
          const left = Math.max(4, Math.min(placement.left, width - CARD_W - 4));
          ctx.strokeStyle = p.border;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(g.x, y);
          ctx.lineTo(g.x, placement.tier === 0 ? top + CARD_H : top);
          ctx.stroke();
          ctx.beginPath();
          ctx.roundRect(left, top, CARD_W, CARD_H, 8);
          ctx.fillStyle = p.card;
          ctx.fill();
          ctx.lineWidth = isSelected ? 2 : 1;
          ctx.strokeStyle = isSelected ? p.fg : isEcho ? p.muted : p.border;
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.fillRect(left, top + 8, 3, CARD_H - 16);
          ctx.textAlign = "left";
          const fonts = [
            "11px ui-sans-serif, system-ui, sans-serif",
            "600 10px ui-sans-serif, system-ui, sans-serif",
            "600 12px ui-monospace, monospace",
            "11px ui-monospace, monospace",
          ];
          const colors = [p.muted, color, p.fg, p.muted];
          const rank = entry.party === undefined ? undefined : partyRank.get(entry.party);
          entry.lines.slice(0, 4).forEach((line, li) => {
            // The counterparty line makes room for its chip.
            const chip = li === 3 && rank !== undefined && line ? 10 : 0;
            if (chip) {
              const cy = top + 16 + li * 14 - 3.5;
              ctx.beginPath();
              ctx.arc(left + 13, cy, 3, 0, Math.PI * 2);
              if (rank !== undefined && rank < partyColors.length) {
                ctx.fillStyle = partyColors[rank];
                ctx.fill();
              } else {
                ctx.strokeStyle = p.muted;
                ctx.lineWidth = 1;
                ctx.stroke();
              }
            }
            ctx.fillStyle = colors[li];
            const text = fitText(ctx, fonts[li], line, CARD_W - 18 - chip);
            // fitText only sets the font when it has to measure.
            ctx.font = fonts[li];
            ctx.fillText(text, left + 10 + chip, top + 16 + li * 14);
          });
          hits.push({ type: "event", x0: left, y0: top, x1: left + CARD_W, y1: top + CARD_H, first, last: first, lane: l });
        }

        ctx.beginPath();
        ctx.arc(g.x, y, isSelected ? 7 : 5, 0, Math.PI * 2);
        if (entry.tone === "failed") {
          ctx.fillStyle = p.bg;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = color;
          ctx.stroke();
        } else {
          ctx.fillStyle = color;
          ctx.fill();
        }
        if (isSelected || isEcho) {
          ctx.lineWidth = isSelected ? 2 : 1.5;
          ctx.strokeStyle = isSelected ? p.fg : p.muted;
          ctx.stroke();
        }
        hits.push({ type: "event", x0: g.x - 8, y0: y - 8, x1: g.x + 8, y1: y + 8, first, last: first, lane: l });
      });
    });

    // Behaviour observations over the events: a bar along the lane for the span, a diamond where it starts.
    // Ones that overlap at this zoom merge into a count; opening it zooms to them.
    {
      const timeX = (time: number) => {
        if (mode === "time") return scale(time);
        const i = items.findIndex((it) => it.time >= time);
        return xOf(i === -1 ? items.length - 1 : i);
      };
      const endX = (time: number) => (mode === "time" ? scale(time) : xOf(Math.max(0, items.findLastIndex((it) => it.time <= time))));
      for (let l = 0; l < lanes.length; l++) {
        const y = laneY(l);
        const placed = observations
          .filter((o) => o.lane === l)
          .map((o) => ({ o, x0: timeX(o.start), x1: Math.max(timeX(o.start), endX(o.end)) }))
          .filter((m) => m.x1 >= -20 && m.x0 <= width + 20)
          .sort((a, b) => a.x0 - b.x0);
        // Spans are drawn one by one, thin, behind the pills; only the selected one stands out.
        clipOutPills();
        for (const m of placed) {
          const on = m.o.key === selectedObservation;
          ctx.globalAlpha = on ? 1 : 0.45;
          ctx.fillStyle = p.behavior;
          ctx.fillRect(m.x0, y - (on ? 3 : 1), Math.max(2, m.x1 - m.x0), on ? 6 : 2);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
        // Markers merge by where they start, so a long span never swallows the ones inside it.
        const groups: (typeof placed)[] = [];
        for (const m of placed) {
          const last = groups[groups.length - 1];
          if (last && m.x0 - last[last.length - 1].x0 <= 16) last.push(m);
          else groups.push([m]);
        }
        groups.forEach((group, gi) => {
          const x0 = group[0].x0;
          const on = group.some((g) => g.o.key === selectedObservation);
          // One that lands in a pill sits on its bottom edge instead, a badge rather than a mark through the label.
          const my = pillAt(x0, l) ? y + PILL_H / 2 : y;
          ctx.save();
          ctx.translate(x0, my);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = p.behavior;
          ctx.fillRect(-4.5, -4.5, 9, 9);
          if (on) {
            ctx.lineWidth = 2;
            ctx.strokeStyle = p.fg;
            ctx.strokeRect(-4.5, -4.5, 9, 9);
          }
          ctx.restore();
          const text = group.length === 1 ? group[0].o.label : `${group.length}`;
          ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
          let w = ctx.measureText(text).width;
          const left = Math.max(4, Math.min(x0 - 4, width - w - 8));
          // A label that would run into the next marker shortens to its count.
          const next = groups[gi + 1]?.[0].x0 ?? Number.POSITIVE_INFINITY;
          const shown = left + w + 6 < next - 4 ? text : group.length === 1 ? "" : `${group.length}`;
          w = ctx.measureText(shown).width;
          ctx.fillStyle = p.bg;
          ctx.globalAlpha = shown ? 0.85 : 0;
          ctx.fillRect(left - 2, my + 6, w + 6, 13);
          ctx.globalAlpha = 1;
          ctx.fillStyle = p.behavior;
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
          ctx.fillText(shown, left + 1, my + 16);
          const label =
            group.length === 1
              ? `${group[0].o.label}\nClick for what triggered it`
              : `${group.length} observations: ${[...new Set(group.map((g) => g.o.label))].join(", ")}\nClick to open`;
          // Only the marker and its label take clicks: the span runs along the lane, over the events.
          hits.push({
            type: "observation",
            x0: Math.min(x0 - 6, left - 2),
            y0: my - 6,
            x1: Math.max(x0 + 6, left + w + 4),
            y1: my + 20,
            keys: group.map((g) => g.o.key),
            start: Math.min(...group.map((g) => g.o.start)),
            end: Math.max(...group.map((g) => g.o.start)),
            label,
          });
        });
      }
    }

    // OPEN and CLOSE on top of the events: a bar across the lane at the exact edge, and a small label
    // on a background so it reads over lines and pill edges. A bar never cuts through a pill: the label still marks it.
    clipOutPills();
    for (const mark of lifecycle) {
      ctx.strokeStyle = p.fg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mark.edge, mark.laneY - 12);
      ctx.lineTo(mark.edge, mark.laneY + 12);
      ctx.stroke();
    }
    ctx.restore();
    ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "alphabetic";
    const cards = hits.filter((h) => h.type === "event" && h.x1 - h.x0 === CARD_W);
    for (const mark of lifecycle) {
      const w = ctx.measureText(mark.text).width;
      // Kept inside the canvas, and slid clear of any card sitting where it would go
      // (below the line is where the lane's name goes).
      let left = Math.max(4, Math.min(mark.align === "left" ? mark.x : mark.x - w, width - w - 4));
      const y = mark.y;
      for (let tries = 0; tries < 4; tries++) {
        const hit = cards.find((c) => left - 3 < c.x1 && left + w + 3 > c.x0 && y - 10 < c.y1 && y + 3 > c.y0);
        if (!hit) break;
        const right = hit.x1 + 6;
        left = right + w + 4 <= width ? right : hit.x0 - w - 6;
      }
      ctx.fillStyle = p.bg;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(left - 3, y - 10, w + 6, 13);
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.muted;
      ctx.textAlign = "left";
      ctx.fillText(mark.text, left, y);
    }

    // Axis last: its band covers anything from lanes scrolled beneath it.
    {
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      if (multi) {
        ctx.fillStyle = p.bg;
        ctx.fillRect(0, axisY - 14, width, 32);
      }
      ctx.fillStyle = p.muted;
      ctx.strokeStyle = p.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, axisY - 14);
      ctx.lineTo(width, axisY - 14);
      ctx.stroke();
      if (mode === "time") {
        const s = scale as ScaleTime<number, number>;
        const ticks = s.ticks(Math.max(2, Math.floor(width / 120)));
        for (const t of ticks) {
          const x = s(t);
          ctx.beginPath();
          ctx.moveTo(x, axisY - 14);
          ctx.lineTo(x, axisY - 10);
          ctx.stroke();
          ctx.fillText(axisLabel(t), x, axisY);
        }
      } else {
        let lastX = Number.NEGATIVE_INFINITY;
        let lastDay = "";
        for (let i = 0; i < items.length; i++) {
          const x = xs[i];
          if (x < 0 || x > width || x - lastX < 110) continue;
          lastX = x;
          // Name the day once; after that, show the time until the day changes.
          const date = new Date(items[i].time);
          const day = dayFormat(date);
          ctx.fillText(day === lastDay ? axisFormats.minute(date) : day, x, axisY);
          lastDay = day;
        }
        ctx.textAlign = "left";
        ctx.fillText("Event spacing: gaps between transactions aren't to scale", 8, axisY - 22);
        ctx.textAlign = "center";
      }
      // Time context: tick labels drop the day (or year) as you zoom in, so name it at the left.
      {
        const leftTime =
          mode === "time"
            ? +(scale as ScaleTime<number, number>).invert(PAD)
            : items[Math.max(0, Math.min(items.length - 1, Math.ceil((scale as ScaleLinear<number, number>).invert(PAD))))]?.time;
        if (leftTime !== undefined) {
          const visibleMs =
            mode === "time"
              ? +(scale as ScaleTime<number, number>).invert(width - PAD) - leftTime
              : (items[Math.max(0, Math.min(items.length - 1, Math.floor((scale as ScaleLinear<number, number>).invert(width - PAD))))]?.time ?? leftTime) - leftTime;
          const text = visibleMs < 3 * 86_400_000 ? contextDay(new Date(leftTime)) : contextYear(new Date(leftTime));
          ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
          const w = ctx.measureText(text).width + 12;
          ctx.fillStyle = p.bg;
          ctx.fillRect(0, axisY - 11, w + 4, 14);
          ctx.fillStyle = p.fg;
          ctx.textAlign = "left";
          ctx.fillText(text, 6, axisY);
          ctx.textAlign = "center";
          ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
        }
      }
    }

    hitsRef.current = hits;
  }, [baseScale, laneY]);

  const schedule = useCallback(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const maxZoom = useCallback(() => {
    const { items, range, mode } = latest.current;
    const width = widthRef.current - 2 * PAD;
    // Time: until one second spans ~200px. Events: until each gets a full card.
    return mode === "time"
      ? Math.max(8, ((range.end - range.start) / 1000) * (200 / width))
      : Math.max(8, (items.length * (CARD_W + 16)) / width);
  }, []);

  const applyTransform = useCallback((t: ZoomTransform) => {
    const canvas = canvasRef.current;
    if (canvas && zoomRef.current) select(canvas).call(zoomRef.current.transform, t);
  }, []);

  const showBaseRange = useCallback(
    (a: number, b: number) => {
      const base = baseScale();
      const x0 = base(a);
      const x1 = base(b);
      const { k, x } = fitTransform(x0, x1, widthRef.current, PAD, maxZoom());
      applyTransform(zoomIdentity.translate(x, 0).scale(k));
    },
    [applyTransform, baseScale, maxZoom],
  );

  /** Show [start, end] in ms of case time, in either spacing mode; `padded` adds a margin of 10% (at least a minute) in time spacing. */
  const zoomTo = useCallback(
    (start: number, end: number, padded = true) => {
      const { items, mode } = latest.current;
      if (mode === "time") {
        const pad = padded ? Math.max((end - start) * 0.1, 60_000) : 0;
        return showBaseRange(start - pad, end + pad);
      }
      const first = items.findIndex((i) => i.time >= start);
      const last = items.findLastIndex((i) => i.time <= end);
      if (first === -1 || last < first) return;
      showBaseRange(first - 1, last + 1);
    },
    [showBaseRange],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit: () => applyTransform(zoomIdentity),
      zoomBy: (factor) => {
        const canvas = canvasRef.current;
        if (canvas && zoomRef.current) select(canvas).call(zoomRef.current.scaleBy, factor);
      },
      centerOn: (index, lane) => {
        const { items, mode } = latest.current;
        if (!items[index]) return;
        const base = baseScale();
        const t = transformRef.current;
        const x = mode === "time" ? base(items[index].time) : base(index);
        // Zoom in until the event is clear of its nearest neighbour (enough for a card), never zooming out.
        let neededPx: number;
        if (mode === "time") {
          const time = items[index].time;
          const gaps = [items[index - 1], items[index + 1]]
            .filter((n) => n !== undefined)
            .map((n) => Math.abs(base(n.time) - base(time)));
          neededPx = gaps.length === 0 ? 0 : Math.min(...gaps);
        } else {
          neededPx = base(1) - base(0);
        }
        const wanted = neededPx > 0 ? (CARD_W + 16) / neededPx : maxZoom();
        const k = Math.max(t.k, Math.min(maxZoom(), wanted));
        applyTransform(zoomIdentity.translate(widthRef.current / 2 - k * x, 0).scale(k));
        // Bring the lane into view when lanes overflow.
        const scroller = canvasRef.current?.parentElement;
        if (lane !== undefined && scroller && stacked()) {
          const y = laneY(lane);
          const { top, height } = viewportRef.current;
          if (y - CARD_H - CARD_GAP < top || y + 40 > top + height - AXIS_SPACE) {
            scroller.scrollTo({ top: Math.max(0, y - height / 2), behavior: "smooth" });
          }
        }
      },
      showTimeRange: zoomTo,
    }),
    [applyTransform, baseScale, laneY, maxZoom, zoomTo],
  );

  // Size to the container, with crisp rendering on HiDPI screens. With many
  // lanes the canvas grows taller than the container, which then scrolls.
  const laneCount = lanes.length;
  useEffect(() => {
    const canvas = canvasRef.current;
    const scroller = canvas?.parentElement;
    if (!canvas || !scroller) return;
    const resize = () => {
      const width = scroller.clientWidth || 800;
      const viewHeight = Math.max(MIN_HEIGHT, scroller.clientHeight || MIN_HEIGHT);
      const height = Math.max(viewHeight, contentHeight(latest.current.lanes.length));
      // Keep the same stretch of time in view when the canvas changes width
      // (e.g. the details panel opens); the transform alone is in old pixels.
      const previousWidth = widthRef.current;
      const before = transformRef.current.rescaleX(baseScale());
      const visible = [before.invert(PAD), before.invert(previousWidth - PAD)].map(Number);
      widthRef.current = width;
      heightRef.current = height;
      viewportRef.current = { top: scroller.scrollTop, height: viewHeight };
      sizeCanvas(canvas, width, height);
      zoomRef.current?.extent([[0, 0], [width, height]]).scaleExtent([1, maxZoom()]);
      if (width !== previousWidth && transformRef.current.k > 1) showBaseRange(visible[0], visible[1]);
      schedule();
    };
    const onScroll = () => {
      viewportRef.current = { ...viewportRef.current, top: scroller.scrollTop };
      schedule();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(scroller);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    resize();
    const theme = matchMedia("(prefers-color-scheme: dark)");
    theme.addEventListener("change", schedule);
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      theme.removeEventListener("change", schedule);
    };
  }, [baseScale, maxZoom, schedule, showBaseRange, laneCount]);

  // Drag pans on the x axis; a vertical swipe scrolls overflowing lanes or zooms when they fit.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { behavior, dispose } = horizontalZoom(canvas, maxZoom(), () => heightRef.current > viewportRef.current.height + 1, (t) => {
      transformRef.current = t;
      schedule();
    });
    behavior.extent([[0, 0], [widthRef.current, heightRef.current]]);
    zoomRef.current = behavior;
    return dispose;
  }, [maxZoom, schedule]);

  // A new mode or range starts from the full range.
  useEffect(() => {
    zoomRef.current?.scaleExtent([1, maxZoom()]);
    applyTransform(zoomIdentity);
    schedule();
  }, [mode, range.start, range.end, applyTransform, maxZoom, schedule]);

  // New items (e.g. a filter change) keep the view in time spacing, where x
  // doesn't depend on the items; event spacing re-spreads, so start over.
  const itemsSeen = useRef(items);
  useEffect(() => {
    if (itemsSeen.current === items) return;
    itemsSeen.current = items;
    zoomRef.current?.scaleExtent([1, maxZoom()]);
    if (latest.current.mode === "event") applyTransform(zoomIdentity);
    schedule();
  }, [items, applyTransform, maxZoom, schedule]);

  useEffect(schedule, [selected, lanes, observations, selectedObservation, schedule]);

  function hitAt(event: React.MouseEvent<HTMLCanvasElement>): Hit | undefined {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    // Cards are pushed after their dots, so search from the end to prefer the card on top.
    return [...hitsRef.current].reverse().find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1);
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Transaction timeline, one lane per mapped wallet. Use the controls or arrow keys to move between transactions."
      className="block cursor-grab touch-pan-y active:cursor-grabbing"
      onClick={(event) => {
        const hit = hitAt(event);
        if (!hit) return;
        if (hit.type === "lane") return onSelectLane(hit.lane);
        if (hit.type === "observation") {
          if (hit.keys.length === 1 || hit.end - hit.start < UNRESOLVABLE_MS) return onSelectObservation?.(hit.keys[0], hit.keys);
          return zoomTo(hit.start, hit.end);
        }
        if (hit.first === hit.last) onSelect(hit.first, hit.lane);
        else {
          const { items } = latest.current;
          // Opening a cluster zooms to its time span.
          const start = items[hit.first].time;
          const end = items[hit.last].time;
          if (latest.current.mode === "time" && end - start < UNRESOLVABLE_MS) onNeedsEventSpacing(hit.first, hit.lane);
          else zoomTo(start, end);
        }
      }}
      onMouseMove={(event) => {
        const hit = hitAt(event);
        event.currentTarget.style.cursor = hit ? "pointer" : "";
        // Clusters say what's inside on hover.
        const label = hit?.type === "event" || hit?.type === "observation" ? (hit.label ?? "") : "";
        if (event.currentTarget.title !== label) event.currentTarget.title = label;
      }}
    />
  );
}
