"use client";

import { select } from "d3-selection";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import { useCallback, useEffect, useRef, useState } from "react";
import { branchDirection, focusPath, type HiddenBranches } from "@/lib/trace/branches";
import { annotationBox, connectorPoints, contains, distanceToSegment, handleAt, resizeBox, HANDLES, type Handle } from "@/lib/trace/geometry";
import type { Names } from "@/lib/labels/labels";
import { graphWheelAction } from "@/lib/gestures";
import type { AddressState } from "@/lib/case/address-state";
import type { TraceStep } from "@/lib/trace/model";
import { snap, tidyLayout } from "@/lib/trace/layout";
import { COLOR_KEYS, type Annotation, type AnnotationEnd, type ColorKey, type NodeStyle, type Point, type TracePresentation } from "@/lib/trace/presentation";
import type { TraceEdge, TraceNode, TraceView } from "@/lib/trace/view";
import { onThemeChange, readPalette, sizeCanvas } from "../canvas";

const WIDTH = 180;
const HEIGHT = 64;
const GRID = 24;
export type TraceSelection = { nodes: string[]; edges: string[]; annotations: string[] };
type Drag = { kind: "nodes" | "marquee" | "annotation" | "resize" | "connector-end" | "create"; origin: Point; start: Record<string, Point>; moved: boolean; annotation?: Annotation; handle?: Handle; end?: "from" | "to"; from?: AnnotationEnd };
type Tool = "select" | "note" | "rect" | "ellipse" | "frame" | "connector";

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

