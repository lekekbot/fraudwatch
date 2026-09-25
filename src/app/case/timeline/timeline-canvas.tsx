"use client";

import { type ScaleLinear, type ScaleTime, scaleLinear, scaleUtc } from "d3-scale";
import { select } from "d3-selection";
import { utcFormat } from "d3-time-format";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { wheelAction } from "@/lib/gestures";
import type { EffectKind } from "@/lib/state/summarize";
import { connectors, type Flow } from "@/lib/timeline/lanes";
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

/** One lane's view of a transaction. */
export type LaneEntry = {
  lane: number;
  kind: EffectKind;
  /** Card text, top to bottom: date, kind, amount, counterparty. */
  lines: string[];
  /** Which way value moved for this lane's wallet; orients connectors between lanes. */
  flow: Flow;
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

export type TimelineHandle = {
  fit: () => void;
  zoomBy: (factor: number) => void;
  /** Centres a transaction, zooming until it stands on its own, and scrolls its lane into view. */
  centerOn: (index: number, lane?: number) => void;
  /** Show [start, end] in ms of case time, whatever the spacing mode. `padded` adds a margin around it. */
  showTimeRange: (start: number, end: number, padded?: boolean) => void;
};

type Props = {
  items: TimelineItem[];
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
const PILL_GAP = 6;
/** Narrowest bucket a dense period is split into, in px; fits a two-line pill. */
const BUCKET_MIN = 84;
const PILL_H = 32;
/** Stacked lanes: room above the first for the floating toolbar, and each lane's band (a card tier, the lane, its label). */
const LANES_TOP = 60;
const LANE_BAND = CARD_GAP + CARD_H + 48;
const AXIS_SPACE = 44;

type Hit =
  | { type: "event"; x0: number; y0: number; x1: number; y1: number; first: number; last: number; lane: number }
  | { type: "lane"; x0: number; y0: number; x1: number; y1: number; lane: number };

type Palette = Record<"fg" | "muted" | "border" | "card" | "bg" | "send" | "receive" | "swap" | "nft" | "approval" | "neutral" | "failed", string>;

function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    fg: v("--foreground", "#eee"),
    muted: v("--muted-foreground", "#999"),
    border: v("--border", "#333"),
    card: v("--card", "#1a1a1a"),
    bg: v("--background", "#111"),
    send: v("--destructive", "#e5484d"),
    receive: "oklch(0.72 0.16 155)",
    swap: "oklch(0.7 0.14 250)",
    nft: "oklch(0.72 0.16 310)",
    approval: "oklch(0.8 0.15 80)",
    neutral: v("--muted-foreground", "#999"),
    failed: v("--destructive", "#e5484d"),
  };
}

const KIND_COLOR: Partial<Record<EffectKind, keyof Palette>> = {
  SEND: "send",
  RECEIVE: "receive",
  SWAP: "swap",
  NFT_BUY: "nft",
  NFT_SELL: "nft",
  NFT_MINT: "nft",
  NFT_SWAP: "nft",
  NFT_TRANSFER: "nft",
  APPROVAL: "approval",
  FAILED: "failed",
};
const kindColor = (p: Palette, kind: EffectKind) => p[KIND_COLOR[kind] ?? "neutral"];

const dayFormat = utcFormat("%-d %b");

/** Axis labels in 24-hour UTC, coarsest unit that the tick doesn't round to. */
const axisFormats = {
  second: utcFormat(":%S"),
  minute: utcFormat("%H:%M"),
  day: utcFormat("%-d %b"),
  month: utcFormat("%b %Y"),
};
function axisLabel(date: Date): string {
  if (date.getUTCSeconds() !== 0) return axisFormats.second(date);
  if (date.getUTCMinutes() !== 0 || date.getUTCHours() !== 0) return axisFormats.minute(date);
  if (date.getUTCDate() !== 1) return axisFormats.day(date);
  return axisFormats.month(date);
}
const timeFormat = utcFormat("%H:%M");

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Wallet lanes on a canvas: one lane per mapped wallet, stacked. X is time (or
 * event order, shared by every lane); zoom stretches the axis instead of
 * magnifying cards, so dense periods open up as you zoom in. A transaction
 * several lanes share is drawn once at one x, joined across lanes.
 */
