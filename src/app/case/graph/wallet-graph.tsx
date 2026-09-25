"use client";

import { select } from "d3-selection";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { MaximizeIcon, MinusIcon, PlusIcon, RotateCcwIcon, WorkflowIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AddressState } from "@/lib/case/address-state";
import { graphWheelAction } from "@/lib/gestures";
import type { GraphEdge, WalletGraph as Graph } from "@/lib/graph/build";
import { layoutGraph, nodeRadius, type Point } from "@/lib/graph/layout";
import type { Names } from "@/lib/labels/labels";

type Palette = Record<"fg" | "muted" | "border" | "card" | "bg" | "program", string>;

function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    fg: v("--foreground", "#eee"),
    muted: v("--muted-foreground", "#999"),
    border: v("--border", "#333"),
    card: v("--card", "#1a1a1a"),
    bg: v("--background", "#111"),
    program: "oklch(0.7 0.14 250)",
  };
}

type Segment = { edge: GraphEdge; from: Point; to: Point };

/** Distance from `p` to the segment `a`–`b`. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Wallet interaction map: one node per address, one calm undirected line per
 * pair that directly exchanged value. Transaction detail (direction, amounts,
 * dates) lives in the side panel, not on the lines. Program links are dotted
 * and only drawn when turned on. Pan and zoom, drag nodes, click a node or
 * line to inspect it.
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
  showPrograms,
  onToggleProgramCalls,
}: {
  graph: Graph;
  wallet: string;
  names: Names;
  stateOf: (address: string) => AddressState;
  selectedNode: string | null;
  selectedEdge: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  showPrograms: boolean;
  onToggleProgramCalls: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const sizeRef = useRef({ width: 800, height: 600 });
  const frameRef = useRef<number | null>(null);
  const hoverRef = useRef<{ node?: string; edge?: string }>({});
  const dragRef = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const layout = useMemo(() => layoutGraph(graph.nodes, graph.edges, wallet), [graph, wallet]);
  // Positions start from the layout; dragging moves them without re-running it.
  const positions = useRef(new Map<string, Point>());
  const nodesById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const latest = useRef({ graph, wallet, names, stateOf, selectedNode, selectedEdge, nodesById });
  // Drawing reads props through this ref; refresh it before any effect or frame uses it.
  useLayoutEffect(() => {
    latest.current = { graph, wallet, names, stateOf, selectedNode, selectedEdge, nodesById };
  });

  const segments = useCallback((): Segment[] => {
    const out: Segment[] = [];
    for (const edge of latest.current.graph.edges) {
      const from = positions.current.get(edge.a);
      const to = positions.current.get(edge.b);
      if (from && to) out.push({ edge, from, to });
    }
    return out;
  }, []);

  const draw = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { names, stateOf, selectedNode, selectedEdge, graph } = latest.current;
    const { width, height } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    const t = transformRef.current;
    const p = readPalette(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);

    const hover = hoverRef.current;
    const focusEdge = selectedEdge ?? hover.edge ?? undefined;
    const focusNode = focusEdge ? undefined : (hover.node ?? selectedNode ?? undefined);
    const lit = (e: GraphEdge) => (focusEdge ? e.id === focusEdge : focusNode ? e.a === focusNode || e.b === focusNode : true);

    // One calm line per pair: no arrows, no labels. The selected one stands out, the rest recede.
    const line = 1.25 / Math.sqrt(t.k);
    for (const { edge, from, to } of segments()) {
      const on = lit(edge);
      const selected = edge.id === selectedEdge;
      ctx.globalAlpha = on ? 1 : 0.15;
      ctx.strokeStyle = edge.kind === "program" ? p.program : selected || (on && (focusEdge || focusNode)) ? p.fg : p.muted;
      ctx.lineWidth = selected ? line * 2.4 : line;
      ctx.setLineDash(edge.kind === "program" ? [2 / t.k ** 0.5, 4 / t.k ** 0.5] : []);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const litNodes = new Set<string>();
    if (focusEdge || focusNode) {
      for (const e of graph.edges) if (lit(e)) litNodes.add(e.a).add(e.b);
      if (focusNode) litNodes.add(focusNode);
    }
    for (const n of graph.nodes) {
      const pos = positions.current.get(n.id);
      if (!pos) continue;
      const r = nodeRadius(n);
      const state = n.kind === "wallet" ? "MAPPED" : stateOf(n.id);
      ctx.globalAlpha = litNodes.size > 0 && !litNodes.has(n.id) ? 0.3 : 1;
      ctx.beginPath();
      if (n.kind === "program" || state === "INFRASTRUCTURE") ctx.roundRect(pos.x - r, pos.y - r, r * 2, r * 2, 4);
      else ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.kind === "wallet" ? p.fg : p.card;
      ctx.fill();
      ctx.lineWidth = n.id === selectedNode ? 3 : 1.5;
      ctx.strokeStyle = n.id === selectedNode ? p.fg : n.kind === "program" ? p.program : n.kind === "wallet" ? p.fg : p.muted;
      ctx.stroke();
      if (n.kind !== "wallet" && n.txCount > 0) {
        ctx.fillStyle = p.muted;
        ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(n.txCount), pos.x, pos.y);
      }
      const known = names.known(n.id);
      const label = known ?? names.of(n.id, 4);
      ctx.font = known || n.kind === "wallet" ? "500 11px ui-sans-serif, system-ui, sans-serif" : "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      // A halo in the background colour keeps labels readable over lines.
      ctx.lineJoin = "round";
      ctx.lineWidth = 4;
      ctx.strokeStyle = p.bg;
      ctx.strokeText(label, pos.x, pos.y + r + 4);
      ctx.fillStyle = known || n.kind === "wallet" ? p.fg : p.muted;
      ctx.fillText(label, pos.x, pos.y + r + 4);
    }
    ctx.globalAlpha = 1;
  }, [segments]);

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
      for (const sgm of segments()) {
        const d = distanceToSegment(w, sgm.from, sgm.to);
        if (d < tolerance && (!best || d < best.d)) best = { id: sgm.edge.id, d };
      }
      return best ? { edge: best.id } : {};
    },
    [segments, toWorld],
  );

  // Pan and zoom, except when the press starts on a node (that drags the node).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const behavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 4])
      .clickDistance(4)
      .filter((event: MouseEvent & TouchEvent) => {
        // Wheel and trackpad gestures are handled below (see graphWheelAction).
        if (event.type === "wheel") return false;
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

  // Pinch (or Ctrl/⌘ + wheel) zooms around the pointer; swipes and the plain wheel pan.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      const behavior = zoomRef.current;
      if (!behavior) return;
      event.preventDefault();
      const action = graphWheelAction(event);
      if (action.type === "zoom") {
        const rect = canvas.getBoundingClientRect();
        select(canvas).call(behavior.scaleBy, action.factor, [event.clientX - rect.left, event.clientY - rect.top]);
      } else {
        const k = transformRef.current.k;
        select(canvas).call(behavior.translateBy, -action.dx / k, -action.dy / k);
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

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
            // The count goes in a tooltip, never on the line itself.
            const edge = hit.edge ? latest.current.graph.edges.find((e) => e.id === hit.edge) : undefined;
            const n = edge?.interactions.length ?? 0;
            event.currentTarget.title = edge
              ? `${latest.current.names.of(edge.a)} ↔ ${latest.current.names.of(edge.b)} · ${n} ${edge.kind === "program" ? "program call" : "transaction"}${n === 1 ? "" : "s"} · click for details`
              : "";
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
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <Button
            variant={showPrograms ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={showPrograms}
            title="Program calls are separate from wallet-to-wallet interactions and hidden by default"
            onClick={onToggleProgramCalls}
          >
            <WorkflowIcon />
            Program calls
          </Button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border bg-popover/90 px-2.5 py-2 text-[11px] text-muted-foreground backdrop-blur">
        <span className="font-medium text-foreground">
          {graph.counts.addresses.toLocaleString()} addresses · {graph.counts.connections.toLocaleString()} connections ·{" "}
          {graph.counts.transactions.toLocaleString()} transactions
        </span>
        <Legend color="bg-muted-foreground">Interacted directly (one line per pair, any direction)</Legend>
        {showPrograms ? (
          <Legend color="border-t-2 border-dotted border-[oklch(0.7_0.14_250)] bg-transparent">Program called ({graph.counts.programConnections})</Legend>
        ) : (
          graph.counts.programConnections > 0 && <span>{graph.counts.programConnections.toLocaleString()} program connections hidden</span>
        )}
        <span className="pt-0.5">Click a line for its transactions · number in node: transactions · filled: mapped wallet</span>
        {graph.omittedNodes > 0 && <span>+{graph.omittedNodes.toLocaleString()} quieter addresses not drawn</span>}
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

