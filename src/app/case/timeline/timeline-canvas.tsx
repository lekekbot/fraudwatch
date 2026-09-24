"use client";

import { type ScaleLinear, type ScaleTime, scaleLinear, scaleUtc } from "d3-scale";
import { select } from "d3-selection";
import { utcFormat } from "d3-time-format";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { EffectKind } from "@/lib/state/summarize";
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

export type TimelineItem = {
  signature: string;
  time: number;
  kind: EffectKind;
  /** Card text, top to bottom: date, kind, amount, counterparty. */
  lines: string[];
};

export type TimelineHandle = {
  fit: () => void;
  zoomBy: (factor: number) => void;
  centerOn: (index: number) => void;
  /** Show [start, end] in ms of case time, whatever the spacing mode. `padded` adds a margin around it. */
  showTimeRange: (start: number, end: number, padded?: boolean) => void;
};

type Props = {
  items: TimelineItem[];
  range: { start: number; end: number };
  mode: SpacingMode;
  selected: number | null;
  onSelect: (index: number) => void;
  /** Visible window in case time, for the minimap. */
  onViewChange: (start: number, end: number) => void;
  /** Events that share a timestamp can't be separated by time; the parent switches to event spacing. */
  onNeedsEventSpacing: (index: number) => void;
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

type Hit = { x0: number; y0: number; x1: number; y1: number; first: number; last: number };

type Palette = Record<"fg" | "muted" | "border" | "card" | "bg" | "send" | "receive" | "swap" | "approval" | "neutral" | "failed", string>;

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
    approval: "oklch(0.8 0.15 80)",
    neutral: v("--muted-foreground", "#999"),
    failed: v("--destructive", "#e5484d"),
  };
}

const kindColor = (p: Palette, kind: EffectKind) =>
  kind === "SEND"
    ? p.send
    : kind === "RECEIVE"
      ? p.receive
      : kind === "SWAP"
        ? p.swap
        : kind === "APPROVAL"
          ? p.approval
          : kind === "FAILED"
            ? p.failed
            : p.neutral;

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
 * One wallet lane on a canvas. X is time (or event order); zoom stretches the
 * axis instead of magnifying cards, so dense periods open up as you zoom in.
 * Events that can't be told apart at the current zoom are drawn as one cluster.
 */
