"use client";

import { scaleUtc } from "d3-scale";
import { select } from "d3-selection";
import { type ZoomBehavior, type ZoomTransform, zoomIdentity } from "d3-zoom";
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Names } from "@/lib/labels/labels";
import { binEvents, type Relationship } from "@/lib/timeline/relationships";
import { horizontalZoom, onThemeChange, readPalette, sizeCanvas } from "../canvas";

/** Row height range: rows shrink to fit the view, down to the minimum, then the chart scrolls. */
const ROW_MAX = 52;
const ROW_MIN = 36;
/** Width of one activity slice, in px; slices follow the zoom. */
const BIN = 6;
const GUTTER = 190;
const TOP = 64;
const AXIS = 36;
const PAD = 16;

export type RelationshipChartHandle = { zoomBy: (factor: number) => void; fit: () => void };

const utcRange = (start: number, end: number) => {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const a = day(start);
  const b = day(end);
  return a === b ? a : `${a} – ${b}`;
};

/**
 * Relationships over time: one row per pair of addresses, a band across the
 * period they dealt with each other. Band thickness is how many transactions
 * fell in each slice of time; above the line is what the mapped wallet sent,
 * below what it received.
 */
export function RelationshipChart({ ref, relationships, range, names, onPick }: {
  ref?: React.Ref<RelationshipChartHandle>;
  relationships: Relationship[];
  range: { start: number; end: number };
  names: Names;
  /** Opens a transaction, seen from `wallet`'s lane. */
  onPick: (signature: string, wallet: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const sizeRef = useRef({ width: 800, height: 400, view: 400, top: 0, row: ROW_MAX });
  const frameRef = useRef<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const rows = relationships;
  const latest = useRef({ rows, range, names });
  useEffect(() => {
    latest.current = { rows, range, names };
  });

  const scale = useCallback(() => {
    const { width } = sizeRef.current;
    const base = scaleUtc().domain([latest.current.range.start, latest.current.range.end]).range([GUTTER + PAD, width - PAD]);
    return transformRef.current.rescaleX(base);
  }, []);
  const rowY = (r: number) => TOP + r * sizeRef.current.row + sizeRef.current.row / 2;

  const draw = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { rows, names } = latest.current;
    const { width, height, view, top } = sizeRef.current;
    // The axis stays at the bottom of what's visible, even when the rows scroll.
    const base = top + view - AXIS;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { fg, muted, border, bg, send, receive } = readPalette(canvas, { fg: "--foreground", muted: "--muted-foreground", border: "--border", bg: "--background", send: "--destructive", receive: "--tone-receive" });
    ctx.clearRect(0, 0, width, height);
    const x = scale();
    const left = GUTTER + PAD;
    const binned = rows.map((rel) => binEvents(rel.events, (t) => x(t), left, BIN));
    // Thickness is relative to the busiest slice in view, so quiet periods still show.
    const max = Math.max(1, ...binned.flat().map((b) => Math.max(b.sent, b.received)));
    // Widest a band gets either side of its centre line: about a third of the row.
    const widest = Math.round(sizeRef.current.row * 0.34);
    const half = (n: number) => (n === 0 ? 0 : 2 + (widest - 2) * Math.sqrt(n / max));

    ctx.save();
    ctx.beginPath();
    ctx.rect(GUTTER, 0, width - GUTTER, base);
    ctx.clip();
    rows.forEach((rel, r) => {
      const y = rowY(r);
      // The span the two dealt with each other, as a thin line, so gaps between bursts still read as one relationship.
      const x0 = x(rel.events[0].time);
      const x1 = x(rel.events[rel.events.length - 1].time);
      ctx.strokeStyle = muted;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y + 0.5);
      ctx.lineTo(Math.max(x1, x0 + 1), y + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      for (const b of binned[r]) {
        const bx = left + b.index * BIN;
        ctx.fillStyle = send;
        if (b.sent) ctx.fillRect(bx, y - half(b.sent), BIN - 1, half(b.sent));
        ctx.fillStyle = receive;
        if (b.received) ctx.fillRect(bx, y + 1, BIN - 1, half(b.received));
      }
      ctx.globalAlpha = 1;
    });
    ctx.restore();

    // Row labels in a fixed gutter: the mapped wallet, then who it dealt with.
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, GUTTER, height);
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(GUTTER - 0.5, 0);
    ctx.lineTo(GUTTER - 0.5, base);
    ctx.stroke();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    rows.forEach((rel, r) => {
      const y = rowY(r);
      ctx.fillStyle = fg;
      ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(names.of(rel.a), 12, y - 8);
      ctx.fillStyle = muted;
      ctx.font = names.known(rel.b) ? "12px ui-sans-serif, system-ui, sans-serif" : "11px ui-monospace, monospace";
      ctx.fillText(`↔ ${names.of(rel.b)}`, 12, y + 9);
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${rel.events.length.toLocaleString()} tx`, GUTTER - 10, y);
      ctx.textAlign = "left";
    });

    // Time axis along the bottom, over any rows scrolled beneath it.
    const axisY = base + 12;
    ctx.fillStyle = bg;
    ctx.fillRect(0, base, width, AXIS);
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(GUTTER, base);
    ctx.lineTo(width, base);
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    const format = x.tickFormat(Math.max(2, Math.floor((width - GUTTER) / 110)));
    for (const tick of x.ticks(Math.max(2, Math.floor((width - GUTTER) / 110)))) {
      const tx = x(tick);
      if (tx < GUTTER + 20 || tx > width - 20) continue;
      ctx.fillText(format(tick), tx, axisY);
    }
    ctx.textBaseline = "alphabetic";
  }, [scale]);

  const schedule = useCallback(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);
  useEffect(() => onThemeChange(schedule), [schedule]);

  // Size to the container; the rows can make the canvas taller than it, and the container scrolls.
  useEffect(() => {
    const canvas = canvasRef.current;
    const scroller = canvas?.parentElement;
    if (!canvas || !scroller) return;
    const resize = () => {
      const width = scroller.clientWidth || 800;
      const view = scroller.clientHeight || 400;
      const count = Math.max(1, latest.current.rows.length);
      const row = Math.max(ROW_MIN, Math.min(ROW_MAX, Math.floor((view - TOP - AXIS - 8) / count)));
      const height = Math.max(view, TOP + count * row + AXIS + 8);
      sizeRef.current = { width, height, view, top: scroller.scrollTop, row };
      sizeCanvas(canvas, width, height);
      zoomRef.current?.extent([[0, 0], [width, height]]);
      schedule();
    };
    const onScroll = () => {
      sizeRef.current = { ...sizeRef.current, top: scroller.scrollTop };
      schedule();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(scroller);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [schedule, rows.length]);

  // Drag pans time; pinch or a vertical swipe zooms; a sideways swipe pans.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { behavior, dispose } = horizontalZoom(canvas, 5000, () => sizeRef.current.height > sizeRef.current.view + 1, (t) => {
      transformRef.current = t;
      schedule();
    });
    zoomRef.current = behavior;
    return dispose;
  }, [schedule]);

  useEffect(() => schedule(), [rows, range, names, schedule]);

  useImperativeHandle(ref, () => ({
    zoomBy: (factor) => {
      const canvas = canvasRef.current;
      if (canvas && zoomRef.current) select(canvas).call(zoomRef.current.scaleBy, factor, [(GUTTER + sizeRef.current.width) / 2, 0]);
    },
    fit: () => {
      const canvas = canvasRef.current;
      if (canvas && zoomRef.current) select(canvas).call(zoomRef.current.transform, zoomIdentity);
    },
  }));

  /** The relationship row and activity slice under a point, if any. */
  const hitAt = (px: number, py: number) => {
    const { top, view } = sizeRef.current;
    if (px < GUTTER || py > top + view - AXIS) return null;
    const r = Math.floor((py - TOP) / sizeRef.current.row);
    const rel = rows[r];
    if (!rel) return null;
    const x = scale();
    const left = GUTTER + PAD;
    const index = Math.floor((px - left) / BIN);
    const bin = binEvents(rel.events, (t) => x(t), left, BIN).find((b) => b.index === index);
    if (!bin) return null;
    const start = x.invert(left + index * BIN).getTime();
    const end = x.invert(left + (index + 1) * BIN).getTime();
    return { rel, bin, start, end };
  };

  const point = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { px: event.clientX - rect.left, py: event.clientY - rect.top };
  };

  if (relationships.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No value moved between these wallets and anyone else in view.</div>;
  }

  return (
    <div className="relative h-full overflow-y-auto">
      <canvas
        ref={canvasRef}
        className="block cursor-grab active:cursor-grabbing"
        aria-label="Relationships over time"
        onMouseMove={(event) => {
          const { px, py } = point(event);
          const hit = hitAt(px, py);
          setTip(
            hit
              ? {
                  x: Math.min(px + 12, sizeRef.current.width - 260),
                  y: py + 12,
                  lines: [
                    `${names.of(hit.rel.a)} ↔ ${names.of(hit.rel.b)}`,
                    `${hit.bin.sent.toLocaleString()} sent · ${hit.bin.received.toLocaleString()} received`,
                    `${utcRange(hit.start, hit.end)} UTC · click to open`,
                  ],
                }
              : null,
          );
        }}
        onMouseLeave={() => setTip(null)}
        onClick={(event) => {
          const { px, py } = point(event);
          const hit = hitAt(px, py);
          if (hit) onPick(hit.bin.first.signature, hit.rel.a);
        }}
      />
      {tip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1.5 text-xs shadow-md"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.lines.map((line, i) => (
            <div key={i} className={i === 0 ? "font-medium" : "text-muted-foreground"}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