export function TraceCanvas({ onCanvas, initialSelection, initialTransform, onTransform, view, hidden, onBranchHidden, presentation, steps, names, stateOf, assetText, assetName, onMove, onOptions, onSelection, onCandidateDirection, onStartAtNode, onMapWallet, onRemoveEvidence, onAddAnnotation, onUpdateAnnotation, onRemoveAnnotations, onReorderAnnotation, onNodeStyle }: {
  /** Receives the canvas element, for snapshots. */
  onCanvas?: (canvas: HTMLCanvasElement | null) => void;
  /** Restored when returning to this trace from another view. */
  initialSelection?: TraceSelection; initialTransform?: { x: number; y: number; k: number }; onTransform?: (t: { x: number; y: number; k: number }) => void;
  view: TraceView; hidden: Pick<HiddenBranches, "counts" | "anchors">; onBranchHidden: (id: string, hidden: boolean) => void; presentation: TracePresentation; steps: readonly TraceStep[]; names: Names;
  stateOf: (address: string) => AddressState;
  assetText: (assetId: string, amount: string) => string;
  assetName: (assetId: string) => string;
  onMove: (positions: Record<string, Point>, annotations?: { id: string; patch: Partial<Annotation> }[]) => void;
  onOptions: (options: Partial<TracePresentation["canvas"]>) => void;
  onSelection: (selection: TraceSelection) => void;
  onCandidateDirection: (direction: "forward" | "backward") => void;
  onStartAtNode: (address: string) => void;
  onMapWallet: (address: string) => void;
  onRemoveEvidence: (ids: Set<string>) => void;
  onAddAnnotation: (item: Annotation) => void;
  onUpdateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  onRemoveAnnotations: (ids: Set<string>) => void;
  onReorderAnnotation: (id: string, order: "front" | "back") => void;
  onNodeStyle: (id: string, style: NodeStyle) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ZoomTransform>(initialTransform ? zoomIdentity.translate(initialTransform.x, initialTransform.y).scale(initialTransform.k) : zoomIdentity);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const initialFitRef = useRef(Boolean(initialTransform));
  const positionsRef = useRef<Record<string, Point>>(presentation.positions);
  const dragRef = useRef<Drag | null>(null);
  const draftRef = useRef<Annotation | null>(null);
  const cancelEditRef = useRef(false);
  const spaceRef = useRef(false);
  const frameRef = useRef<number>(0);
  const drawRef = useRef<() => void>(() => {});
  useEffect(() => { onCanvas?.(canvasRef.current); return () => onCanvas?.(null); }, [onCanvas]);
  const onTransformRef = useRef(onTransform);
  useEffect(() => { onTransformRef.current = onTransform; });
  const [selection, setSelection] = useState<TraceSelection>(initialSelection ?? { nodes: [], edges: [], annotations: [] });
  const [tool, setTool] = useState<Tool>("select");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editScreen, setEditScreen] = useState<Point | null>(null);
  const choose = (value: TraceSelection) => { setSelection(value); onSelection(value); };
  const [hover, setHover] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ kind: "node" | "edge"; id: string; x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const [editFocus, setEditFocus] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** Ephemeral (unsaved): the node whose path from the seed is in focus. */
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  /** "N movements hidden" chips, in world coordinates, from the last draw. */
  const chipsRef = useRef<{ id: string; x: number; y: number; width: number; height: number }[]>([]);
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
    return () => { observer.disconnect(); offTheme(); if (frameRef.current) { cancelAnimationFrame(frameRef.current); frameRef.current = 0; } };
  }, [requestDraw, view.nodes]);

  const stepById = new Map(steps.map((s) => [s.id, s]));
  const nodeById = new Map(view.nodes.map((n) => [n.id, n]));
  const focus = focusTarget && nodeById.has(focusTarget) ? focusPath(view, focusTarget) : null;
  const anchorId = (id: string) => nodeById.has(id) ? id : hidden.anchors.has(id) ? hidden.anchors.get(id)! : id.startsWith("entity:") ? view.nodes.find((node) => node.memberServiceId === id.slice(7))?.id ?? id : id;
  const connectorLayout = (annotations = presentation.annotations): TracePresentation => {
    const positions = { ...positionsRef.current };
    for (const item of annotations) if (item.kind === "connector") for (const end of [item.from, item.to]) if (end.kind === "node" && !nodeById.has(end.id)) {
      const at = positions[anchorId(end.id)];
      if (at) positions[end.id] = at;
    }
    return { ...presentation, positions, annotations };
  };
  const connectorBox = (id: string) => {
    const actual = anchorId(id), node = nodeById.get(actual), at = positionsRef.current[actual];
    if (!node || !at) return null;
    const size = nodeSize(node, presentation);
    return { x: at.x - size.width / 2, y: at.y - size.height / 2, width: size.width, height: size.height };
  };
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
    const annotations = presentation.annotations.map((item) => draftRef.current?.id === item.id ? draftRef.current : item);
    const drawing = connectorLayout(annotations);
    for (const annotation of annotations) {
      if (annotation.kind === "note") continue;
      const color = annotation.kind === "connector" ? annotation.color : annotation.stroke;
      ctx.strokeStyle = color === "default" ? palette.muted : palette[color];
      ctx.lineWidth = (selection.annotations.includes(annotation.id) ? 3 : 1.5) / t.k;
      if (annotation.kind === "connector") {
        const points = connectorPoints(annotation, drawing, connectorBox);
        if (!points) continue;
        ctx.setLineDash([6 / t.k, 4 / t.k]);
        ctx.beginPath(); ctx.moveTo(points.from.x, points.from.y); ctx.lineTo(points.to.x, points.to.y); ctx.stroke(); ctx.setLineDash([]);
        const arrow = (at: Point, from: Point) => { const angle = Math.atan2(at.y - from.y, at.x - from.x), size = 9 / t.k; ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineTo(at.x - size * Math.cos(angle - 0.5), at.y - size * Math.sin(angle - 0.5)); ctx.lineTo(at.x - size * Math.cos(angle + 0.5), at.y - size * Math.sin(angle + 0.5)); ctx.stroke(); };
        if (annotation.arrow === "end" || annotation.arrow === "both") arrow(points.to, points.from);
        if (annotation.arrow === "both") arrow(points.from, points.to);
        if (annotation.label && t.k >= 0.5) { ctx.fillStyle = palette.bg; ctx.font = `${12 / t.k}px sans-serif`; ctx.textAlign = "center"; const mid = { x: (points.from.x + points.to.x) / 2, y: (points.from.y + points.to.y) / 2 }; ctx.fillRect(mid.x - ctx.measureText(annotation.label).width / 2 - 5 / t.k, mid.y - 12 / t.k, ctx.measureText(annotation.label).width + 10 / t.k, 17 / t.k); ctx.fillStyle = ctx.strokeStyle; ctx.fillText(annotation.label, mid.x, mid.y); }
        continue;
      }
      const box = annotationBox(annotation)!;
      if (annotation.fill !== "none") { ctx.globalAlpha = 0.15; ctx.fillStyle = annotation.fill === "default" ? palette.accent : palette[annotation.fill]; if (annotation.shape === "ellipse") { ctx.beginPath(); ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(box.x, box.y, box.width, box.height); ctx.globalAlpha = 1; }
      if (annotation.shape === "frame") ctx.setLineDash([7 / t.k, 4 / t.k]);
      ctx.beginPath(); if (annotation.shape === "ellipse") ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2); else ctx.rect(box.x, box.y, box.width, box.height); ctx.stroke(); ctx.setLineDash([]);
      if (annotation.label) { ctx.fillStyle = palette.fg; ctx.font = `${12 / t.k}px sans-serif`; ctx.textAlign = "left"; ctx.fillText(annotation.label, box.x + 5 / t.k, box.y + 16 / t.k); }
    }
    for (const edge of view.edges) {
      const a = positions[edge.from], b = positions[edge.to];
      if (!a || !b || (Math.max(a.x, b.x) < minX - 200 || Math.min(a.x, b.x) > maxX + 200 || Math.max(a.y, b.y) < minY - 100 || Math.min(a.y, b.y) > maxY + 100)) continue;
      const fromSize = nodeSize(nodeById.get(edge.from)!, presentation), toSize = nodeSize(nodeById.get(edge.to)!, presentation);
      const ends = edgeEnds(a, b, fromSize.width, toSize.width, fromSize.height, toSize.height);
      const x = (ends.from.x + ends.to.x) / 2, y = (ends.from.y + ends.to.y) / 2;
      const bend = edge.returns ? -28 : 0;
      const warn = edge.steps.some((id) => stale.has(id));
      const supporting = edge.steps.every((id) => { const s = stepById.get(id); return s?.kind === "movement" && ["royalty", "marketplace_fee", "rent", "unidentified"].includes(s.ref.role ?? ""); });
      ctx.globalAlpha = focus && !focus.edges.has(edge.id) ? 0.2 : 1;
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
      ctx.globalAlpha = 1;
    }
    chipsRef.current = [];
    for (const node of view.nodes) {
      const p = positions[node.id];
      if (!p) continue;
      const { width, height } = nodeSize(node, presentation);
      if (p.x + width < minX || p.x - width > maxX || p.y + height < minY || p.y - height > maxY) continue;
      const key = presentation.nodeStyles[node.id]?.color ?? "default";
      const tint = key === "default" ? palette.accent : palette[key] || palette.accent;
      const alpha = focus && !focus.nodes.has(node.id) ? 0.25 : 1;
      ctx.fillStyle = tint; ctx.globalAlpha = 0.2 * alpha; ctx.beginPath(); ctx.roundRect(p.x - width / 2, p.y - height / 2, width, height, 10); ctx.fill(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = selection.nodes.includes(node.id) ? palette.primary : node.isSeed ? palette.primary : tint;
      ctx.lineWidth = (selection.nodes.includes(node.id) || node.isSeed ? 3 : 1.5) / t.k; ctx.stroke();
      ctx.fillStyle = palette.fg; ctx.textAlign = "left"; ctx.font = `600 ${13 / t.k}px sans-serif`;
      const name = node.service?.name ?? names.of(node.id);
      const max = Math.max(5, Math.floor((width - 24) / (8 / t.k)));
      ctx.fillText(name.length > max ? `${name.slice(0, max - 1)}…` : name, p.x - width / 2 + 12, p.y - 3 / t.k);
      if (presentation.nodeStyles[node.id]?.note) { ctx.textAlign = "right"; ctx.fillText("✎", p.x + width / 2 - 10, p.y - 3 / t.k); ctx.textAlign = "left"; }
      if (t.k >= 0.55) {
        ctx.fillStyle = palette.muted; ctx.font = `${11 / t.k}px sans-serif`;
        const state = stateOf(node.id);
        const sub = node.service ? `${node.service.category} · ${node.addresses.length} addresses` : `${node.isSeed ? "Seed" : node.depth === null ? "Unconnected" : `${Math.abs(node.depth)} hop${Math.abs(node.depth) === 1 ? "" : "s"} ${node.depth < 0 ? "back" : "forward"}`} · ${state === "PRIMARY" || state === "MAPPED" ? "Mapped" : state === "OBSERVED" ? "Observed" : "Infrastructure"}`;
        ctx.fillText(sub, p.x - width / 2 + 12, p.y + 16 / t.k);
        if (node.boundaries.length || node.conversions.length || node.internalMovements?.length) {
          const conversions = node.conversions.flatMap((id) => { const step = stepById.get(id); return step?.kind === "conversion" ? [`${step.spent.map((a) => assetName(a.assetId)).join(" + ")} → ${step.received.map((a) => assetName(a.assetId)).join(" + ")}`] : []; });
          const labels = [...node.boundaries.map((b) => boundaryLabel[b] ?? b), ...conversions, ...(node.internalMovements?.length ? [`${node.internalMovements.length} internal movement${node.internalMovements.length === 1 ? "" : "s"}`] : [])];
          ctx.fillStyle = palette.warn; ctx.fillText(labels.join(" · "), p.x - width / 2 + 12, p.y + height / 2 + 16 / t.k);
        }
      }
      const count = hidden.counts.get(node.id);
      if (count !== undefined) {
        const text = `${count} movement${count === 1 ? "" : "s"} hidden ▸`;
        ctx.font = `${11 / t.k}px sans-serif`;
        const w = ctx.measureText(text).width + 12 / t.k;
        // Beside the node, on the side its hidden branch continues.
        const chip = { id: node.id, x: (node.depth ?? 0) < 0 ? p.x - width / 2 - w - 8 / t.k : p.x + width / 2 + 8 / t.k, y: p.y - 9 / t.k, width: w, height: 18 / t.k };
        ctx.fillStyle = palette.bg; ctx.strokeStyle = palette.primary; ctx.lineWidth = 1 / t.k;
        ctx.beginPath(); ctx.roundRect(chip.x, chip.y, chip.width, chip.height, 6 / t.k); ctx.fill(); ctx.stroke();
        ctx.fillStyle = palette.fg; ctx.textAlign = "left"; ctx.fillText(text, chip.x + 6 / t.k, chip.y + 13 / t.k);
        chipsRef.current.push(chip);
      }
      ctx.globalAlpha = 1;
    }
    for (const annotation of annotations) {
      if (annotation.kind !== "note") continue;
      const box = annotationBox(annotation)!;
      ctx.fillStyle = annotation.color === "default" ? palette.accent : palette[annotation.color]; ctx.globalAlpha = 0.25; ctx.fillRect(box.x, box.y, box.width, box.height); ctx.globalAlpha = 1;
      ctx.strokeStyle = selection.annotations.includes(annotation.id) ? palette.primary : palette.muted; ctx.lineWidth = 2 / t.k; ctx.strokeRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = palette.fg; ctx.font = `${13 / t.k}px sans-serif`; ctx.textAlign = "left";
      const lines = annotation.text.match(new RegExp(`.{1,${Math.max(12, Math.floor(box.width / 8))}}`, "g")) ?? [];
      lines.slice(0, Math.floor((box.height - 16) / 16)).forEach((line, i) => ctx.fillText(line, box.x + 8, box.y + 20 + i * 16));
    }
    const active = annotations.find((item) => item.id === selection.annotations[0]);
    const box = active && annotationBox(active);
    if (box) { ctx.fillStyle = palette.primary; for (const handle of HANDLES) { const p = handle === "nw" ? [box.x, box.y] : handle === "n" ? [box.x + box.width / 2, box.y] : handle === "ne" ? [box.x + box.width, box.y] : handle === "e" ? [box.x + box.width, box.y + box.height / 2] : handle === "se" ? [box.x + box.width, box.y + box.height] : handle === "s" ? [box.x + box.width / 2, box.y + box.height] : handle === "sw" ? [box.x, box.y + box.height] : [box.x, box.y + box.height / 2]; ctx.fillRect(p[0] - 4 / t.k, p[1] - 4 / t.k, 8 / t.k, 8 / t.k); } }
    if (active?.kind === "connector") { const points = connectorPoints(active, drawing, connectorBox); if (points) { ctx.fillStyle = palette.primary; for (const p of [points.from, points.to]) ctx.fillRect(p.x - 5 / t.k, p.y - 5 / t.k, 10 / t.k, 10 / t.k); } }
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
    const behavior = zoom<HTMLCanvasElement, unknown>().scaleExtent([0.2, 4]).filter((event: MouseEvent | TouchEvent) => event.type.startsWith("touch") || (event instanceof MouseEvent && (event.button === 1 || spaceRef.current))).on("zoom", (event: { transform: ZoomTransform }) => { transformRef.current = event.transform; requestDraw(); })
      .on("end", (event: { transform: ZoomTransform }) => { const { x, y, k } = event.transform; onTransformRef.current?.({ x, y, k }); });
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
  const annotationAt = (p: Point) => [...presentation.annotations].reverse().find((item) => {
    if (item.kind !== "connector") {
      const box = annotationBox(item)!;
      if (item.kind === "note" || item.fill !== "none") return contains(box, p);
      return contains(box, p) && (Math.min(Math.abs(p.x - box.x), Math.abs(p.x - box.x - box.width), Math.abs(p.y - box.y), Math.abs(p.y - box.y - box.height)) < 8 / transformRef.current.k || item.shape === "frame" && p.y < box.y + 24);
    }
    const points = connectorPoints(item, connectorLayout(), connectorBox);
    return points && distanceToSegment(p, points.from, points.to) < 8 / transformRef.current.k;
  });
  const endAt = (p: Point): AnnotationEnd => {
    const node = nodeAt(p); if (node) return { kind: "node", id: node.id };
    const item = annotationAt(p); return item && item.kind !== "connector" ? { kind: "annotation", id: item.id } : { kind: "point", at: p };
  };
  const fit = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const points = [...view.nodes.map((n) => positionsRef.current[n.id]).filter((p): p is Point => !!p), ...presentation.annotations.flatMap((item) => {
      if (item.kind === "connector") { const ends = connectorPoints(item, connectorLayout(), connectorBox); return ends ? [ends.from, ends.to] : []; }
      const box = annotationBox(item)!;
      return [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height }];
    })];
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
    setMenu(null);
    const p = world(event);
    const chip = chipsRef.current.find((c) => contains(c, p));
    if (tool === "select" && chip) { onBranchHidden(chip.id, false); return; }
    if (tool !== "select") {
      dragRef.current = { kind: "create", origin: p, start: {}, moved: false, from: tool === "connector" ? endAt(p) : undefined };
      event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    const active = presentation.annotations.find((item) => item.id === selection.annotations[0]);
    if (active?.kind === "connector") {
      const points = connectorPoints(active, connectorLayout(), connectorBox);
      const end = points && (Math.hypot(points.from.x - p.x, points.from.y - p.y) <= 8 / transformRef.current.k ? "from" : Math.hypot(points.to.x - p.x, points.to.y - p.y) <= 8 / transformRef.current.k ? "to" : null);
      if (end) { dragRef.current = { kind: "connector-end", origin: p, start: {}, moved: false, annotation: active, end }; event.currentTarget.setPointerCapture(event.pointerId); return; }
    }
    const activeBox = active && annotationBox(active);
    const handle = activeBox ? handleAt(activeBox, p, 8 / transformRef.current.k) : null;
    if (active && handle) {
      dragRef.current = { kind: "resize", origin: p, start: {}, moved: false, annotation: active, handle };
      event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    const note = [...presentation.annotations].reverse().find((item) => item.kind === "note" && contains(annotationBox(item)!, p));
    const annotation = note ?? annotationAt(p);
    const node = nodeAt(p);
    if (annotation && (annotation.kind === "note" || !node)) {
      choose({ nodes: [], edges: [], annotations: [annotation.id] });
      dragRef.current = { kind: "annotation", origin: p, start: {}, moved: false, annotation };
    } else if (node) {
      const nodes = event.shiftKey ? selection.nodes.includes(node.id) ? selection.nodes.filter((id) => id !== node.id) : [...selection.nodes, node.id] : selection.nodes.includes(node.id) ? selection.nodes : [node.id];
      choose({ nodes, edges: [], annotations: [] });
      dragRef.current = { kind: "nodes", origin: p, start: Object.fromEntries(nodes.map((id) => [id, positionsRef.current[id]])), moved: false };
    } else {
      const edge = edgeAt(p);
      if (edge) choose({ nodes: [], edges: [edge.id], annotations: [] });
      else { if (!event.shiftKey) choose({ nodes: [], edges: [], annotations: [] }); dragRef.current = { kind: "marquee", origin: p, start: {}, moved: false }; }
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
    } else if ((drag.kind === "annotation" || drag.kind === "resize" || drag.kind === "connector-end") && drag.annotation) {
      const item = drag.annotation, delta = { x: p.x - drag.origin.x, y: p.y - drag.origin.y };
      if (drag.kind === "connector-end" && item.kind === "connector") draftRef.current = { ...item, [drag.end!]: endAt(p) };
      else if (drag.kind === "resize" && item.kind !== "connector") {
        const box = resizeBox(annotationBox(item)!, drag.handle!, delta, event.shiftKey);
        draftRef.current = { ...item, at: { x: box.x, y: box.y }, width: box.width, ...(item.kind === "shape" ? { height: box.height } : {}) } as Annotation;
      } else if (item.kind !== "connector") draftRef.current = { ...item, at: { x: item.at.x + delta.x, y: item.at.y + delta.y } };
      else {
        const points = connectorPoints(item, connectorLayout(), connectorBox);
        if (points) draftRef.current = { ...item, from: { kind: "point", at: { x: points.from.x + delta.x, y: points.from.y + delta.y } }, to: { kind: "point", at: { x: points.to.x + delta.x, y: points.to.y + delta.y } } };
      }
    } else if (drag.kind === "marquee" || drag.kind === "create") setMarquee({ a: drag.origin, b: p });
    requestDraw();
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "nodes" && drag.moved) {
      const moved = Object.fromEntries(Object.keys(drag.start).map((id) => [id, presentation.canvas.snap ? snap(positionsRef.current[id], GRID) : positionsRef.current[id]]));
      Object.assign(positionsRef.current, moved);
      onMove(moved);
    } else if ((drag.kind === "annotation" || drag.kind === "resize" || drag.kind === "connector-end") && drag.moved && drag.annotation && draftRef.current) {
      const original = drag.annotation, draft = draftRef.current;
      const patch: Partial<Annotation> = draft.kind === "connector" ? { from: draft.from, to: draft.to } : { at: presentation.canvas.snap ? snap(draft.at, GRID) : draft.at, width: draft.width, ...(draft.kind === "shape" ? { height: draft.height } : {}) };
      if (original.kind === "shape" && original.shape === "frame" && draft.kind === "shape" && drag.kind === "annotation") {
        const box = annotationBox(original)!, delta = { x: draft.at.x - original.at.x, y: draft.at.y - original.at.y };
        const moved = Object.fromEntries(view.nodes.filter((node) => positionsRef.current[node.id] && contains(box, positionsRef.current[node.id])).map((node) => [node.id, { x: positionsRef.current[node.id].x + delta.x, y: positionsRef.current[node.id].y + delta.y }]));
        Object.assign(positionsRef.current, moved);
        const patches = presentation.annotations.filter((item): item is Exclude<Annotation, { kind: "connector" }> => item.id !== original.id && item.kind !== "connector").filter((item) => contains(box, { x: item.at.x + item.width / 2, y: item.at.y + (item.kind === "shape" ? item.height / 2 : 36) })).map((item) => ({ id: item.id, patch: { at: { x: item.at.x + delta.x, y: item.at.y + delta.y } } }));
        onMove(moved, [{ id: original.id, patch }, ...patches]);
      } else onUpdateAnnotation(original.id, patch);
    } else if (drag.kind === "create") {
      const p = world(event), id = crypto.randomUUID();
      if (tool === "connector") onAddAnnotation({ id, kind: "connector", from: drag.from ?? { kind: "point", at: drag.origin }, to: endAt(p), label: "", arrow: "none", color: "gray" });
      else if (tool === "note") onAddAnnotation({ id, kind: "note", at: p, width: 200, text: "", color: "yellow" });
      else { const x = Math.min(drag.origin.x, p.x), y = Math.min(drag.origin.y, p.y); onAddAnnotation({ id, kind: "shape", shape: tool === "rect" ? "rect" : tool === "ellipse" ? "ellipse" : "frame", at: { x, y }, width: Math.max(80, Math.abs(p.x - drag.origin.x)), height: Math.max(48, Math.abs(p.y - drag.origin.y)), label: "", stroke: "gray", fill: "none" }); }
      choose({ nodes: [], edges: [], annotations: [id] });
      if (!event.shiftKey) setTool("select");
      if (tool === "note") { cancelEditRef.current = false; setEditing(id); setEditText(""); setEditScreen({ x: transformRef.current.applyX(p.x), y: transformRef.current.applyY(p.y) }); }
    } else if (drag.kind === "marquee" && drag.moved) {
      const p = world(event), a = drag.origin;
      const nodes = view.nodes.filter((n) => { const q = positionsRef.current[n.id]; return q && q.x >= Math.min(a.x, p.x) && q.x <= Math.max(a.x, p.x) && q.y >= Math.min(a.y, p.y) && q.y <= Math.max(a.y, p.y); }).map((n) => n.id);
      choose({ nodes: event.shiftKey ? [...new Set([...selection.nodes, ...nodes])] : nodes, edges: [], annotations: [] });
    }
    dragRef.current = null; draftRef.current = null; setMarquee(null); requestDraw();
  };
  const onPointerCancel = () => {
    const drag = dragRef.current;
    if (drag?.kind === "nodes") Object.assign(positionsRef.current, drag.start);
    dragRef.current = null; draftRef.current = null; setMarquee(null); requestDraw();
  };
  const beginEdit = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const item = annotationAt(world(event));
    if (!item) return;
    showEditor(item);
  };
  const showEditor = (item: Annotation) => {
    const points = item.kind === "connector" ? connectorPoints(item, connectorLayout(), connectorBox) : null;
    const point = item.kind === "connector" ? points ? { x: (points.from.x + points.to.x) / 2, y: (points.from.y + points.to.y) / 2 } : null : item.at;
    if (!point) return;
    cancelEditRef.current = false; setEditing(item.id); setEditText(item.kind === "note" ? item.text : item.label);
    setEditScreen({ x: transformRef.current.applyX(point.x), y: transformRef.current.applyY(point.y) });
  };
  const commitEdit = () => {
    const item = presentation.annotations.find((annotation) => annotation.id === editing);
    if (item && !cancelEditRef.current) onUpdateAnnotation(item.id, item.kind === "note" ? { text: editText.slice(0, 2000) } : { label: editText.slice(0, 2000) });
    cancelEditRef.current = false;
    setEditing(null);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === " ") { spaceRef.current = true; event.preventDefault(); return; }
    if (event.key === "Escape" && focusTarget) { setFocusTarget(null); return; }
    if (event.key === "Escape") { setTool("select"); choose({ nodes: [], edges: [], annotations: [] }); return; }
    if (event.shiftKey && event.key.toLowerCase() === "f") { fit(); event.preventDefault(); return; }
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      const shortcuts: Record<string, Tool> = { v: "select", n: "note", r: "rect", e: "ellipse", f: "frame", c: "connector" };
      if (shortcuts[event.key.toLowerCase()]) { setTool(shortcuts[event.key.toLowerCase()]); event.preventDefault(); return; }
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selection.annotations.length) { onRemoveAnnotations(new Set(selection.annotations)); choose({ nodes: [], edges: [], annotations: [] }); event.preventDefault(); return; }
    if ((event.key === "Delete" || event.key === "Backspace") && selection.edges.length) { const ids = view.edges.filter((edge) => selection.edges.includes(edge.id)).flatMap((edge) => edge.steps); onRemoveEvidence(new Set(ids)); event.preventDefault(); return; }
    if ((event.key === "[" || event.key === "]") && selection.nodes.length) { onCandidateDirection(event.key === "]" ? "forward" : "backward"); event.preventDefault(); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && selection.annotations.length) { const item = presentation.annotations.find((a) => a.id === selection.annotations[0]); if (item) { const copy = structuredClone(item); copy.id = crypto.randomUUID(); if (copy.kind !== "connector") copy.at = { x: copy.at.x + 24, y: copy.at.y + 24 }; onAddAnnotation(copy); choose({ nodes: [], edges: [], annotations: [copy.id] }); } event.preventDefault(); return; }
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
    if (next) choose({ nodes: [next], edges: [], annotations: [] });
  };

  const selectedNode = selection.nodes.length === 1 ? selection.nodes[0] : null;
  const selectedAnnotation = presentation.annotations.find((item) => item.id === selection.annotations[0]);
  const edited = presentation.annotations.find((item) => item.id === editing);

  return (
    <div ref={boxRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border" aria-label="Trace graph canvas">
      <canvas ref={canvasRef} className="block h-full w-full touch-none outline-none" tabIndex={0} aria-label="Trace graph. Select nodes with click or arrow keys; press Shift F to fit." onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onDoubleClick={beginEdit} onKeyDown={onKeyDown} onKeyUp={(e) => { if (e.key === " ") spaceRef.current = false; }} onBlur={() => { spaceRef.current = false; }} onContextMenu={(event) => { event.preventDefault(); const p = world(event), node = nodeAt(p), edge = node ? null : edgeAt(p); if (!node && !edge) { setMenu(null); return; } const rect = event.currentTarget.getBoundingClientRect(); choose({ nodes: node ? [node.id] : [], edges: edge ? [edge.id] : [], annotations: [] }); setMenu({ kind: node ? "node" : "edge", id: (node ?? edge)!.id, x: event.clientX - rect.left, y: event.clientY - rect.top }); }} />
      {menu && <div role="menu" className="absolute z-20 grid min-w-44 rounded border bg-background p-1 text-xs shadow" style={{ left: menu.x, top: menu.y }} onKeyDown={(event) => { if (event.key === "Escape") setMenu(null); }}>
        {menu.kind === "node" ? <>
          <button type="button" role="menuitem" className="rounded p-1 text-left hover:bg-accent" onClick={() => { onCandidateDirection("forward"); setMenu(null); }}>Next movements</button>
          <button type="button" role="menuitem" className="rounded p-1 text-left hover:bg-accent" onClick={() => { onCandidateDirection("backward"); setMenu(null); }}>Earlier movements</button>
          {(() => { const node = nodeById.get(menu.id), isHidden = hidden.counts.has(menu.id), direction = node && branchDirection(node); return direction && (isHidden || view.edges.some((e) => (direction === "forward" ? e.from : e.to) === menu.id)) ? <button type="button" role="menuitem" className="rounded p-1 text-left hover:bg-accent" onClick={() => { onBranchHidden(menu.id, !isHidden); setMenu(null); }}>{isHidden ? "Show branch" : "Hide branch"}</button> : <button type="button" role="menuitem" disabled className="rounded p-1 text-left text-muted-foreground" title="Nothing downstream to hide, or this is the seed">Hide branch</button>; })()}
          <button type="button" role="menuitem" className="rounded p-1 text-left hover:bg-accent" onClick={() => { setFocusTarget(menu.id); setMenu(null); canvasRef.current?.focus(); }}>Focus path</button>
          {stateOf(menu.id) === "OBSERVED" && <button type="button" role="menuitem" className="rounded p-1 text-left hover:bg-accent" onClick={() => { onMapWallet(menu.id); setMenu(null); }}>Map wallet</button>}
          <button type="button" role="menuitem" className="rounded p-1 text-left hover:bg-accent" onClick={() => { const p = positionsRef.current[menu.id]; if (p) onAddAnnotation({ id: crypto.randomUUID(), kind: "note", at: { x: p.x + 100, y: p.y + 40 }, width: 200, text: "", color: "yellow" }); setMenu(null); }}>Add note here</button>
          <button type="button" role="menuitem" className="rounded p-1 text-left hover:bg-accent" onClick={() => { void navigator.clipboard.writeText(menu.id); setMenu(null); }}>Copy address</button>
          <button type="button" role="menuitem" className="rounded p-1 text-left hover:bg-accent" onClick={() => { onStartAtNode(nodeById.get(menu.id)?.addresses[0] ?? menu.id); setMenu(null); }}>Start new trace here</button>
        </> : <>
          <button type="button" role="menuitem" className="rounded p-1 text-left hover:bg-accent" onClick={() => setMenu(null)}>Show movements</button>
          <button type="button" role="menuitem" className="rounded p-1 text-left hover:bg-accent" onClick={() => { onRemoveEvidence(new Set(view.edges.find((edge) => edge.id === menu.id)?.steps ?? [])); setMenu(null); }}>Remove movements</button>
          <button type="button" role="menuitem" className="rounded p-1 text-left hover:bg-accent" onClick={() => { const signatures = [...new Set((view.edges.find((edge) => edge.id === menu.id)?.steps ?? []).map((id) => stepById.get(id)).filter((step): step is Extract<TraceStep, { kind: "movement" }> => step?.kind === "movement").map((step) => step.ref.signature))]; void navigator.clipboard.writeText(signatures.join("\n")); setMenu(null); }}>Copy signatures</button>
        </>}
      </div>}
      <div className="absolute left-3 top-3 flex flex-wrap gap-1 rounded-md border bg-background/95 p-1 text-xs">
        {(["select", "note", "rect", "ellipse", "frame", "connector"] as Tool[]).map((item) => <button key={item} type="button" className="rounded px-2 py-1 hover:bg-accent" aria-pressed={tool === item} onClick={() => setTool(item)}>{item === "rect" ? "Rectangle" : item[0].toUpperCase() + item.slice(1)}</button>)}
        <button type="button" className="rounded px-2 py-1 hover:bg-accent" onClick={fit}>Fit</button>
        <button type="button" className="rounded px-2 py-1 hover:bg-accent" onClick={() => { const placed = tidyLayout({ view, positions: positionsRef.current, obstacles: [], grid: presentation.canvas.snap ? GRID : null }); Object.assign(positionsRef.current, placed); onMove(placed); requestDraw(); }}>Tidy layout</button>
        <button type="button" className="rounded px-2 py-1 hover:bg-accent" aria-pressed={presentation.canvas.grid} onClick={() => onOptions({ grid: !presentation.canvas.grid })}>Grid</button>
        <button type="button" className="rounded px-2 py-1 hover:bg-accent" aria-pressed={presentation.canvas.snap} onClick={() => onOptions({ snap: !presentation.canvas.snap })}>Snap</button>
        <button type="button" className="rounded px-2 py-1 hover:bg-accent" aria-pressed={editFocus} onClick={() => setEditFocus(!editFocus)}>Nudge mode</button>
      </div>
      {(selectedNode || selectedAnnotation) && <div className="absolute left-3 top-14 flex flex-wrap items-center gap-2 rounded border bg-background/95 p-1 text-xs">
        <label>Colour <select className="rounded border bg-background" value={selectedNode ? presentation.nodeStyles[selectedNode]?.color ?? "default" : selectedAnnotation?.kind === "shape" ? selectedAnnotation.stroke : selectedAnnotation?.color ?? "default"} onChange={(e) => { const color = e.target.value as ColorKey; if (selectedNode) onNodeStyle(selectedNode, { ...presentation.nodeStyles[selectedNode], color }); else if (selectedAnnotation) onUpdateAnnotation(selectedAnnotation.id, selectedAnnotation.kind === "shape" ? { stroke: color } : { color }); }}>{COLOR_KEYS.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>
        {selectedNode && <><label>Size <select className="rounded border bg-background" value={presentation.nodeStyles[selectedNode]?.size ?? "m"} onChange={(e) => onNodeStyle(selectedNode, { ...presentation.nodeStyles[selectedNode], size: e.target.value as "s" | "m" | "l" })}><option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option></select></label><button type="button" onClick={() => { const note = window.prompt("Node note", presentation.nodeStyles[selectedNode]?.note ?? ""); if (note !== null) onNodeStyle(selectedNode, { ...presentation.nodeStyles[selectedNode], note: note.slice(0, 2000) }); }}>Node note</button></>}
        {selectedAnnotation?.kind === "shape" && <label>Fill <select className="rounded border bg-background" value={selectedAnnotation.fill} onChange={(e) => onUpdateAnnotation(selectedAnnotation.id, { fill: e.target.value as ColorKey | "none" })}><option value="none">None</option>{COLOR_KEYS.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>}
        {selectedAnnotation?.kind === "connector" && <label>Arrow <select className="rounded border bg-background" value={selectedAnnotation.arrow} onChange={(e) => onUpdateAnnotation(selectedAnnotation.id, { arrow: e.target.value as "none" | "end" | "both" })}><option value="none">None</option><option value="end">End</option><option value="both">Both</option></select></label>}
        {selectedAnnotation && <><button type="button" onClick={() => showEditor(selectedAnnotation)}>Edit text</button><button type="button" onClick={() => onReorderAnnotation(selectedAnnotation.id, "front")}>Front</button><button type="button" onClick={() => onReorderAnnotation(selectedAnnotation.id, "back")}>Back</button><button type="button" onClick={() => { onRemoveAnnotations(new Set([selectedAnnotation.id])); choose({ nodes: [], edges: [], annotations: [] }); }}>Delete</button></>}
      </div>}
      {edited && editScreen && <div className="absolute z-10" style={{ left: editScreen.x, top: editScreen.y }}><textarea autoFocus maxLength={2000} className="min-h-20 w-52 rounded border bg-background p-2 text-sm shadow" value={editText} onChange={(e) => setEditText(e.target.value)} onBlur={commitEdit} onKeyDown={(e) => { if (e.key === "Escape") { cancelEditRef.current = true; setEditing(null); e.preventDefault(); } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { commitEdit(); e.preventDefault(); } }} />{editText.length >= 1800 && <span className="block bg-background text-right text-xs">{editText.length}/2000</span>}</div>}
      {focusTarget && <div className="absolute right-3 top-3 flex items-center gap-2 rounded border bg-background/95 p-1 text-xs">{focus ? `Path from the seed to ${nodeById.get(focusTarget)?.service?.name ?? names.of(focusTarget)}` : "No path from the seed to this node"}<button type="button" className="rounded px-2 py-1 hover:bg-accent" onClick={() => setFocusTarget(null)}>Exit focus (Esc)</button></div>}
      {hover && <p className="pointer-events-none absolute bottom-12 left-3 max-w-sm rounded border bg-background p-2 text-xs shadow">{nodeById.has(hover) ? `${nodeById.get(hover)?.service?.name ?? names.of(hover)} · ${nodeById.get(hover)?.addresses.join(", ")}` : (() => { const edge = view.edges.find((e) => e.id === hover)!; return `${edgeLabel(edge)}${edge.via?.length ? ` · via ${edge.via.map((item) => `${item.from} to ${item.to}`).join("; ")}` : ""}`; })()}</p>}
      <p className="pointer-events-none absolute bottom-12 right-3 rounded border bg-background/95 p-1 text-xs">Solid = observed movement · Dashed = your annotation</p>
      <p className="absolute bottom-2 left-3 rounded bg-background/95 px-2 py-1 text-xs text-muted-foreground">Observed movements in time order. Lines don&apos;t show that the same funds moved.</p>
      <p className="sr-only" aria-live="polite">{selection.nodes.length ? selection.nodes.map((id) => `${names.of(id)}, ${nodeById.get(id)?.depth ?? "unknown"} hops`).join("; ") : selection.edges.length ? `Movement ${selection.edges[0]}` : selection.annotations.length ? `Annotation ${selection.annotations[0]}, drawn by you` : "No selection"}</p>
      {view.nodes.length === 1 && view.edges.length === 0 && <p className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 rounded bg-background/90 p-3 text-sm text-muted-foreground">Add a movement to start tracing.</p>}
    </div>
  );
}
