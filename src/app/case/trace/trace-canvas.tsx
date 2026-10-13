"use client";

import { select } from "d3-selection";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Names } from "@/lib/labels/labels";
import { graphWheelAction } from "@/lib/gestures";
import type { AddressState } from "@/lib/case/address-state";
import type { TraceStep } from "@/lib/trace/model";
import { snap, tidyLayout } from "@/lib/trace/layout";
import type { Point, TracePresentation } from "@/lib/trace/presentation";
import type { TraceEdge, TraceNode, TraceView } from "@/lib/trace/view";
import { onThemeChange, readPalette, sizeCanvas } from "../canvas";

const WIDTH = 180;
const HEIGHT = 64;
const GRID = 24;
type Selection = { nodes: string[]; edges: string[] };
type Drag = { kind: "nodes" | "marquee"; origin: Point; start: Record<string, Point>; moved: boolean };

const boundaryLabel: Record<string, string> = {
  history_not_loaded: "History not loaded", partial_history: "Partial history", outside_range: "Outside case range", custodial: "Custodial",
  ambiguous: "Ambiguous", failed: "Failed", left_supply: "Burned", entered_supply: "Minted", bridged_out: "Bridged out",
  bridged_in: "Bridged in", protocol_position: "Position", end_of_history: "End of history",
};

const nodeSize = (node: TraceNode, p: TracePresentation) => {
  const scale = p.nodeStyles[node.id]?.size === "s" ? 0.8 : p.nodeStyles[node.id]?.size === "l" ? 1.2 : 1;
  return { width: WIDTH * scale, height: HEIGHT * scale };
};

function edgeEnds(a: Point, b: Point, aw: number, bw: number, ah: number, bh: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const side = dx >= 0 ? 1 : -1;
  if (Math.abs(dx) >= Math.abs(dy)) return { from: { x: a.x + side * aw / 2, y: a.y }, to: { x: b.x - side * bw / 2, y: b.y } };
  const down = dy >= 0 ? 1 : -1;
  return { from: { x: a.x, y: a.y + down * ah / 2 }, to: { x: b.x, y: b.y - down * bh / 2 } };
}

