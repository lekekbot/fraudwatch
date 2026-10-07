"use client";

import { useEffect, useRef, useState } from "react";
import { histogram } from "@/lib/timeline/layout";
import { readPalette } from "../canvas";

const HEIGHT = 44;
/** A drag shorter than this (px) is a click. */
const CLICK_PX = 4;

/**
 * Activity histogram across the whole case period, with the timeline's visible
 * window drawn on top. Click to go there (zooming in if the whole range is in
 * view), drag the window to pan, or drag across the rest to zoom to a range.
 */
export function TimelineMinimap({
  times,
  range,
  view,
  onNavigate,
  onPan,
  onSelectRange,
}: {
  times: readonly number[];
  range: { start: number; end: number };
  view: { start: number; end: number } | null;
  /** A click at `time`. */
  onNavigate: (time: number) => void;
  /** The window was dragged to be centred on `time`, keeping its span. */
  onPan: (time: number) => void;
  /** A range was dragged out. */
  onSelectRange: (start: number, end: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ startX: number; startTime: number; mode: "pan" | "brush"; moved: boolean } | null>(null);
  const [brush, setBrush] = useState<{ a: number; b: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      // Its own laid-out width (it's width: 100% of its padded container), not the container's.
      const width = canvas.clientWidth || 800;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, HEIGHT);
      const { muted, fg } = readPalette(canvas, { muted: "--muted-foreground", fg: "--foreground" });

      const bins = histogram(times, range.start, range.end, Math.max(1, Math.floor(width / 4)));
      const max = Math.max(1, ...bins);
      const barWidth = width / bins.length;
      ctx.fillStyle = muted;
      ctx.globalAlpha = 0.6;
      bins.forEach((count, i) => {
        if (count === 0) return;
        // Square-root scale keeps a single transaction visible next to a burst of hundreds.
        const h = Math.max(2, Math.sqrt(count / max) * (HEIGHT - 6));
        ctx.fillRect(i * barWidth, HEIGHT - h, Math.max(1, barWidth - 1), h);
      });
      ctx.globalAlpha = 1;

      const span = range.end - range.start;
      const xOf = (t: number) => ((t - range.start) / span) * width;
      if (view) {
        const x0 = Math.max(0.75, xOf(view.start));
        const x1 = Math.min(width - 0.75, xOf(view.end));
        ctx.strokeStyle = fg;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0, 0.75, Math.max(4, x1 - x0), HEIGHT - 1.5);
      }
      if (brush) {
        const x0 = Math.min(xOf(brush.a), xOf(brush.b));
        const x1 = Math.max(xOf(brush.a), xOf(brush.b));
        ctx.fillStyle = fg;
        ctx.globalAlpha = 0.15;
        ctx.fillRect(x0, 0, x1 - x0, HEIGHT);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = fg;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x0 + 0.5, 0.5, Math.max(1, x1 - x0 - 1), HEIGHT - 1);
        ctx.setLineDash([]);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [times, range.start, range.end, view, brush]);

  const timeAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return range.start + fraction * (range.end - range.start);
  };

  return (
    <canvas
      ref={canvasRef}
      aria-label="Activity across the case period. Click to go there, drag the box to pan, or drag across to zoom to a range."
      title="Click to go there · drag the box to pan · drag across to zoom to a range"
      className="block h-11 w-full cursor-pointer touch-none rounded-md border"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const t = timeAt(event);
        // Inside the visible window (when zoomed in): drag pans it. Anywhere else: drag selects a range.
        const zoomedIn = view && view.end - view.start < (range.end - range.start) * 0.9;
        const inWindow = zoomedIn && t >= view.start && t <= view.end;
        drag.current = { startX: event.clientX, startTime: t, mode: inWindow ? "pan" : "brush", moved: false };
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d) return;
        if (!d.moved && Math.abs(event.clientX - d.startX) < CLICK_PX) return;
        d.moved = true;
        // Read the pointer now: React clears the event's target before a state update would run.
        const t = timeAt(event);
        if (d.mode === "pan") onPan(t);
        else setBrush({ a: d.startTime, b: t });
      }}
      onPointerUp={(event) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        const t = timeAt(event);
        if (!d.moved) onNavigate(t);
        else if (d.mode === "brush") onSelectRange(Math.min(d.startTime, t), Math.max(d.startTime, t));
        setBrush(null);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setBrush(null);
      }}
    />
  );
}