export const TimelineCanvas = forwardRef<TimelineHandle, Props>(function TimelineCanvas(
  { items, lanes, range, mode, selected, onSelect, onSelectLane, onViewChange, onNeedsEventSpacing },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const widthRef = useRef(800);
  const heightRef = useRef(MIN_HEIGHT);
  /** Visible part of the canvas when lanes overflow and the container scrolls. */
  const viewportRef = useRef({ top: 0, height: MIN_HEIGHT });
  const hitsRef = useRef<Hit[]>([]);
  const frameRef = useRef<number | null>(null);
  const latest = useRef({ items, lanes, range, mode, selected, onViewChange });
  useLayoutEffect(() => {
    latest.current = { items, lanes, range, mode, selected, onViewChange };
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
    const { items, lanes, range, mode, selected } = latest.current;
    const width = widthRef.current;
    const height = heightRef.current;
    const multi = lanes.length > 1;
    // The axis stays at the bottom of what's visible, even when the lanes scroll.
    const viewport = viewportRef.current;
    const axisY = multi ? viewport.top + viewport.height - 18 : height - 18;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const p = readPalette(canvas);

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
    const hits: Hit[] = [];

    // Lanes with OPEN and CLOSE bookends, and a branch where a lane was mapped from another.
    const firstAtOrAfter = (time: number) => {
      const i = items.findIndex((it) => it.time >= time);
      return i === -1 ? items.length : i;
    };
    const openXOf = (lane: TimelineLane) => (mode === "time" ? scale(lane.start) : scale(firstAtOrAfter(lane.start) - 0.5));
    const closeX = mode === "time" ? undefined : scale(items.length - 0.5);
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
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = p.muted;
      ctx.textBaseline = "alphabetic";
      if (openX >= -40 && openX <= width) {
        ctx.textAlign = "left";
        ctx.fillText("OPEN", openX + 4, y - (multi ? 8 : 22));
      }
      if (endX >= 0 && endX <= width + 40) {
        ctx.textAlign = "right";
        ctx.fillText("CLOSE", endX - 4, y - (multi ? 8 : 22));
      }
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
    const selectedSignature = selected ? items[selected.index]?.signature : undefined;
    items.forEach((item, i) => {
      if (item.entries.length < 2) return;
      const x = xs[i];
      if (x < -20 || x > width + 20) return;
      const on = item.signature === selectedSignature;
      ctx.strokeStyle = on ? p.fg : p.muted;
      ctx.fillStyle = on ? p.fg : p.muted;
      ctx.lineWidth = on ? 2 : 1.25;
      for (const c of connectors(item.entries)) {
        const y0 = laneY(c.from);
        const y1 = laneY(c.to);
        const dir = Math.sign(y1 - y0);
        const tipY = y1 - dir * 9;
        ctx.beginPath();
        ctx.moveTo(x, y0 + dir * 7);
        ctx.lineTo(x, c.directed ? tipY : y1 - dir * 7);
        ctx.stroke();
        if (c.directed) {
          ctx.beginPath();
          ctx.moveTo(x, tipY + dir * 2);
          ctx.lineTo(x - 4, tipY - dir * 5);
          ctx.lineTo(x + 4, tipY - dir * 5);
          ctx.closePath();
          ctx.fill();
        }
      }
    });

    // Axis
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
    const pillLines = (firstGlobal: number, lastGlobal: number, count: number): [string, string] => {
      const t0 = new Date(items[firstGlobal].time);
      const t1 = new Date(items[lastGlobal].time);
      const sameDay = dayFormat(t0) === dayFormat(t1);
      const when = sameDay
        ? bucketMs < DAY
          ? `${dayFormat(t0)} ${timeFormat(t0)}`
          : dayFormat(t0)
        : `${dayFormat(t0)} – ${dayFormat(t1)}`;
      return [`${count.toLocaleString()} tx`, when];
    };
    const inView = (x0: number, x1: number) => x1 >= -CARD_W && x0 <= width + CARD_W;

    laneIndex.forEach((indices, l) => {
      const y = laneY(l);
      const lxs = indices.map((i) => xs[i]);
      const pillWidth = (g: Group) => {
        const [count, when] = pillLines(indices[g.first], indices[g.last], g.count);
        ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
        const a = ctx.measureText(count).width;
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        return Math.max(a, ctx.measureText(when).width) + 18;
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
          roundRect(ctx, x, y - PILL_H / 2, w, PILL_H, 10);
          ctx.fillStyle = p.card;
          ctx.fill();
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
          hits.push({ type: "event", x0: x, y0: y - PILL_H / 2, x1: x + w, y1: y + PILL_H / 2, first, last, lane: l });
          return;
        }

        const entry = entryOf(first, l);
        const color = kindColor(p, entry.kind);
        const placement = placements[gi];
        if (placement) {
          const top = placement.tier === 0 ? y - CARD_GAP - CARD_H : y + CARD_GAP;
          ctx.strokeStyle = p.border;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(g.x, y);
          ctx.lineTo(g.x, placement.tier === 0 ? top + CARD_H : top);
          ctx.stroke();
          roundRect(ctx, placement.left, top, CARD_W, CARD_H, 8);
          ctx.fillStyle = p.card;
          ctx.fill();
          ctx.lineWidth = isSelected ? 2 : 1;
          ctx.strokeStyle = isSelected ? p.fg : isEcho ? p.muted : p.border;
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.fillRect(placement.left, top + 8, 3, CARD_H - 16);
          ctx.textAlign = "left";
          const fonts = [
            "11px ui-sans-serif, system-ui, sans-serif",
            "600 10px ui-sans-serif, system-ui, sans-serif",
            "600 12px ui-monospace, monospace",
            "11px ui-monospace, monospace",
          ];
          const colors = [p.muted, color, p.fg, p.muted];
          entry.lines.slice(0, 4).forEach((line, li) => {
            ctx.font = fonts[li];
            ctx.fillStyle = colors[li];
            let text = line;
            while (text.length > 4 && ctx.measureText(text).width > CARD_W - 18) text = `${text.slice(0, -2)}…`;
            ctx.fillText(text, placement.left + 10, top + 16 + li * 14);
          });
          hits.push({ type: "event", x0: placement.left, y0: top, x1: placement.left + CARD_W, y1: top + CARD_H, first, last: first, lane: l });
        }

        ctx.beginPath();
        ctx.arc(g.x, y, isSelected ? 7 : 5, 0, Math.PI * 2);
        if (entry.kind === "FAILED") {
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
      showTimeRange: (start, end, padded = true) => {
        const { items, mode } = latest.current;
        if (mode === "time") {
          const pad = padded ? Math.max((end - start) * 0.1, 60_000) : 0;
          return showBaseRange(start - pad, end + pad);
        }
        const first = items.findIndex((i) => i.time >= start);
        let last = -1;
        for (let i = items.length - 1; i >= 0; i--) if (items[i].time <= end) { last = i; break; }
        if (first === -1 || last < first) return;
        showBaseRange(first - 1, last + 1);
      },
    }),
    [applyTransform, baseScale, laneY, maxZoom, showBaseRange],
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
      const dpr = window.devicePixelRatio || 1;
      // Keep the same stretch of time in view when the canvas changes width
      // (e.g. the details panel opens); the transform alone is in old pixels.
      const previousWidth = widthRef.current;
      const before = transformRef.current.rescaleX(baseScale());
      const visible = [before.invert(PAD), before.invert(previousWidth - PAD)].map(Number);
      widthRef.current = width;
      heightRef.current = height;
      viewportRef.current = { top: scroller.scrollTop, height: viewHeight };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      zoomRef.current?.extent([[0, 0], [width, height]]).translateExtent([[0, 0], [width, height]]).scaleExtent([1, maxZoom()]);
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
    // Redraw when the light/dark theme changes.
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      themeObserver.disconnect();
    };
  }, [baseScale, maxZoom, schedule, showBaseRange, laneCount]);

  // Drag pans on the x axis; wheel and trackpad gestures are handled below (see `wheelAction`).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = widthRef.current;
    const height = heightRef.current;
    const behavior = zoom<HTMLCanvasElement, unknown>()
      .extent([[0, 0], [width, height]])
      .translateExtent([[0, 0], [width, height]])
      .scaleExtent([1, maxZoom()])
      .filter((event: MouseEvent) => event.type !== "wheel" && !event.button)
      .on("zoom", (event: { transform: ZoomTransform }) => {
        // Vertical pan belongs to the scroll container; keep only x.
        transformRef.current = zoomIdentity.translate(event.transform.x, 0).scale(event.transform.k);
        schedule();
      });
    zoomRef.current = behavior;
    select(canvas).call(behavior).on("dblclick.zoom", null);
    return () => {
      select(canvas).on(".zoom", null);
    };
  }, [maxZoom, schedule]);

  // Pinch zooms around the pointer, a sideways swipe pans, and a vertical swipe
  // scrolls overflowing lanes or zooms when they fit.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      const behavior = zoomRef.current;
      if (!behavior) return;
      const overflow = heightRef.current > viewportRef.current.height + 1;
      const action = wheelAction(event, overflow);
      if (action.type === "scroll") return; // the browser scrolls the lanes
      event.preventDefault();
      if (action.type === "zoom") {
        const rect = canvas.getBoundingClientRect();
        select(canvas).call(behavior.scaleBy, action.factor, [event.clientX - rect.left, 0]);
      } else {
        select(canvas).call(behavior.translateBy, -action.dx / transformRef.current.k, 0);
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

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

  useEffect(schedule, [selected, lanes, schedule]);

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
        if (hit.first === hit.last) onSelect(hit.first, hit.lane);
        else {
          const { items } = latest.current;
          // Opening a cluster zooms to its time span.
          const start = items[hit.first].time;
          const end = items[hit.last].time;
          if (latest.current.mode === "time" && end - start < UNRESOLVABLE_MS) onNeedsEventSpacing(hit.first, hit.lane);
          else if (latest.current.mode === "time") {
            const pad = Math.max((end - start) * 0.1, 60_000);
            showBaseRange(start - pad, end + pad);
          } else showBaseRange(hit.first - 1, hit.last + 1);
        }
      }}
      onMouseMove={(event) => {
        event.currentTarget.style.cursor = hitAt(event) ? "pointer" : "";
      }}
    />
  );
});