export function TraceCanvas({ view, presentation, steps, names, stateOf, assetText, assetName, onMove, onOptions }: {
  view: TraceView; presentation: TracePresentation; steps: readonly TraceStep[]; names: Names;
  stateOf: (address: string) => AddressState;
  assetText: (assetId: string, amount: string) => string;
  assetName: (assetId: string) => string;
  onMove: (positions: Record<string, Point>) => void;
  onOptions: (options: Partial<TracePresentation["canvas"]>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const initialFitRef = useRef(false);
  const positionsRef = useRef<Record<string, Point>>(presentation.positions);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  const frameRef = useRef<number>(0);
  const drawRef = useRef<() => void>(() => {});
  const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [] });
  const [hover, setHover] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const [editFocus, setEditFocus] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const requestDraw = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => { frameRef.current = 0; drawRef.current(); });
  }, []);

  useEffect(() => { positionsRef.current = presentation.positions; requestDraw(); }, [presentation.positions, requestDraw]);
  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const resize = () => {
      const r = box.getBoundingClientRect();
      sizeCanvas(canvas, r.width, r.height);
      if (!initialFitRef.current && r.width > 0 && r.height > 0) {
        const points = view.nodes.map((n) => positionsRef.current[n.id]).filter((p): p is Point => !!p);
        if (points.length) {
          const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
          const left = Math.min(...xs) - 130, right = Math.max(...xs) + 130, top = Math.min(...ys) - 95, bottom = Math.max(...ys) + 95;
          const scale = Math.min(2, Math.max(0.2, Math.min(r.width / (right - left), r.height / (bottom - top))));
          transformRef.current = zoomIdentity.translate((r.width - scale * (left + right)) / 2, (r.height - scale * (top + bottom)) / 2).scale(scale);
          initialFitRef.current = true;
        }
      }
      setSize({ width: r.width, height: r.height });
      requestDraw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(box);
    resize();
    const offTheme = onThemeChange(requestDraw);
    return () => { observer.disconnect(); offTheme(); if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [requestDraw, view.nodes]);

  const stepById = new Map(steps.map((s) => [s.id, s]));
  const nodeById = new Map(view.nodes.map((n) => [n.id, n]));
  const stale = new Set(view.issues.filter((i) => i.kind === "stale").map((i) => i.stepId));
  const edgeLabel = (edge: TraceEdge) => {
    const amount = edge.totals.length === 1 ? assetText(edge.totals[0].assetId, edge.totals[0].amount) : `${edge.totals.length} assets`;
    const time = edge.lastTime === null ? "time unknown" : new Date(edge.lastTime).toISOString().slice(5, 16).replace("T", " ") + " UTC";
    const role = edge.steps.length === 1 ? stepById.get(edge.steps[0]) : null;
    const prefix = role?.kind === "movement" && ["royalty", "marketplace_fee", "rent", "unidentified"].includes(role.ref.role ?? "") ? `${role.ref.role?.replaceAll("_", " ")} · ` : "";
    return `${stale.size && edge.steps.some((id) => stale.has(id)) ? "⚠ " : ""}${prefix}${edge.steps.length > 1 ? `${edge.steps.length} movements · ` : ""}${amount}${edge.steps.length > 1 && edge.totals.length === 1 ? " total" : ""} · ${time}${edge.returns ? " · returns" : ""}`;
  };

  const draw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !size.width || !size.height) return;
    const palette = readPalette(canvas, { bg: "--background", fg: "--foreground", border: "--border", muted: "--muted-foreground", primary: "--primary", warn: "--destructive", accent: "--accent", red: "--color-red-500", orange: "--color-orange-500", yellow: "--color-yellow-500", green: "--color-green-500", teal: "--color-teal-500", blue: "--color-blue-500", purple: "--color-purple-500", pink: "--color-pink-500", gray: "--color-gray-500" });
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, size.width, size.height);
    const t = transformRef.current;
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    const minX = -t.x / t.k, maxX = (size.width - t.x) / t.k;
    const minY = -t.y / t.k, maxY = (size.height - t.y) / t.k;
    if (presentation.canvas.grid) {
      ctx.fillStyle = palette.border;
      for (let x = Math.floor(minX / GRID) * GRID; x < maxX; x += GRID) for (let y = Math.floor(minY / GRID) * GRID; y < maxY; y += GRID) {
        ctx.beginPath(); ctx.arc(x, y, 1 / t.k, 0, Math.PI * 2); ctx.fill();
      }
    }
    const positions = positionsRef.current;
    for (const edge of view.edges) {
      const a = positions[edge.from], b = positions[edge.to];
      if (!a || !b || (Math.max(a.x, b.x) < minX - 200 || Math.min(a.x, b.x) > maxX + 200 || Math.max(a.y, b.y) < minY - 100 || Math.min(a.y, b.y) > maxY + 100)) continue;
      const fromSize = nodeSize(nodeById.get(edge.from)!, presentation), toSize = nodeSize(nodeById.get(edge.to)!, presentation);
      const ends = edgeEnds(a, b, fromSize.width, toSize.width, fromSize.height, toSize.height);
      const x = (ends.from.x + ends.to.x) / 2, y = (ends.from.y + ends.to.y) / 2;
      const bend = edge.returns ? -28 : 0;
      const warn = edge.steps.some((id) => stale.has(id));
      const supporting = edge.steps.every((id) => { const s = stepById.get(id); return s?.kind === "movement" && ["royalty", "marketplace_fee", "rent", "unidentified"].includes(s.ref.role ?? ""); });
      ctx.strokeStyle = warn ? palette.warn : palette.primary;
      ctx.lineWidth = (selection.edges.includes(edge.id) ? 3 : supporting ? 1.25 : 2) / t.k;
      ctx.beginPath(); ctx.moveTo(ends.from.x, ends.from.y); ctx.quadraticCurveTo(x, y + bend, ends.to.x, ends.to.y); ctx.stroke();
      const angle = Math.atan2(ends.to.y - (y + bend), ends.to.x - x);
      const arrow = 10 / t.k;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.moveTo(ends.to.x, ends.to.y); ctx.lineTo(ends.to.x - arrow * Math.cos(angle - 0.55), ends.to.y - arrow * Math.sin(angle - 0.55)); ctx.lineTo(ends.to.x - arrow * Math.cos(angle + 0.55), ends.to.y - arrow * Math.sin(angle + 0.55)); ctx.closePath(); ctx.fill();
      if (t.k >= 0.65) {
        const label = edgeLabel(edge);
        ctx.font = `${12 / t.k}px sans-serif`;
        const w = ctx.measureText(label).width + 12 / t.k;
        ctx.fillStyle = palette.bg; ctx.fillRect(x - w / 2, y + bend / 2 - 15 / t.k, w, 18 / t.k);
        ctx.fillStyle = warn ? palette.warn : palette.fg; ctx.textAlign = "center"; ctx.fillText(label, x, y + bend / 2 - 2 / t.k);
      }
    }
    for (const node of view.nodes) {
      const p = positions[node.id];
      if (!p) continue;
      const { width, height } = nodeSize(node, presentation);
      if (p.x + width < minX || p.x - width > maxX || p.y + height < minY || p.y - height > maxY) continue;
      const key = presentation.nodeStyles[node.id]?.color ?? "default";
      const tint = key === "default" ? palette.accent : palette[key] || palette.accent;
      ctx.fillStyle = tint; ctx.globalAlpha = 0.2; ctx.beginPath(); ctx.roundRect(p.x - width / 2, p.y - height / 2, width, height, 10); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = selection.nodes.includes(node.id) ? palette.primary : node.isSeed ? palette.primary : tint;
      ctx.lineWidth = (selection.nodes.includes(node.id) || node.isSeed ? 3 : 1.5) / t.k; ctx.stroke();
      ctx.fillStyle = palette.fg; ctx.textAlign = "left"; ctx.font = `600 ${13 / t.k}px sans-serif`;
      const name = names.of(node.id);
      const max = Math.max(5, Math.floor((width - 24) / (8 / t.k)));
      ctx.fillText(name.length > max ? `${name.slice(0, max - 1)}…` : name, p.x - width / 2 + 12, p.y - 3 / t.k);
      if (presentation.nodeStyles[node.id]?.note) { ctx.textAlign = "right"; ctx.fillText("✎", p.x + width / 2 - 10, p.y - 3 / t.k); ctx.textAlign = "left"; }
      if (t.k >= 0.55) {
        ctx.fillStyle = palette.muted; ctx.font = `${11 / t.k}px sans-serif`;
        const state = stateOf(node.id);
        const sub = `${node.isSeed ? "Seed" : node.depth === null ? "Unconnected" : `${Math.abs(node.depth)} hop${Math.abs(node.depth) === 1 ? "" : "s"} ${node.depth < 0 ? "back" : "forward"}`} · ${state === "PRIMARY" || state === "MAPPED" ? "Mapped" : state === "OBSERVED" ? "Observed" : "Infrastructure"}`;
        ctx.fillText(sub, p.x - width / 2 + 12, p.y + 16 / t.k);
        if (node.boundaries.length || node.conversions.length) {
          const conversions = node.conversions.flatMap((id) => { const step = stepById.get(id); return step?.kind === "conversion" ? [`${step.spent.map((a) => assetName(a.assetId)).join(" + ")} → ${step.received.map((a) => assetName(a.assetId)).join(" + ")}`] : []; });
          const labels = [...node.boundaries.map((b) => boundaryLabel[b] ?? b), ...conversions];
          ctx.fillStyle = palette.warn; ctx.fillText(labels.join(" · "), p.x - width / 2 + 12, p.y + height / 2 + 16 / t.k);
        }
      }
    }
    if (marquee) {
      ctx.strokeStyle = palette.primary; ctx.setLineDash([5 / t.k, 3 / t.k]);
      ctx.strokeRect(Math.min(marquee.a.x, marquee.b.x), Math.min(marquee.a.y, marquee.b.y), Math.abs(marquee.b.x - marquee.a.x), Math.abs(marquee.b.y - marquee.a.y));
      ctx.setLineDash([]);
    }
  };
  useEffect(() => { drawRef.current = draw; requestDraw(); });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const behavior = zoom<HTMLCanvasElement, unknown>().scaleExtent([0.2, 4]).filter((event: MouseEvent | TouchEvent) => event.type.startsWith("touch") || (event instanceof MouseEvent && (event.button === 1 || spaceRef.current))).on("zoom", (event: { transform: ZoomTransform }) => { transformRef.current = event.transform; requestDraw(); });
    select(canvas).call(behavior).on("dblclick.zoom", null);
    zoomRef.current = behavior;
    select(canvas).call(behavior.transform, transformRef.current);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const action = graphWheelAction(event);
      if (action.type === "zoom") select(canvas).call(behavior.scaleBy, action.factor, [event.offsetX, event.offsetY]);
      else select(canvas).call(behavior.translateBy, -action.dx / transformRef.current.k, -action.dy / transformRef.current.k);
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => { canvas.removeEventListener("wheel", wheel); select(canvas).on(".zoom", null); zoomRef.current = null; };
  }, [requestDraw]);

  const world = (event: { clientX: number; clientY: number }): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    const [x, y] = transformRef.current.invert([event.clientX - r.left, event.clientY - r.top]);
    return { x, y };
  };
  const nodeAt = (p: Point) => [...view.nodes].reverse().find((n) => {
    const q = positionsRef.current[n.id], s = nodeSize(n, presentation);
    return q && Math.abs(p.x - q.x) <= s.width / 2 && Math.abs(p.y - q.y) <= s.height / 2;
  });
  const edgeAt = (p: Point) => view.edges.find((e) => {
    const a = positionsRef.current[e.from], b = positionsRef.current[e.to];
    if (!a || !b) return false;
    const fromSize = nodeSize(nodeById.get(e.from)!, presentation), toSize = nodeSize(nodeById.get(e.to)!, presentation);
    const ends = edgeEnds(a, b, fromSize.width, toSize.width, fromSize.height, toSize.height);
    const control = { x: (ends.from.x + ends.to.x) / 2, y: (ends.from.y + ends.to.y) / 2 + (e.returns ? -28 : 0) };
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, u = 1 - t;
      const q = { x: u * u * ends.from.x + 2 * u * t * control.x + t * t * ends.to.x, y: u * u * ends.from.y + 2 * u * t * control.y + t * t * ends.to.y };
      if (Math.hypot(p.x - q.x, p.y - q.y) < 10 / transformRef.current.k) return true;
    }
    return false;
  });
  const fit = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const points = [...view.nodes.map((n) => positionsRef.current[n.id]).filter((p): p is Point => !!p), ...presentation.annotations.flatMap((a) => "at" in a ? [a.at] : [])];
    if (!points.length) return;
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const left = Math.min(...xs) - 130, right = Math.max(...xs) + 130, top = Math.min(...ys) - 95, bottom = Math.max(...ys) + 95;
    const scale = Math.min(2, Math.max(0.2, Math.min(size.width / (right - left), size.height / (bottom - top))));
    const t = zoomIdentity.translate((size.width - scale * (left + right)) / 2, (size.height - scale * (top + bottom)) / 2).scale(scale);
    if (zoomRef.current) select(canvas).call(zoomRef.current.transform, t);
    requestDraw();
  };
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "touch" || event.button !== 0 || spaceRef.current) return;
    const p = world(event);
    const node = nodeAt(p);
    if (node) {
      const nodes = event.shiftKey ? selection.nodes.includes(node.id) ? selection.nodes.filter((id) => id !== node.id) : [...selection.nodes, node.id] : selection.nodes.includes(node.id) ? selection.nodes : [node.id];
      setSelection({ nodes, edges: [] });
      dragRef.current = { kind: "nodes", origin: p, start: Object.fromEntries(nodes.map((id) => [id, positionsRef.current[id]])), moved: false };
    } else {
      const edge = edgeAt(p);
      if (edge) setSelection({ nodes: [], edges: [edge.id] });
      else { if (!event.shiftKey) setSelection({ nodes: [], edges: [] }); dragRef.current = { kind: "marquee", origin: p, start: {}, moved: false }; }
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    requestDraw();
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "touch") return;
    const p = world(event), drag = dragRef.current;
    if (!drag) { const item = nodeAt(p)?.id ?? edgeAt(p)?.id ?? null; if (item !== hover) setHover(item); return; }
    if (Math.hypot(p.x - drag.origin.x, p.y - drag.origin.y) > 2) drag.moved = true;
    if (drag.kind === "nodes") {
      for (const [id, at] of Object.entries(drag.start)) positionsRef.current[id] = { x: at.x + p.x - drag.origin.x, y: at.y + p.y - drag.origin.y };
    } else setMarquee({ a: drag.origin, b: p });
    requestDraw();
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "nodes" && drag.moved) {
      const moved = Object.fromEntries(Object.keys(drag.start).map((id) => [id, presentation.canvas.snap ? snap(positionsRef.current[id], GRID) : positionsRef.current[id]]));
      Object.assign(positionsRef.current, moved);
      onMove(moved);
    } else if (drag.kind === "marquee" && drag.moved) {
      const p = world(event), a = drag.origin;
      const nodes = view.nodes.filter((n) => { const q = positionsRef.current[n.id]; return q && q.x >= Math.min(a.x, p.x) && q.x <= Math.max(a.x, p.x) && q.y >= Math.min(a.y, p.y) && q.y <= Math.max(a.y, p.y); }).map((n) => n.id);
      setSelection({ nodes: event.shiftKey ? [...new Set([...selection.nodes, ...nodes])] : nodes, edges: [] });
    }
    dragRef.current = null; setMarquee(null); requestDraw();
  };
  const onPointerCancel = () => {
    const drag = dragRef.current;
    if (drag?.kind === "nodes") Object.assign(positionsRef.current, drag.start);
    dragRef.current = null; setMarquee(null); requestDraw();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === " ") { spaceRef.current = true; event.preventDefault(); return; }
    if (event.key.toLowerCase() === "f") { fit(); event.preventDefault(); return; }
    if (event.key === "0") { if (canvasRef.current && zoomRef.current) select(canvasRef.current).call(zoomRef.current.transform, zoomIdentity); event.preventDefault(); return; }
    if (!event.key.startsWith("Arrow") || !selection.nodes.length) return;
    event.preventDefault();
    if (editFocus) {
      const delta = event.shiftKey ? 10 : 1;
      const dx = event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0;
      const dy = event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0;
      const moved = Object.fromEntries(selection.nodes.map((id) => [id, { x: positionsRef.current[id].x + dx, y: positionsRef.current[id].y + dy }]));
      Object.assign(positionsRef.current, moved); onMove(moved); requestDraw(); return;
    }
    const current = selection.nodes[0];
    const adjacent = event.key === "ArrowRight" ? view.edges.filter((e) => e.from === current).map((e) => e.to) : event.key === "ArrowLeft" ? view.edges.filter((e) => e.to === current).map((e) => e.from) : view.nodes.filter((n) => n.id !== current && (event.key === "ArrowUp" ? positionsRef.current[n.id]?.y < positionsRef.current[current]?.y : positionsRef.current[n.id]?.y > positionsRef.current[current]?.y)).map((n) => n.id);
    const next = adjacent.filter((id) => positionsRef.current[id]).sort((a, b) => Math.hypot(positionsRef.current[a].x - positionsRef.current[current].x, positionsRef.current[a].y - positionsRef.current[current].y) - Math.hypot(positionsRef.current[b].x - positionsRef.current[current].x, positionsRef.current[b].y - positionsRef.current[current].y))[0];
    if (next) setSelection({ nodes: [next], edges: [] });
  };

  return (
    <div ref={boxRef} className="relative min-h-0 flex-1 overflow-hidden rounded-md border" aria-label="Trace graph canvas">
      <canvas ref={canvasRef} className="block h-full w-full touch-none outline-none" tabIndex={0} aria-label="Trace graph. Select nodes with click or arrow keys; press F to fit." onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onKeyDown={onKeyDown} onKeyUp={(e) => { if (e.key === " ") spaceRef.current = false; }} onBlur={() => { spaceRef.current = false; }} />
      <div className="absolute left-3 top-3 flex flex-wrap gap-1 rounded-md border bg-background/95 p-1 text-xs">
        <button type="button" className="rounded px-2 py-1 hover:bg-accent" onClick={fit}>Fit</button>
        <button type="button" className="rounded px-2 py-1 hover:bg-accent" onClick={() => { const placed = tidyLayout({ view, positions: positionsRef.current, obstacles: [], grid: presentation.canvas.snap ? GRID : null }); Object.assign(positionsRef.current, placed); onMove(placed); requestDraw(); }}>Tidy layout</button>
        <button type="button" className="rounded px-2 py-1 hover:bg-accent" aria-pressed={presentation.canvas.grid} onClick={() => onOptions({ grid: !presentation.canvas.grid })}>Grid</button>
        <button type="button" className="rounded px-2 py-1 hover:bg-accent" aria-pressed={presentation.canvas.snap} onClick={() => onOptions({ snap: !presentation.canvas.snap })}>Snap</button>
        <button type="button" className="rounded px-2 py-1 hover:bg-accent" aria-pressed={editFocus} onClick={() => setEditFocus(!editFocus)}>Nudge mode</button>
      </div>
      {hover && <p className="pointer-events-none absolute bottom-12 left-3 max-w-sm rounded border bg-background p-2 text-xs shadow">{nodeById.has(hover) ? `${names.of(hover)} · ${hover}` : edgeLabel(view.edges.find((e) => e.id === hover)!)}</p>}
      <p className="absolute bottom-2 left-3 rounded bg-background/95 px-2 py-1 text-xs text-muted-foreground">Observed movements in time order. Lines don&apos;t show that the same funds moved.</p>
      <p className="sr-only" aria-live="polite">{selection.nodes.length ? selection.nodes.map((id) => `${names.of(id)}, ${nodeById.get(id)?.depth ?? "unknown"} hops`).join("; ") : selection.edges.length ? `Movement ${selection.edges[0]}` : "No selection"}</p>
      {view.nodes.length === 1 && view.edges.length === 0 && <p className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 rounded bg-background/90 p-3 text-sm text-muted-foreground">Add a movement to start tracing.</p>}
    </div>
  );
}
