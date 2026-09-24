"use client";

import { useEffect, useRef } from "react";
import { histogram } from "@/lib/timeline/layout";

const HEIGHT = 44;

/**
 * Activity histogram across the whole case period, with the timeline's visible
 * window drawn on top. Clicking or dragging moves the window.
 */
export function TimelineMinimap({
  times,
  range,
  view,
  onNavigate,
}: {
  times: number[];
  range: { start: number; end: number };
  view: { start: number; end: number } | null;
  onNavigate: (time: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const width = canvas.parentElement?.clientWidth ?? 800;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${HEIGHT}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, HEIGHT);
      const css = getComputedStyle(canvas);
      const muted = css.getPropertyValue("--muted-foreground").trim() || "#888";
      const fg = css.getPropertyValue("--foreground").trim() || "#eee";

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

      if (view) {
        const span = range.end - range.start;
        const x0 = ((view.start - range.start) / span) * width;
        const x1 = ((view.end - range.start) / span) * width;
        ctx.strokeStyle = fg;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(Math.max(0.75, x0), 0.75, Math.max(4, Math.min(width - 1.5, x1) - Math.max(0.75, x0)), HEIGHT - 1.5);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, [times, range.start, range.end, view]);

  const navigate = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onNavigate(range.start + fraction * (range.end - range.start));
  };

  return (
    <canvas
      ref={canvasRef}
      aria-label="Activity across the case period. Click to move the timeline."
      className="block cursor-pointer touch-none rounded-md border"
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        navigate(event);
      }}
      onPointerMove={(event) => dragging.current && navigate(event)}
      onPointerUp={() => {
        dragging.current = false;
      }}
    />
  );
}