export const TimelineCanvas = forwardRef<TimelineHandle, Props>(function TimelineCanvas(
  { items, range, mode, selected, onSelect, onViewChange, onNeedsEventSpacing },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const widthRef = useRef(800);
  const heightRef = useRef(MIN_HEIGHT);
  const hitsRef = useRef<Hit[]>([]);
  const frameRef = useRef<number | null>(null);
  const latest = useRef({ items, range, mode, selected, onViewChange });
  latest.current = { items, range, mode, selected, onViewChange };

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
    const { items, range, mode, selected } = latest.current;
    const width = widthRef.current;
    const height = heightRef.current;
    // Lane sits in the middle of the space above the axis.
    const axisY = height - 18;
    const laneY = Math.round((axisY - 14) / 2);
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

    // Axis
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
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

    // Lane with OPEN and CLOSE bookends
    const openX = mode === "time" ? scale(range.start) : scale(-0.5);
    const closeX = mode === "time" ? scale(range.end) : scale(items.length - 0.5);
    ctx.strokeStyle = p.muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.max(openX, -10), laneY);
    ctx.lineTo(Math.min(closeX, width + 10), laneY);
    ctx.stroke();
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = p.muted;
    if (openX >= -40 && openX <= width) {
      ctx.textAlign = "left";
      ctx.fillText("OPEN", openX + 4, laneY - 22);
    }
    if (closeX >= 0 && closeX <= width + 40) {
      ctx.textAlign = "right";
      ctx.fillText("CLOSE", closeX - 4, laneY - 22);
    }

    // Events: natural clusters first, then dense runs split into calendar buckets that fit a pill.
    const DAY = 86_400_000;
    let keyOf: (i: number) => number;
    let bucketMs = DAY;
    if (mode === "time") {
      const t0 = range.start;
      const pxPerMs = Math.max(1e-12, (scale(t0 + DAY) - scale(t0)) / DAY);
      const bucket = chooseBucket(pxPerMs, BUCKET_MIN);
      bucketMs = bucket.ms;
      keyOf = (i) => +bucket.interval.floor(new Date(items[i].time));
    } else {
      const pxPerEvent = Math.max(1e-9, scale(1) - scale(0));
      const chunk = Math.max(1, Math.ceil(BUCKET_MIN / pxPerEvent));
      keyOf = (i) => Math.floor(i / chunk);
    }
    const pillLines = (g: Group): [string, string] => {
      const t0 = new Date(items[g.first].time);
      const t1 = new Date(items[g.last].time);
      const sameDay = dayFormat(t0) === dayFormat(t1);
      const when = sameDay
        ? bucketMs < DAY
          ? `${dayFormat(t0)} ${timeFormat(t0)}`
          : dayFormat(t0)
        : `${dayFormat(t0)} – ${dayFormat(t1)}`;
      return [`${g.count.toLocaleString()} tx`, when];
    };
    const pillWidth = (g: Group) => {
      const [count, when] = pillLines(g);
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
      const a = ctx.measureText(count).width;
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      return Math.max(a, ctx.measureText(when).width) + 18;
    };
    const groups = mergeOverlapping(
      splitByBucket(groupEvents(xs, DOT_GAP), xs, keyOf),
      (g) => (g.count > 1 ? pillWidth(g) : 14),
      PILL_GAP,
    );
    const placements = placeCards(groups, CARD_W, 8);
    const hits: Hit[] = [];
    const inView = (x0: number, x1: number) => x1 >= -CARD_W && x0 <= width + CARD_W;

    groups.forEach((g, gi) => {
      if (!inView(g.x0, g.x1)) return;
      const isSelected = selected !== null && selected >= g.first && selected <= g.last;

      if (g.count > 1) {
        const [count, when] = pillLines(g);
        const w = pillWidth(g);
        const x = g.x - w / 2;
        roundRect(ctx, x, laneY - PILL_H / 2, w, PILL_H, 10);
        ctx.fillStyle = p.card;
        ctx.fill();
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeStyle = isSelected ? p.fg : p.muted;
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = p.fg;
        ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(count, g.x, laneY - 6);
        ctx.fillStyle = p.muted;
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(when, g.x, laneY + 7);
        ctx.textBaseline = "alphabetic";
        hits.push({ x0: x, y0: laneY - PILL_H / 2, x1: x + w, y1: laneY + PILL_H / 2, first: g.first, last: g.last });
        return;
      }

      const item = items[g.first];
      const color = kindColor(p, item.kind);
      const placement = placements[gi];
      if (placement) {
        const top = placement.tier === 0 ? laneY - CARD_GAP - CARD_H : laneY + CARD_GAP;
        ctx.strokeStyle = p.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.x, laneY);
        ctx.lineTo(g.x, placement.tier === 0 ? top + CARD_H : top);
        ctx.stroke();
        roundRect(ctx, placement.left, top, CARD_W, CARD_H, 8);
        ctx.fillStyle = p.card;
        ctx.fill();
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeStyle = isSelected ? p.fg : p.border;
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
        item.lines.slice(0, 4).forEach((line, li) => {
          ctx.font = fonts[li];
          ctx.fillStyle = colors[li];
          let text = line;
          while (text.length > 4 && ctx.measureText(text).width > CARD_W - 18) text = `${text.slice(0, -2)}…`;
          ctx.fillText(text, placement.left + 10, top + 16 + li * 14);
        });
        hits.push({ x0: placement.left, y0: top, x1: placement.left + CARD_W, y1: top + CARD_H, first: g.first, last: g.first });
      }

      ctx.beginPath();
      ctx.arc(g.x, laneY, isSelected ? 7 : 5, 0, Math.PI * 2);
      if (item.kind === "FAILED") {
        ctx.fillStyle = p.bg;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
      if (isSelected) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = p.fg;
        ctx.stroke();
      }
      hits.push({ x0: g.x - 8, y0: laneY - 8, x1: g.x + 8, y1: laneY + 8, first: g.first, last: g.first });
    });

    hitsRef.current = hits;
  }, [baseScale]);

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
      centerOn: (index) => {
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
    [applyTransform, baseScale, maxZoom, showBaseRange],
  );

  // Size to the container, with crisp rendering on HiDPI screens.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const width = canvas.parentElement?.clientWidth ?? 800;
      const height = Math.max(MIN_HEIGHT, canvas.parentElement?.clientHeight ?? MIN_HEIGHT);
      const dpr = window.devicePixelRatio || 1;
      // Keep the same stretch of time in view when the canvas changes width
      // (e.g. the details panel opens); the transform alone is in old pixels.
      const previousWidth = widthRef.current;
      const before = transformRef.current.rescaleX(baseScale());
      const visible = [before.invert(PAD), before.invert(previousWidth - PAD)].map(Number);
      widthRef.current = width;
      heightRef.current = height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      zoomRef.current?.extent([[0, 0], [width, height]]).translateExtent([[0, 0], [width, height]]).scaleExtent([1, maxZoom()]);
      if (width !== previousWidth && transformRef.current.k > 1) showBaseRange(visible[0], visible[1]);
      schedule();
    };
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    resize();
    // Redraw when the light/dark theme changes.
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, [baseScale, maxZoom, schedule, showBaseRange]);

  // Pan and zoom on the x axis only.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = widthRef.current;
    const height = heightRef.current;
    const behavior = zoom<HTMLCanvasElement, unknown>()
      .extent([[0, 0], [width, height]])
      .translateExtent([[0, 0], [width, height]])
      .scaleExtent([1, maxZoom()])
      .on("zoom", (event: { transform: ZoomTransform }) => {
        // Vertical pan is meaningless for a single lane; keep only x.
        transformRef.current = zoomIdentity.translate(event.transform.x, 0).scale(event.transform.k);
        schedule();
      });
    zoomRef.current = behavior;
    select(canvas).call(behavior).on("dblclick.zoom", null);
    return () => {
      select(canvas).on(".zoom", null);
    };
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

  useEffect(schedule, [selected, schedule]);

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
      aria-label="Transaction timeline. Use the controls or arrow keys to move between transactions."
      className="absolute top-0 left-0 block cursor-grab touch-none active:cursor-grabbing"
      onClick={(event) => {
        const hit = hitAt(event);
        if (!hit) return;
        if (hit.first === hit.last) onSelect(hit.first);
        else {
          const { items } = latest.current;
          // Opening a cluster zooms to its time span.
          const start = items[hit.first].time;
          const end = items[hit.last].time;
          if (latest.current.mode === "time" && end - start < UNRESOLVABLE_MS) onNeedsEventSpacing(hit.first);
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
