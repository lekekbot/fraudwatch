"use client";

import { select } from "d3-selection";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { MaximizeIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AddressState } from "@/lib/case/address-state";
import type { GraphEdge, WalletGraph as Graph } from "@/lib/graph/build";
import { layoutGraph, nodeRadius, type Point } from "@/lib/graph/layout";
import type { Names } from "@/lib/labels/labels";

type Palette = Record<"fg" | "muted" | "border" | "card" | "bg" | "send" | "receive" | "program", string>;

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
    program: "oklch(0.7 0.14 250)",
  };
}

/** Curve offset in world px between parallel edges of the same pair. */
const CURVE_STEP = 30;

type Curve = { edge: GraphEdge; from: Point; control: Point; to: Point };

function edgeColor(p: Palette, e: GraphEdge, wallet: string) {
  if (e.kind === "program") return p.program;
  if (e.kind === "sent_by") return p.muted;
  return e.target === wallet ? p.receive : e.source === wallet ? p.send : p.muted;
}

function quadAt(c: Curve, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * c.from.x + 2 * u * t * c.control.x + t * t * c.to.x,
    y: u * u * c.from.y + 2 * u * t * c.control.y + t * t * c.to.y,
  };
}

/**
 * Node-link view of one wallet: counterparties, senders and programs around
 * it, one aggregated edge per relationship and direction. Pan and zoom the
 * canvas, drag nodes, click a node or edge to inspect it.
 */
export function WalletGraph({
  graph,
  wallet,
  names,
  stateOf,
  selectedNode,
  selectedEdge,
  onSelectNode,
  onSelectEdge,
  describeEdge,
}: {
  graph: Graph;
  wallet: string;
  names: Names;
  stateOf: (address: string) => AddressState;
  selectedNode: string | null;
  selectedEdge: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  /** Short summary drawn on a hovered edge, e.g. "12 tx · 250 USDC". */
  describeEdge: (edge: GraphEdge) => string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const sizeRef = useRef({ width: 800, height: 600 });
  const frameRef = useRef<number | null>(null);
  const hoverRef = useRef<{ node?: string; edge?: string }>({});
  const dragRef = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const layout = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph]);
  // Positions start from the layout; dragging moves them without re-running it.
  const positions = useRef(new Map<string, Point>());
  const nodesById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const latest = useRef({ graph, wallet, names, stateOf, selectedNode, selectedEdge, describeEdge, nodesById });
  // Drawing reads props through this ref; refresh it before any effect or frame uses it.
  useLayoutEffect(() => {
    latest.current = { graph, wallet, names, stateOf, selectedNode, selectedEdge, describeEdge, nodesById };
  });

  const curves = useCallback((): Curve[] => {
    const { graph } = latest.current;
    const groups = new Map<string, GraphEdge[]>();
    for (const e of graph.edges) {
      const key = [e.source, e.target].sort().join("|");
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    const out: Curve[] = [];
    for (const group of groups.values()) {
      group.forEach((edge, i) => {
        const from = positions.current.get(edge.source);
        const to = positions.current.get(edge.target);
        if (!from || !to) return;
        // Offset along the normal of a canonical direction, so A→B and B→A bow to opposite sides.
        const [a, b] = edge.source < edge.target ? [from, to] : [to, from];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / len;
        const ny = (b.x - a.x) / len;
        const offset = (i - (group.length - 1) / 2) * CURVE_STEP;
        out.push({ edge, from, to, control: { x: (from.x + to.x) / 2 + nx * offset, y: (from.y + to.y) / 2 + ny * offset } });
      });
    }
    return out;
  }, []);

  const draw = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { wallet, names, stateOf, selectedNode, selectedEdge, describeEdge, nodesById, graph } = latest.current;
    const { width, height } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    const t = transformRef.current;
    const p = readPalette(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);

    const hover = hoverRef.current;
    const focusNode = hover.node ?? selectedNode ?? undefined;
    const focusEdge = hover.edge ?? selectedEdge ?? undefined;
    const lit = (e: GraphEdge) =>
      focusEdge ? e.id === focusEdge : focusNode ? e.source === focusNode || e.target === focusNode : true;

    const all = curves();
    for (const c of all) {
      const on = lit(c.edge);
      const color = edgeColor(p, c.edge, wallet);
      ctx.globalAlpha = on ? 1 : 0.18;
      ctx.strokeStyle = color;
      ctx.lineWidth = (Math.min(6, 1 + Math.log2(c.edge.signatures.length + 1)) + (c.edge.id === focusEdge ? 1.5 : 0)) / t.k ** 0.5;
      ctx.setLineDash(c.edge.kind === "sent_by" ? [6, 5] : c.edge.kind === "program" ? [2, 4] : []);
      ctx.beginPath();
      ctx.moveTo(c.from.x, c.from.y);
      ctx.quadraticCurveTo(c.control.x, c.control.y, c.to.x, c.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Arrowhead where the curve meets the target's edge.
      const target = nodesById.get(c.edge.target);
      if (target) {
        const dx = c.to.x - c.control.x;
        const dy = c.to.y - c.control.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const r = nodeRadius(target) + 3;
        const tip = { x: c.to.x - ux * r, y: c.to.y - uy * r };
        const size = 8;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - ux * size - uy * size * 0.55, tip.y - uy * size + ux * size * 0.55);
        ctx.lineTo(tip.x - ux * size + uy * size * 0.55, tip.y - uy * size - ux * size * 0.55);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    for (const n of graph.nodes) {
      const pos = positions.current.get(n.id);
      if (!pos) continue;
      const r = nodeRadius(n);
      const state = n.kind === "wallet" ? "PRIMARY" : stateOf(n.id);
      const dim = focusNode && focusNode !== n.id && !graph.edges.some((e) => lit(e) && (e.source === n.id || e.target === n.id));
      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.beginPath();
      if (state === "INFRASTRUCTURE") ctx.roundRect(pos.x - r, pos.y - r, r * 2, r * 2, 4);
      else ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.kind === "wallet" ? p.fg : p.card;
      ctx.fill();
      ctx.lineWidth = n.id === selectedNode ? 3 : 1.5;
      ctx.strokeStyle =
        n.id === selectedNode ? p.fg : state === "INFRASTRUCTURE" ? p.program : state === "MAPPED" || state === "PRIMARY" ? p.fg : p.muted;
      ctx.stroke();
      if (n.kind !== "wallet") {
        ctx.fillStyle = p.muted;
        ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(n.txCount), pos.x, pos.y);
      }
      const known = names.known(n.id);
      ctx.font = known ? "500 11px ui-sans-serif, system-ui, sans-serif" : "11px ui-monospace, monospace";
      ctx.fillStyle = known ? p.fg : p.muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      // A halo in the background colour keeps labels readable over edges.
      ctx.lineJoin = "round";
      ctx.lineWidth = 4;
      ctx.strokeStyle = p.bg;
      ctx.strokeText(known ?? names.of(n.id, 4), pos.x, pos.y + r + 4);
      ctx.fillText(known ?? names.of(n.id, 4), pos.x, pos.y + r + 4);
    }
    ctx.globalAlpha = 1;

    // Summary on the hovered (or selected) edge.
    const labelled = all.find((c) => c.edge.id === focusEdge);
    if (labelled) {
      const mid = quadAt(labelled, 0.5);
      const text = describeEdge(labelled.edge);
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = p.card;
      ctx.strokeStyle = p.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(mid.x - w / 2, mid.y - 10, w, 20, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = p.fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, mid.x, mid.y);
    }
  }, [curves]);

  const schedule = useCallback(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !zoomRef.current || positions.current.size === 0) return;
    const pts = [...positions.current.values()];
    const pad = 60;
    const x0 = Math.min(...pts.map((q) => q.x)) - pad;
    const x1 = Math.max(...pts.map((q) => q.x)) + pad;
    const y0 = Math.min(...pts.map((q) => q.y)) - pad;
    const y1 = Math.max(...pts.map((q) => q.y)) + pad;
    const { width, height } = sizeRef.current;
    const k = Math.min(2, width / (x1 - x0), height / (y1 - y0));
    const t = zoomIdentity.translate(width / 2 - (k * (x0 + x1)) / 2, height / 2 - (k * (y0 + y1)) / 2).scale(k);
    select(canvas).call(zoomRef.current.transform, t);
  }, []);

  useEffect(schedule, [selectedNode, selectedEdge, names, schedule]);

  // Size to the container, crisp on HiDPI, and redraw on theme change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas?.parentElement) return;
    const resize = () => {
      const width = canvas.parentElement?.clientWidth ?? 800;
      const height = canvas.parentElement?.clientHeight ?? 600;
      sizeRef.current = { width, height };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      schedule();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement);
    resize();
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, [fit, schedule]);

  const toWorld = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const [x, y] = transformRef.current.invert([event.clientX - rect.left, event.clientY - rect.top]);
    return { x, y };
  }, []);

  const hitAt = useCallback(
    (event: { clientX: number; clientY: number }): { node?: string; edge?: string } => {
      const w = toWorld(event);
      const { graph } = latest.current;
      for (let i = graph.nodes.length - 1; i >= 0; i--) {
        const n = graph.nodes[i];
        const pos = positions.current.get(n.id);
        if (pos && Math.hypot(pos.x - w.x, pos.y - w.y) <= nodeRadius(n) + 4) return { node: n.id };
      }
      const tolerance = 6 / transformRef.current.k;
      let best: { id: string; d: number } | null = null;
      for (const c of curves()) {
        for (let s = 0; s <= 20; s++) {
          const q = quadAt(c, s / 20);
          const d = Math.hypot(q.x - w.x, q.y - w.y);
          if (d < tolerance && (!best || d < best.d)) best = { id: c.edge.id, d };
        }
      }
      return best ? { edge: best.id } : {};
    },
    [curves, toWorld],
  );

  // Pan and zoom, except when the press starts on a node (that drags the node).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const behavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 4])
      .clickDistance(4)
      .filter((event: MouseEvent & TouchEvent) => {
        if (event.type === "wheel") return true;
        if (event.button) return false;
        const point = event.touches?.[0] ?? event;
        return !hitAt(point).node;
      })
      .on("zoom", (event: { transform: ZoomTransform }) => {
        transformRef.current = event.transform;
        schedule();
      });
    zoomRef.current = behavior;
    select(canvas).call(behavior).on("dblclick.zoom", null);
    return () => {
      select(canvas).on(".zoom", null);
    };
  }, [hitAt, schedule]);

  // New graph: start from the layout and frame it. Declared after the size and
  // zoom effects so both exist on the first fit.
  useEffect(() => {
    positions.current = new Map(layout);
    fit();
    schedule();
  }, [layout, fit, schedule]);

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Node graph of the wallet's counterparties, senders and programs. Click a node or edge to inspect it."
        className="absolute top-0 left-0 block touch-none"
        onPointerDown={(event) => {
          const hit = hitAt(event);
          if (!hit.node) return;
          dragRef.current = { id: hit.node, x: event.clientX, y: event.clientY, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag) {
            if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
            drag.moved = true;
            positions.current.set(drag.id, toWorld(event));
            schedule();
            return;
          }
          const hit = hitAt(event);
          if (hit.node !== hoverRef.current.node || hit.edge !== hoverRef.current.edge) {
            hoverRef.current = hit;
            event.currentTarget.style.cursor = hit.node ? "grab" : hit.edge ? "pointer" : "";
            schedule();
          }
        }}
        onPointerUp={() => {
          suppressClick.current = dragRef.current?.moved ?? false;
          dragRef.current = null;
        }}
        onPointerLeave={() => {
          if (hoverRef.current.node || hoverRef.current.edge) {
            hoverRef.current = {};
            schedule();
          }
        }}
        onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          const hit = hitAt(event);
          if (hit.node) {
            onSelectEdge(null);
            onSelectNode(hit.node === wallet ? null : hit.node);
          } else if (hit.edge) {
            onSelectNode(null);
            onSelectEdge(hit.edge);
          } else {
            onSelectNode(null);
            onSelectEdge(null);
          }
        }}
      />

      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
        <div className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-popover/95 p-1 shadow-lg backdrop-blur">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => canvasRef.current && zoomRef.current && select(canvasRef.current).call(zoomRef.current.scaleBy, 1 / 1.4)}
          >
            <MinusIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => canvasRef.current && zoomRef.current && select(canvasRef.current).call(zoomRef.current.scaleBy, 1.4)}
          >
            <PlusIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Fit graph" title="Fit graph" onClick={fit}>
            <MaximizeIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reset layout"
            title="Reset layout (undo node drags)"
            onClick={() => {
              positions.current = new Map(layout);
              fit();
              schedule();
            }}
          >
            <RotateCcwIcon />
          </Button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border bg-popover/90 px-2.5 py-2 text-[11px] text-muted-foreground backdrop-blur">
        <Legend color="bg-[oklch(0.72_0.16_155)]">Received by wallet</Legend>
        <Legend color="bg-destructive">Sent by wallet</Legend>
        <Legend color="border-t border-dashed border-muted-foreground bg-transparent">Sent the transaction</Legend>
        <Legend color="border-t-2 border-dotted border-[oklch(0.7_0.14_250)] bg-transparent">Program called</Legend>
        <span className="pt-0.5">Number in node: transactions · square: program</span>
        {graph.omittedNodes > 0 && (
          <span>+{graph.omittedNodes.toLocaleString()} quieter addresses not drawn</span>
        )}
      </div>
    </div>
  );
}

function Legend({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`inline-block h-0.5 w-5 ${color}`} aria-hidden />
      {children}
    </span>
  );
}

