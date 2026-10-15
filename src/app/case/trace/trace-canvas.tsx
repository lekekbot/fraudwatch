"use client";

import { select } from "d3-selection";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import { AlignCenterHorizontalIcon, AlignCenterVerticalIcon, AlignEndHorizontalIcon, AlignEndVerticalIcon, AlignHorizontalDistributeCenterIcon, AlignStartHorizontalIcon, AlignStartVerticalIcon, AlignVerticalDistributeCenterIcon, GroupIcon, UngroupIcon, UnlockIcon, AlignCenterIcon, AlignLeftIcon, AlignRightIcon, CornerDownRightIcon, MoveHorizontalIcon, MoveRightIcon, MoveUpRightIcon, TypeIcon, BringToFrontIcon, ChevronDownIcon, CopyIcon, SendToBackIcon, Trash2Icon, ChevronUpIcon, CircleIcon, FrameIcon, Grid3x3Icon, LockIcon, MagnetIcon, MinusIcon, MousePointer2Icon, NetworkIcon, PlusIcon, SlashIcon, SplineIcon, SquareIcon, StickyNoteIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { branchDirection, focusPath, type HiddenBranches } from "@/lib/trace/branches";
import { alignDeltas, type AlignMode, boundsOf, boxFrom, distributeDeltas, type Guide, snapToGuides } from "@/lib/trace/canvas-ops";
import { annotationBox, type Box, connectorPath, connectorPoints, contains, type Font, fontFor, handleAt, LABEL_FONT, MIN_NOTE, MIN_SHAPE, nearestSide, pointAlong, projectOnto, resizeBox, HANDLES, type Handle, sidePoint, wrapText } from "@/lib/trace/geometry";
import type { Names } from "@/lib/labels/labels";
import { graphWheelAction } from "@/lib/gestures";
import type { AddressState } from "@/lib/case/address-state";
import type { BoundaryKind, TraceStep } from "@/lib/trace/model";
import { ICON_KEYS, ICONS, type IconKey } from "@/lib/trace/icons";
import { snap, tidyLayout, TRACE_SPACING } from "@/lib/trace/layout";
import { resolveEnd } from "@/lib/trace/presentation";
import { COLOR_KEYS, SIDES, type Side, type Annotation, type AnnotationEnd, type ColorKey, type NodeStyle, type Point, type TracePresentation } from "@/lib/trace/presentation";
import type { TraceEdge, TraceNode, TraceView } from "@/lib/trace/view";
import { compactAmount } from "../asset-format";
import { onThemeChange, readPalette, sizeCanvas } from "../canvas";

const WIDTH = 168;
const HEIGHT = 34;
const GRID = 24;
/** Fitting never zooms in past this, so a trace of one or two nodes keeps readable proportions. */
const MAX_FIT_ZOOM = 1.25;
/** Where along a line its amount label sits (0 = sender, 1 = receiver). */
const LABEL_AT = 0.62;
export type TraceSelection = { nodes: string[]; edges: string[]; annotations: string[] };
type Drag =
  /** Any mix of nodes and annotations moving together; `copies` when Alt-dragging duplicates. */
  | { kind: "move"; origin: Point; moved: boolean; nodes: Record<string, Point>; items: Annotation[]; copies: boolean; clicked: { kind: "node" | "annotation"; id: string } | null }
  | { kind: "resize"; origin: Point; moved: boolean; annotation: Annotation; handle: Handle }
  | { kind: "connector-end"; origin: Point; moved: boolean; annotation: Extract<Annotation, { kind: "connector" }>; end: "from" | "to" }
  | { kind: "label"; origin: Point; moved: boolean; annotation: Extract<Annotation, { kind: "connector" }> }
  | { kind: "marquee"; origin: Point; moved: boolean; additive: boolean }
  | { kind: "create"; origin: Point; moved: boolean; from?: AnnotationEnd };
type Menu = { kind: "node" | "edge" | "annotation" | "canvas"; id: string; x: number; y: number; at: Point };

/** Copied annotations, shared by every trace in the session (like a design tool's clipboard). */
let clipboard: { items: Annotation[]; pastes: number } = { items: [], pastes: 0 };

/** Copies of annotations with new ids; connectors between copied items are re-pointed at the copies. */
function cloneAnnotations(items: readonly Annotation[], offset: Point): Annotation[] {
  const ids = new Map(items.map((a) => [a.id, crypto.randomUUID()]));
  const end = (e: AnnotationEnd): AnnotationEnd => (e.kind === "annotation" && ids.has(e.id) ? { kind: "annotation", id: ids.get(e.id)! } : e.kind === "point" ? { kind: "point", at: { x: e.at.x + offset.x, y: e.at.y + offset.y } } : e);
  return items.map((a) => (a.kind === "connector" ? { ...structuredClone(a), id: ids.get(a.id)!, from: end(a.from), to: end(a.to) } : { ...structuredClone(a), id: ids.get(a.id)!, at: { x: a.at.x + offset.x, y: a.at.y + offset.y } }));
}

/** An annotation shifted by `d`; attached connector ends stay attached. */
function translated(a: Annotation, d: Point): Annotation {
  if (a.kind !== "connector") return { ...a, at: { x: a.at.x + d.x, y: a.at.y + d.y } };
  const end = (e: AnnotationEnd): AnnotationEnd => (e.kind === "point" ? { kind: "point", at: { x: e.at.x + d.x, y: e.at.y + d.y } } : e);
  return { ...a, from: end(a.from), to: end(a.to) };
}
type Tool = "select" | "note" | "text" | "rect" | "ellipse" | "frame" | "connector" | "arrow";

const TOOLS: { tool: Tool; label: string; icon: typeof SquareIcon; key: string }[] = [
  { tool: "select", label: "Select", icon: MousePointer2Icon, key: "V" },
  { tool: "note", label: "Note", icon: StickyNoteIcon, key: "N" },
  { tool: "text", label: "Text", icon: TypeIcon, key: "T" },
  { tool: "rect", label: "Rectangle", icon: SquareIcon, key: "R" },
  { tool: "ellipse", label: "Ellipse", icon: CircleIcon, key: "E" },
  { tool: "frame", label: "Frame", icon: FrameIcon, key: "F" },
  { tool: "connector", label: "Connector", icon: SplineIcon, key: "C" },
  { tool: "arrow", label: "Arrow", icon: MoveUpRightIcon, key: "A" },
];
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const Divider = () => <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />;

const SUPPORTING_ROLES = ["royalty", "marketplace_fee", "rent", "unidentified"];

type Palette = Record<"fg" | "muted" | "card" | "warn" | "amber" | "bridge" | "burn" | "defi", string>;

/** A small glyph for why the trace stops at a node; the words are in the hover card and inspector. */
function drawBoundary(ctx: CanvasRenderingContext2D, kind: BoundaryKind, x: number, y: number, r: number, p: Palette, k: number) {
  ctx.lineWidth = 1.25 / k;
  if (kind === "history_not_loaded" || kind === "partial_history" || kind === "outside_range") {
    // ⊘: the history beyond here isn't loaded (amber when it's loaded but incomplete).
    ctx.strokeStyle = kind === "history_not_loaded" ? p.muted : p.amber;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - r * 0.7, y + r * 0.7); ctx.lineTo(x + r * 0.7, y - r * 0.7); ctx.stroke();
    return;
  }
  if (kind === "custodial") {
    // A padlock: deposits can't be followed out of a custodian.
    ctx.strokeStyle = p.amber; ctx.fillStyle = p.amber;
    ctx.beginPath(); ctx.arc(x, y - r * 0.25, r * 0.55, Math.PI, 0); ctx.stroke();
    ctx.fillRect(x - r * 0.8, y - r * 0.2, r * 1.6, r * 1.2);
    return;
  }
  const colour = kind === "failed" ? p.warn : kind === "ambiguous" ? p.amber : kind === "bridged_in" || kind === "bridged_out" ? p.bridge : kind === "left_supply" || kind === "entered_supply" ? p.burn : kind === "protocol_position" ? p.defi : p.muted;
  ctx.fillStyle = colour;
  ctx.beginPath(); ctx.arc(x, y, r * 0.75, 0, Math.PI * 2); ctx.fill();
}

export const boundaryLabel: Record<BoundaryKind, string> = {
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

export function TraceCanvas({ toolbarStart, toolbarEnd, overlay, onCanvas, selection, initialTransform, onTransform, view, hidden, onBranchHidden, presentation, steps, names, stateOf, assetText, onMove, onOptions, onSelection, onCandidateDirection, onStartAtNode, onMapWallet, onRemoveEvidence, onAddAnnotation, onUpdateAnnotation, onRemoveAnnotations, onAddAnnotations, onReorder, onNodeStyles }: {
  /** Trace-level controls placed at the start and end of the floating toolbar, and a top-left overlay. */
  toolbarStart?: React.ReactNode; toolbarEnd?: React.ReactNode; overlay?: React.ReactNode;
  /** Receives the canvas element, for snapshots. */
  onCanvas?: (canvas: HTMLCanvasElement | null) => void;
  /** Restored when returning to this trace from another view. */
  /** Owned by the trace view, so it can select things too (a newly placed wallet). */
  selection: TraceSelection; initialTransform?: { x: number; y: number; k: number }; onTransform?: (t: { x: number; y: number; k: number }) => void;
  view: TraceView; hidden: Pick<HiddenBranches, "counts" | "anchors">; onBranchHidden: (id: string, hidden: boolean) => void; presentation: TracePresentation; steps: readonly TraceStep[]; names: Names;
  stateOf: (address: string) => AddressState;
  assetText: (assetId: string, amount: string) => string;
  /** Positions, annotation changes and node style changes made together (one undo step). */
  onMove: (positions: Record<string, Point>, annotations?: { id: string; patch: Partial<Annotation> }[], nodeStyles?: Record<string, Partial<NodeStyle>>) => void;
  onOptions: (options: Partial<TracePresentation["canvas"]>) => void;
  onSelection: (selection: TraceSelection) => void;
  onCandidateDirection: (direction: "forward" | "backward") => void;
  onStartAtNode: (address: string) => void;
  onMapWallet: (address: string) => void;
  onRemoveEvidence: (ids: Set<string>) => void;
  onAddAnnotation: (item: Annotation) => void;
  onUpdateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  onRemoveAnnotations: (ids: Set<string>) => void;
  /** Several annotations at once (paste, duplicate, Alt-drag): one undo step. */
  onAddAnnotations: (items: Annotation[]) => void;
  onReorder: (ids: string[], edge: "front" | "back" | "forward" | "backward") => void;
  onNodeStyles: (ids: string[], style: Partial<NodeStyle>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ZoomTransform>(initialTransform ? zoomIdentity.translate(initialTransform.x, initialTransform.y).scale(initialTransform.k) : zoomIdentity);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const initialFitRef = useRef(Boolean(initialTransform));
  const positionsRef = useRef<Record<string, Point>>(presentation.positions);
  const dragRef = useRef<Drag | null>(null);
  /** Annotations as they look mid-gesture, by id; Alt-drag copies aren't in the trace yet. */
  const draftsRef = useRef(new Map<string, Annotation>());
  /** Smart guides to draw while dragging. */
  const guidesRef = useRef<Guide[]>([]);
  const cancelEditRef = useRef(false);
  const spaceRef = useRef(false);
  const frameRef = useRef<number>(0);
  const drawRef = useRef<() => void>(() => {});
  useEffect(() => { onCanvas?.(canvasRef.current); return () => onCanvas?.(null); }, [onCanvas]);
  const onTransformRef = useRef(onTransform);
  useEffect(() => { onTransformRef.current = onTransform; });
  const [tool, setTool] = useState<Tool>("select");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editScreen, setEditScreen] = useState<{ x: number; y: number; width: number; height: number; scale: number } | null>(null);
  const choose = (value: TraceSelection) => onSelection(value);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverAt, setHoverAt] = useState<Point | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** The connection dot under the pointer, drawn filled. */
  const hoverPortRef = useRef<Side | null>(null);
  const [dragging, setDragging] = useState(false);
  /** The canvas transform as of the last finished pan or zoom: places the quick toolbar and labels the zoom menu. */
  const [viewT, setViewT] = useState({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  /** The quick toolbar's measured width, to keep it inside the canvas. */
  const [barWidth, setBarWidth] = useState(320);
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Place the menu from its measured size so every menu, however long, stays inside the canvas.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !menu) return;
    el.style.left = `${Math.max(4, Math.min(menu.x, size.width - el.offsetWidth - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(menu.y, size.height - el.offsetHeight - 4))}px`;
  }, [menu, size]);
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
          const scale = Math.min(MAX_FIT_ZOOM, Math.max(0.2, Math.min(r.width / (right - left), r.height / (bottom - top))));
          transformRef.current = zoomIdentity.translate((r.width - scale * (left + right)) / 2, (r.height - scale * (top + bottom)) / 2).scale(scale);
          initialFitRef.current = true;
          setViewT({ x: transformRef.current.x, y: transformRef.current.y, k: transformRef.current.k });
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
  /** The font and alignment an annotation's text is drawn with. */
  const textStyle = (a: Annotation): { font: Font; align: "left" | "center" | "right" } => {
    if (a.kind === "note") return { font: fontFor("note", a.fontSize), align: a.align ?? "left" };
    if (a.kind === "shape") return { font: fontFor("label", a.fontSize), align: a.align ?? (a.shape === "frame" ? "left" : "center") };
    return { font: LABEL_FONT, align: "center" };
  };
  /** A connector's drawn path: its ends, through elbow bends when routed. */
  const pathOf = (item: Extract<Annotation, { kind: "connector" }>, layout: TracePresentation = connectorLayout()): Point[] | null => {
    const points = connectorPoints(item, layout, connectorBox);
    if (!points) return null;
    const side = (end: AnnotationEnd) => (end.kind === "point" ? null : end.side ?? null);
    return connectorPath(points.from, points.to, item.route, side(item.from), side(item.to));
  };
  /** A connector label's drag handle: just under the label, so it never covers the text. */
  const labelHandle = (path: Point[], item: Extract<Annotation, { kind: "connector" }>) => { const at = pointAlong(path, item.labelAt ?? 0.5); return { x: at.x, y: at.y + 9 + 7 / transformRef.current.k }; };
  /** The node or annotation a connector end would attach to under `p`, and to which side when close to one. */
  const anchorRef = useRef<{ box: Box; side: AnnotationEnd } | null>(null);
  const stale = new Set(view.issues.filter((i) => i.kind === "stale").map((i) => i.stepId));
  const compact = (text: string) => { const at = text.lastIndexOf(" "); return at < 0 ? compactAmount(text) : `${compactAmount(text.slice(0, at))}${text.slice(at)}`; };
  const roleOf = (edge: TraceEdge) => { const step = edge.steps.length === 1 ? stepById.get(edge.steps[0]) : null; return step?.kind === "movement" && SUPPORTING_ROLES.includes(step.ref.role ?? "") ? step.ref.role!.replaceAll("_", " ") : null; };
  /** The chip on a line: how much, at a glance. Times and full precision are in the hover card and inspector. */
  const edgeChip = (edge: TraceEdge) => {
    const amount = edge.totals.length === 1 ? compact(assetText(edge.totals[0].assetId, edge.totals[0].amount)) : `${edge.totals.length} assets`;
    const role = roleOf(edge);
    return `${edge.steps.some((id) => stale.has(id)) ? "⚠ " : ""}${edge.steps.length > 1 ? `${edge.steps.length}× ` : ""}${amount}${role ? ` · ${role}` : ""}`;
  };
  const edgeLabel = (edge: TraceEdge) => {
    const amount = edge.totals.map((t) => assetText(t.assetId, t.amount)).join(", ");
    const time = (ms: number | null) => (ms === null ? "time unknown" : `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`);
    const when = edge.firstTime === edge.lastTime ? time(edge.firstTime) : `${time(edge.firstTime)} → ${time(edge.lastTime)}`;
    return `${edge.steps.length > 1 ? `${edge.steps.length} movements · total ` : ""}${amount} · ${when}${edge.returns ? " · returns toward the seed" : ""}`;
  };

  /** A node's or annotation's box in world units, for selection bounds, marquee and guides. */
  const nodeBox = (id: string): Box | null => {
    const node = nodeById.get(id), at = positionsRef.current[id];
    if (!node || !at) return null;
    const { width, height } = nodeSize(node, presentation);
    return { x: at.x - width / 2, y: at.y - height / 2, width, height };
  };
  const itemBox = (a: Annotation): Box | null => {
    if (a.kind !== "connector") return annotationBox(a);
    const points = connectorPoints(a, connectorLayout(), connectorBox);
    return points && boxFrom(points.from, points.to);
  };
  /** The single selected node or shape that shows connection dots, as in draw.io. */
  const portOwner = (): { box: Box; end: (side: Side) => AnnotationEnd } | null => {
    if (tool !== "select" || selection.nodes.length + selection.annotations.length !== 1) return null;
    const id = selection.nodes[0] ?? selection.annotations[0], kind = selection.nodes.length ? "node" as const : "annotation" as const;
    const a = kind === "annotation" ? presentation.annotations.find((x) => x.id === id) : undefined;
    const box = kind === "node" ? nodeBox(id) : a && a.kind !== "connector" ? annotationBox(a) : null;
    return box ? { box, end: (side) => ({ kind, id, side }) } : null;
  };
  const portAt = (p: Point): AnnotationEnd | null => {
    const owner = portOwner(), k = transformRef.current.k;
    const side = owner && SIDES.find((s) => { const q = sidePoint(owner.box, s); return Math.hypot(q.x - p.x, q.y - p.y) <= 8 / k; });
    return owner && side ? owner.end(side) : null;
  };
  const selectionBoxes = (sel: TraceSelection = selection) => [
    ...sel.nodes.map(nodeBox),
    ...sel.annotations.map((id) => { const a = draftsRef.current.get(id) ?? presentation.annotations.find((x) => x.id === id); return a ? itemBox(a) : null; }),
  ].filter((b): b is Box => !!b);
  const lockedNode = (id: string) => presentation.nodeStyles[id]?.locked === true;
  const lockedAnnotation = (id: string) => presentation.annotations.find((a) => a.id === id)?.locked === true;
  const draw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !size.width || !size.height) return;
    const palette = readPalette(canvas, { bg: "--background", fg: "--foreground", card: "--card", border: "--border", muted: "--muted-foreground", primary: "--primary", warn: "--destructive", accent: "--accent", amber: "--tone-lookalike", bridge: "--tone-bridge", burn: "--tone-burn", defi: "--tone-defi", guide: "--tone-nft", red: "--color-red-500", orange: "--color-orange-500", yellow: "--color-yellow-500", green: "--color-green-500", teal: "--color-teal-500", blue: "--color-blue-500", purple: "--color-purple-500", pink: "--color-pink-500", gray: "--color-gray-500" });
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
    const drafts = draftsRef.current;
    const annotations = [...presentation.annotations.map((item) => drafts.get(item.id) ?? item), ...[...drafts.values()].filter((d) => !presentation.annotations.some((a) => a.id === d.id))];
    const drawing = connectorLayout(annotations);
    /** Wrapped at word boundaries and clipped to the box, in world units so it scales with the canvas. */
    const drawText = (text: string, box: Box, font: Font, colour: string, align: "left" | "center" | "right", valign: "top" | "middle") => {
      ctx.save();
      ctx.beginPath(); ctx.rect(box.x, box.y, box.width, box.height); ctx.clip();
      ctx.font = `${font.size}px ui-sans-serif, system-ui, sans-serif`; ctx.fillStyle = colour; ctx.textAlign = align; ctx.textBaseline = "middle";
      const lines = wrapText(text, Math.max(1, box.width - font.pad * 2), (line) => ctx.measureText(line).width);
      const top = valign === "middle" ? box.y + Math.max(font.pad, (box.height - lines.length * font.line) / 2) : box.y + font.pad;
      const x = align === "center" ? box.x + box.width / 2 : align === "right" ? box.x + box.width - font.pad : box.x + font.pad;
      lines.forEach((line, i) => ctx.fillText(line, x, top + (i + 0.5) * font.line));
      ctx.restore();
    };
    for (const annotation of annotations) {
      if (annotation.kind === "note") continue;
      const color = annotation.kind === "connector" ? annotation.color : annotation.stroke;
      ctx.strokeStyle = color === "default" ? palette.muted : palette[color];
      ctx.lineWidth = ((selection.annotations.includes(annotation.id) ? 1.5 : 0) + (annotation.strokeWidth ?? 1) * 1.5) / t.k;
      if (annotation.kind === "connector") {
        const path = pathOf(annotation, drawing);
        if (!path) continue;
        ctx.lineWidth = ((selection.annotations.includes(annotation.id) ? 1.5 : 0) + (annotation.strokeWidth ?? 1) * 1.5) / t.k;
        ctx.setLineDash(annotation.lineStyle === "solid" ? [] : [6 / t.k, 4 / t.k]); ctx.lineJoin = "round";
        ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y); for (const q of path.slice(1)) ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]);
        const arrow = (at: Point, from: Point) => { const angle = Math.atan2(at.y - from.y, at.x - from.x), size = (10 + 3 * (annotation.strokeWidth ?? 1)) / t.k; ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineTo(at.x - size * Math.cos(angle - 0.45), at.y - size * Math.sin(angle - 0.45)); ctx.lineTo(at.x - size * Math.cos(angle + 0.45), at.y - size * Math.sin(angle + 0.45)); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); };
        if (annotation.arrow === "end" || annotation.arrow === "both") arrow(path[path.length - 1], path[path.length - 2]);
        if (annotation.arrow === "both") arrow(path[0], path[1]);
        if (annotation.label && editing !== annotation.id) {
          ctx.font = `${LABEL_FONT.size}px ui-sans-serif, system-ui, sans-serif`;
          const mid = pointAlong(path, annotation.labelAt ?? 0.5), w = ctx.measureText(annotation.label).width + 10;
          ctx.fillStyle = palette.bg; ctx.fillRect(mid.x - w / 2, mid.y - 9, w, 18);
          ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(annotation.label, mid.x, mid.y); ctx.textBaseline = "alphabetic";
        }
        continue;
      }
      const box = annotationBox(annotation)!;
      if (annotation.shape === "icon") {
        // The icon fills the top of the box; its label sits underneath. A fill draws a tinted tile behind it.
        const { font, align } = textStyle(annotation);
        const labelSpace = annotation.label ? font.line + 6 : 0, side = Math.max(8, Math.min(box.width, box.height - labelSpace));
        const ix = box.x + (box.width - side) / 2, iy = box.y;
        if (annotation.fill !== "none") { ctx.globalAlpha = 0.18; ctx.fillStyle = annotation.fill === "default" ? palette.accent : palette[annotation.fill]; ctx.beginPath(); ctx.roundRect(ix, iy, side, side, side * 0.2); ctx.fill(); ctx.globalAlpha = 1; }
        const icon = ICONS[annotation.icon ?? "flag"], scale = (side * (annotation.fill !== "none" ? 0.7 : 1)) / 24, pad = (side - 24 * scale) / 2;
        ctx.save(); ctx.translate(ix + pad, iy + pad); ctx.scale(scale, scale);
        ctx.strokeStyle = annotation.stroke === "default" ? palette.fg : palette[annotation.stroke]; ctx.lineWidth = (annotation.strokeWidth ?? 1) * 2 * (selection.annotations.includes(annotation.id) ? 1.15 : 1); ctx.lineCap = "round"; ctx.lineJoin = "round";
        for (const d of icon.paths) ctx.stroke(new Path2D(d));
        ctx.restore();
        if (annotation.label && editing !== annotation.id) drawText(annotation.label, { x: box.x - 20, y: box.y + side + 2, width: box.width + 40, height: Math.max(font.line + 4, box.height - side) }, { ...font, pad: 2 }, palette.fg, align === "left" ? "center" : align, "top");
        if (selection.annotations.includes(annotation.id)) { ctx.strokeStyle = palette.primary; ctx.lineWidth = 1 / t.k; ctx.setLineDash([3 / t.k, 3 / t.k]); ctx.strokeRect(box.x, box.y, box.width, box.height); ctx.setLineDash([]); }
        continue;
      }
      if (annotation.fill !== "none") { ctx.globalAlpha = 0.15; ctx.fillStyle = annotation.fill === "default" ? palette.accent : palette[annotation.fill]; if (annotation.shape === "ellipse") { ctx.beginPath(); ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(box.x, box.y, box.width, box.height); ctx.globalAlpha = 1; }
      if (annotation.shape === "frame") ctx.setLineDash([7 / t.k, 4 / t.k]);
      ctx.beginPath(); if (annotation.shape === "ellipse") ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2); else ctx.rect(box.x, box.y, box.width, box.height); ctx.stroke(); ctx.setLineDash([]);
      // A frame's label is its title along the top; a rectangle's or ellipse's sits in the middle.
      if (annotation.label && editing !== annotation.id) {
        const { font, align } = textStyle(annotation);
        if (annotation.shape === "frame") drawText(annotation.label, { ...box, height: Math.min(box.height, font.line + font.pad * 2) }, font, palette.fg, align, "top");
        else drawText(annotation.label, annotation.shape === "ellipse" ? { x: box.x + box.width * 0.15, y: box.y + box.height * 0.15, width: box.width * 0.7, height: box.height * 0.7 } : box, font, palette.fg, align, "middle");
      }
    }
    for (const edge of view.edges) {
      const a = positions[edge.from], b = positions[edge.to];
      if (!a || !b || (Math.max(a.x, b.x) < minX - 200 || Math.min(a.x, b.x) > maxX + 200 || Math.max(a.y, b.y) < minY - 100 || Math.min(a.y, b.y) > maxY + 100)) continue;
      const fromSize = nodeSize(nodeById.get(edge.from)!, presentation), toSize = nodeSize(nodeById.get(edge.to)!, presentation);
      const ends = edgeEnds(a, b, fromSize.width, toSize.width, fromSize.height, toSize.height);
      const x = (ends.from.x + ends.to.x) / 2, y = (ends.from.y + ends.to.y) / 2;
      const bend = edge.returns ? -36 : 0;
      const warn = edge.steps.some((id) => stale.has(id));
      const supporting = edge.steps.every((id) => { const s = stepById.get(id); return s?.kind === "movement" && SUPPORTING_ROLES.includes(s.ref.role ?? ""); });
      const active = selection.edges.includes(edge.id) || hover === edge.id;
      ctx.globalAlpha = (focus && !focus.edges.has(edge.id) ? 0.2 : 1) * (supporting && !active ? 0.6 : 1);
      ctx.strokeStyle = warn ? palette.warn : active ? palette.fg : palette.muted;
      ctx.lineWidth = (active ? 2.25 : supporting ? 1 : 1.5) / t.k;
      ctx.beginPath(); ctx.moveTo(ends.from.x, ends.from.y); ctx.quadraticCurveTo(x, y + bend, ends.to.x, ends.to.y); ctx.stroke();
      const angle = Math.atan2(ends.to.y - (y + bend), ends.to.x - x);
      const arrow = Math.max(6, 8 / t.k);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.moveTo(ends.to.x, ends.to.y); ctx.lineTo(ends.to.x - arrow * Math.cos(angle - 0.45), ends.to.y - arrow * Math.sin(angle - 0.45)); ctx.lineTo(ends.to.x - arrow * Math.cos(angle + 0.45), ends.to.y - arrow * Math.sin(angle + 0.45)); ctx.closePath(); ctx.fill();
      if (t.k >= 0.55) {
        const label = edgeChip(edge);
        ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
        // Past the middle, where lines fanning out of one node have spread apart.
        const u = LABEL_AT, cx = (1 - u) ** 2 * ends.from.x + 2 * (1 - u) * u * x + u ** 2 * ends.to.x, cy = (1 - u) ** 2 * ends.from.y + 2 * (1 - u) * u * (y + bend) + u ** 2 * ends.to.y;
        const w = ctx.measureText(label).width + 12;
        ctx.fillStyle = palette.card; ctx.strokeStyle = active ? palette.fg : palette.border; ctx.lineWidth = 1 / t.k;
        ctx.beginPath(); ctx.roundRect(cx - w / 2, cy - 9, w, 18, 9); ctx.fill(); ctx.stroke();
        ctx.fillStyle = warn ? palette.warn : active ? palette.fg : palette.muted; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(label, cx, cy + 0.5); ctx.textBaseline = "alphabetic";
      }
      ctx.globalAlpha = 1;
    }
    chipsRef.current = [];
    for (const node of view.nodes) {
      const p = positions[node.id];
      if (!p) continue;
      const { width, height } = nodeSize(node, presentation);
      if (p.x + width < minX || p.x - width > maxX || p.y + height < minY || p.y - height > maxY) continue;
      const style = presentation.nodeStyles[node.id];
      const tint = style?.color && style.color !== "default" ? palette[style.color] : null;
      const selected = selection.nodes.includes(node.id), hovered = hover === node.id;
      const alpha = focus && !focus.nodes.has(node.id) ? 0.25 : 1;
      const left = p.x - width / 2, top = p.y - height / 2, r = height / 2;
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.roundRect(left, top, width, height, r);
      ctx.fillStyle = palette.card; ctx.fill();
      if (tint) { ctx.globalAlpha = alpha * 0.16; ctx.fillStyle = tint; ctx.fill(); ctx.globalAlpha = alpha; }
      ctx.strokeStyle = selected ? palette.fg : tint ?? (node.isSeed ? palette.fg : hovered ? palette.muted : palette.border);
      ctx.lineWidth = (selected ? 2.25 : node.isSeed ? 1.75 : 1) / t.k;
      ctx.stroke();
      if (selected) { ctx.globalAlpha = alpha * 0.18; ctx.lineWidth = 6 / t.k; ctx.stroke(); ctx.globalAlpha = alpha; }
      // State mark: service ◆, mapped ●, observed ○, infrastructure ▪; the seed gets a ring.
      const state = stateOf(node.addresses[0]);
      const ix = left + r, mark = Math.min(5, height / 6);
      ctx.fillStyle = palette.fg; ctx.strokeStyle = palette.muted; ctx.lineWidth = 1.25 / t.k;
      if (node.service) { ctx.beginPath(); ctx.moveTo(ix, p.y - mark - 1); ctx.lineTo(ix + mark + 1, p.y); ctx.lineTo(ix, p.y + mark + 1); ctx.lineTo(ix - mark - 1, p.y); ctx.closePath(); ctx.fillStyle = palette.bridge; ctx.fill(); }
      else if (state === "PRIMARY" || state === "MAPPED") { ctx.beginPath(); ctx.arc(ix, p.y, mark, 0, Math.PI * 2); ctx.fill(); }
      else if (state === "INFRASTRUCTURE") { ctx.fillStyle = palette.muted; ctx.fillRect(ix - mark * 0.8, p.y - mark * 0.8, mark * 1.6, mark * 1.6); }
      else { ctx.beginPath(); ctx.arc(ix, p.y, mark - 0.5, 0, Math.PI * 2); ctx.stroke(); }
      if (node.isSeed) { ctx.strokeStyle = palette.fg; ctx.lineWidth = 1.25 / t.k; ctx.beginPath(); ctx.arc(ix, p.y, mark + 3, 0, Math.PI * 2); ctx.stroke(); }
      // Badges on the right: the first boundary, then conversions and internal movements as counts.
      const badges: { draw: (cx: number) => void; width: number }[] = [];
      const boundary = node.boundaries[0];
      if (boundary) badges.push({ width: 14, draw: (cx) => drawBoundary(ctx, boundary, cx, p.y, 5, palette, t.k) });
      const extra = node.conversions.length + (node.internalMovements?.length ?? 0) + Math.max(0, node.boundaries.length - 1);
      ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
      if (extra) { const text = `+${extra}`; const w = ctx.measureText(text).width; badges.push({ width: w + 4, draw: (cx) => { ctx.fillStyle = palette.muted; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, cx, p.y + 0.5); ctx.textBaseline = "alphabetic"; } }); }
      if (style?.note) badges.push({ width: 12, draw: (cx) => { ctx.fillStyle = palette.muted; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("✎", cx, p.y + 0.5); ctx.textBaseline = "alphabetic"; } });
      let cx = left + width - r + 2;
      for (const badge of [...badges].reverse()) { cx -= badge.width / 2; badge.draw(cx); cx -= badge.width / 2 + 2; }
      // Name, truncated to the room left between the mark and the badges.
      ctx.font = `${node.isSeed || state === "PRIMARY" ? 600 : 500} 12px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = palette.fg; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      const room = cx - (ix + mark + 8);
      let name = node.service ? `${node.service.name}${node.addresses.length > 1 ? ` (${node.addresses.length})` : ""}` : names.of(node.id);
      if (ctx.measureText(name).width > room) {
        const keep = Math.max(3, Math.floor(name.length * room / ctx.measureText(name).width) - 1);
        name = `${name.slice(0, keep)}…`;
      }
      ctx.fillText(name, ix + mark + 7, p.y + 0.5); ctx.textBaseline = "alphabetic";
      const count = hidden.counts.get(node.id);
      if (count !== undefined) {
        const text = `${count} movement${count === 1 ? "" : "s"} hidden ▸`;
        ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
        const w = ctx.measureText(text).width + 14;
        // Beside the node, on the side its hidden branch continues.
        const chip = { id: node.id, x: (node.depth ?? 0) < 0 ? p.x - width / 2 - w - 10 : p.x + width / 2 + 10, y: p.y - 10, width: w, height: 20 };
        ctx.fillStyle = palette.card; ctx.strokeStyle = palette.muted; ctx.lineWidth = 1 / t.k;
        ctx.beginPath(); ctx.roundRect(chip.x, chip.y, chip.width, chip.height, 10); ctx.fill(); ctx.stroke();
        ctx.fillStyle = palette.fg; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(text, chip.x + 7, chip.y + 10.5); ctx.textBaseline = "alphabetic";
        chipsRef.current.push(chip);
      }
      ctx.globalAlpha = 1;
    }
    for (const annotation of annotations) {
      if (annotation.kind !== "note") continue;
      const box = annotationBox(annotation)!, isSelected = selection.annotations.includes(annotation.id);
      const tint = annotation.color === "default" ? null : palette[annotation.color];
      const { font, align } = textStyle(annotation);
      if (annotation.variant === "text") {
        // Text on its own: no card, an outline only while selected (or while empty, so it can be found).
        if (isSelected || !annotation.text) { ctx.strokeStyle = isSelected ? palette.primary : palette.muted; ctx.lineWidth = 1 / t.k; ctx.setLineDash([3 / t.k, 3 / t.k]); ctx.strokeRect(box.x, box.y, box.width, box.height); ctx.setLineDash([]); }
        if (editing !== annotation.id) drawText(annotation.text || (isSelected ? "" : "Text"), box, font, tint ?? palette.fg, align, "top");
        continue;
      }
      ctx.fillStyle = tint ?? palette.accent; ctx.globalAlpha = 0.25; ctx.fillRect(box.x, box.y, box.width, box.height); ctx.globalAlpha = 1;
      ctx.strokeStyle = isSelected ? palette.primary : palette.muted; ctx.lineWidth = 2 / t.k; ctx.strokeRect(box.x, box.y, box.width, box.height);
      if (editing !== annotation.id) drawText(annotation.text, box, font, palette.fg, align, "top");
    }
    const single = selection.annotations.length === 1 && !selection.nodes.length;
    const active = single ? annotations.find((item) => item.id === selection.annotations[0]) : undefined;
    const box = active && annotationBox(active);
    // Several things selected: one dashed box around them all.
    if (selection.nodes.length + selection.annotations.length > 1) {
      const all = boundsOf(selectionBoxes());
      if (all) { ctx.strokeStyle = palette.primary; ctx.lineWidth = 1 / t.k; ctx.setLineDash([4 / t.k, 3 / t.k]); ctx.strokeRect(all.x - 6, all.y - 6, all.width + 12, all.height + 12); ctx.setLineDash([]); }
    }
    // A padlock on each selected item that's locked.
    for (const b of [...selection.nodes.filter(lockedNode).map(nodeBox), ...selection.annotations.filter(lockedAnnotation).map((id) => { const a = annotations.find((x) => x.id === id); return a ? itemBox(a) : null; })]) {
      if (!b) continue;
      const x = b.x + b.width + 4 / t.k, y = b.y - 4 / t.k, r = 6 / t.k;
      ctx.fillStyle = palette.card; ctx.strokeStyle = palette.muted; ctx.lineWidth = 1 / t.k;
      ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - r * 0.3, r * 0.5, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = palette.muted; ctx.fillRect(x - r * 0.7, y - r * 0.2, r * 1.4, r);
    }
    ctx.strokeStyle = palette.guide; ctx.lineWidth = 1 / t.k;
    for (const g of guidesRef.current) { ctx.beginPath(); if (g.axis === "x") { ctx.moveTo(g.at, g.from - 12); ctx.lineTo(g.at, g.to + 12); } else { ctx.moveTo(g.from - 12, g.at); ctx.lineTo(g.to + 12, g.at); } ctx.stroke(); }
    if (box) { ctx.fillStyle = palette.primary; for (const handle of HANDLES.filter((h) => h.length === 2)) { const p = handle === "nw" ? [box.x, box.y] : handle === "n" ? [box.x + box.width / 2, box.y] : handle === "ne" ? [box.x + box.width, box.y] : handle === "e" ? [box.x + box.width, box.y + box.height / 2] : handle === "se" ? [box.x + box.width, box.y + box.height] : handle === "s" ? [box.x + box.width / 2, box.y + box.height] : handle === "sw" ? [box.x, box.y + box.height] : [box.x, box.y + box.height / 2]; ctx.fillRect(p[0] - 4 / t.k, p[1] - 4 / t.k, 8 / t.k, 8 / t.k); } }
    if (active?.kind === "connector") {
      const path = pathOf(active, drawing);
      if (path) {
        ctx.fillStyle = palette.primary;
        for (const p of [path[0], path[path.length - 1]]) ctx.fillRect(p.x - 5 / t.k, p.y - 5 / t.k, 10 / t.k, 10 / t.k);
        // The label's handle: drag it along the line.
        if (active.label) { const at = labelHandle(path, active), r = 5 / t.k; ctx.beginPath(); ctx.moveTo(at.x, at.y - r); ctx.lineTo(at.x + r, at.y); ctx.lineTo(at.x, at.y + r); ctx.lineTo(at.x - r, at.y); ctx.closePath(); ctx.fill(); }
      }
    }
    // Connection dots on the sides of a single selected node or shape: drag one to another to connect them.
    const owner = !dragRef.current && portOwner();
    if (owner) {
      ctx.strokeStyle = palette.primary; ctx.lineWidth = 1.5 / t.k;
      for (const side of SIDES) {
        const q = sidePoint(owner.box, side), on = hoverPortRef.current === side;
        ctx.beginPath(); ctx.arc(q.x, q.y, (on ? 5.5 : 4) / t.k, 0, Math.PI * 2);
        ctx.fillStyle = on ? palette.primary : palette.bg; ctx.fill(); ctx.stroke();
      }
    }
    // Connection points of the node or shape under the pointer while connecting; the one it will snap to is filled.
    const anchor = anchorRef.current;
    if (anchor) {
      ctx.strokeStyle = palette.primary; ctx.lineWidth = 1.5 / t.k;
      ctx.setLineDash([3 / t.k, 2 / t.k]); ctx.strokeRect(anchor.box.x - 3, anchor.box.y - 3, anchor.box.width + 6, anchor.box.height + 6); ctx.setLineDash([]);
      for (const side of SIDES) {
        const q = sidePoint(anchor.box, side), on = anchor.side.kind !== "point" && anchor.side.side === side;
        ctx.beginPath(); ctx.arc(q.x, q.y, (on ? 5 : 3.5) / t.k, 0, Math.PI * 2);
        ctx.fillStyle = on ? palette.primary : palette.bg; ctx.fill(); ctx.stroke();
      }
    }
    if (marquee) {
      ctx.globalAlpha = 0.06; ctx.fillStyle = palette.primary; ctx.fillRect(Math.min(marquee.a.x, marquee.b.x), Math.min(marquee.a.y, marquee.b.y), Math.abs(marquee.b.x - marquee.a.x), Math.abs(marquee.b.y - marquee.a.y)); ctx.globalAlpha = 1;
      ctx.strokeStyle = palette.primary; ctx.lineWidth = 1 / t.k; ctx.setLineDash([5 / t.k, 3 / t.k]);
      ctx.strokeRect(Math.min(marquee.a.x, marquee.b.x), Math.min(marquee.a.y, marquee.b.y), Math.abs(marquee.b.x - marquee.a.x), Math.abs(marquee.b.y - marquee.a.y));
      ctx.setLineDash([]);
    }
  };
  useEffect(() => { drawRef.current = draw; requestDraw(); });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const behavior = zoom<HTMLCanvasElement, unknown>().scaleExtent([0.2, 4]).filter((event: MouseEvent | TouchEvent) => event.type.startsWith("touch") || (event instanceof MouseEvent && (event.button === 1 || spaceRef.current))).on("zoom", (event: { transform: ZoomTransform }) => { transformRef.current = event.transform; requestDraw(); })
      .on("start", () => setPanning(true))
      .on("end", (event: { transform: ZoomTransform }) => { const { x, y, k } = event.transform; setPanning(false); setViewT({ x, y, k }); onTransformRef.current?.({ x, y, k }); });
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
      // Anywhere inside, filled or not: a shape is picked up like a draw.io shape. Nodes on top of it still win (see onPointerDown).
      return contains(box, p);
    }
    const path = pathOf(item);
    return path && projectOnto(path, p).distance < 8 / transformRef.current.k;
  });
  /**
   * Where a connector end lands: on a node or shape (snapped to a side's
   * connection point when the pointer is near one, as in draw.io), else a free point.
   */
  const anchorAt = (p: Point): { box: Box; side: AnnotationEnd } | null => {
    const radius = 14 / transformRef.current.k;
    const targets: { box: Box; end: (side?: Side) => AnnotationEnd }[] = [
      ...view.nodes.flatMap((n) => { const b = nodeBox(n.id); return b ? [{ box: b, end: (side?: Side) => ({ kind: "node" as const, id: n.id, ...(side ? { side } : {}) }) }] : []; }),
      ...[...presentation.annotations].reverse().flatMap((a) => { const b = a.kind !== "connector" ? annotationBox(a) : null; return b ? [{ box: b, end: (side?: Side) => ({ kind: "annotation" as const, id: a.id, ...(side ? { side } : {}) }) }] : []; }),
    ];
    for (const target of targets) { const side = nearestSide(target.box, p, radius); if (side) return { box: target.box, side: target.end(side) }; }
    const inside = targets.find((target) => contains(target.box, p));
    return inside ? { box: inside.box, side: inside.end() } : null;
  };
  const endAt = (p: Point): AnnotationEnd => anchorAt(p)?.side ?? { kind: "point", at: p };
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
    const scale = Math.min(MAX_FIT_ZOOM, Math.max(0.2, Math.min(size.width / (right - left), size.height / (bottom - top))));
    const t = zoomIdentity.translate((size.width - scale * (left + right)) / 2, (size.height - scale * (top + bottom)) / 2).scale(scale);
    if (zoomRef.current) select(canvas).call(zoomRef.current.transform, t);
    requestDraw();
  };
  const groupOf = (kind: "node" | "annotation", id: string) => (kind === "node" ? presentation.nodeStyles[id]?.group : presentation.annotations.find((a) => a.id === id)?.group);
  /** Everything in the same groups as the selection: picking one member picks the group, as in Figma. */
  const withGroups = (sel: TraceSelection): TraceSelection => {
    const groups = new Set([...sel.nodes.map((id) => groupOf("node", id)), ...sel.annotations.map((id) => groupOf("annotation", id))].filter((g): g is string => !!g));
    if (!groups.size) return sel;
    return {
      nodes: [...new Set([...sel.nodes, ...view.nodes.filter((n) => groups.has(presentation.nodeStyles[n.id]?.group ?? "")).map((n) => n.id)])],
      edges: sel.edges,
      annotations: [...new Set([...sel.annotations, ...presentation.annotations.filter((a) => a.group && groups.has(a.group)).map((a) => a.id)])],
    };
  };
  /** What a move of this selection carries: the selected nodes and annotations, plus whatever sits inside a selected frame. */
  const moveSet = (sel: TraceSelection) => {
    const nodes = new Set(sel.nodes), ids = new Set(sel.annotations);
    for (const frame of presentation.annotations) {
      if (!ids.has(frame.id) || frame.kind !== "shape" || frame.shape !== "frame") continue;
      const box = annotationBox(frame)!;
      for (const node of view.nodes) if (positionsRef.current[node.id] && contains(box, positionsRef.current[node.id])) nodes.add(node.id);
      for (const a of presentation.annotations) { const b = a.kind !== "connector" ? annotationBox(a) : null; if (b && a.id !== frame.id && contains(box, { x: b.x + b.width / 2, y: b.y + b.height / 2 })) ids.add(a.id); }
    }
    // Locked things stay put, whatever else moves.
    return {
      nodes: Object.fromEntries([...nodes].filter((id) => positionsRef.current[id] && !lockedNode(id)).map((id) => [id, { ...positionsRef.current[id] }])),
      // An attached connector follows what it's attached to; only free ones move themselves.
      items: presentation.annotations.filter((a) => ids.has(a.id) && !a.locked && (a.kind !== "connector" || (a.from.kind === "point" && a.to.kind === "point"))),
    };
  };
  const hitAt = (p: Point): { kind: "node" | "annotation"; id: string } | null => {
    const note = [...presentation.annotations].reverse().find((item) => item.kind === "note" && contains(annotationBox(item)!, p));
    const annotation = note ?? annotationAt(p), node = nodeAt(p);
    return annotation && (annotation.kind === "note" || !node) ? { kind: "annotation", id: annotation.id } : node ? { kind: "node", id: node.id } : null;
  };
  const begin = (event: React.PointerEvent<HTMLCanvasElement>, drag: Drag) => { dragRef.current = drag; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "touch" || event.button !== 0 || spaceRef.current) return;
    setMenu(null);
    const p = world(event), k = transformRef.current.k;
    const chip = chipsRef.current.find((c) => contains(c, p));
    if (tool === "select" && chip) { onBranchHidden(chip.id, false); return; }
    if (tool !== "select") return begin(event, { kind: "create", origin: p, moved: false, from: tool === "connector" || tool === "arrow" ? endAt(p) : undefined });
    // A connection dot starts a connector from the selected node or shape.
    const port = portAt(p);
    if (port) return begin(event, { kind: "create", origin: p, moved: false, from: port });
    // Handles of a single selected annotation come first.
    const single = selection.annotations.length === 1 && !selection.nodes.length ? presentation.annotations.find((item) => item.id === selection.annotations[0] && !item.locked) : undefined;
    if (single?.kind === "connector") {
      const points = connectorPoints(single, connectorLayout(), connectorBox);
      const end = points && (Math.hypot(points.from.x - p.x, points.from.y - p.y) <= 8 / k ? "from" : Math.hypot(points.to.x - p.x, points.to.y - p.y) <= 8 / k ? "to" : null);
      if (end) return begin(event, { kind: "connector-end", origin: p, moved: false, annotation: single, end });
      const path = pathOf(single), at = path && labelHandle(path, single);
      if (single.label && at && Math.hypot(at.x - p.x, at.y - p.y) <= 10 / k) return begin(event, { kind: "label", origin: p, moved: false, annotation: single });
    }
    const singleBox = single && single.kind !== "connector" ? annotationBox(single) : null;
    const handle = singleBox ? handleAt(singleBox, p, 8 / k) : null;
    if (single && handle) return begin(event, { kind: "resize", origin: p, moved: false, annotation: single, handle });

    const hit = hitAt(p);
    if (hit) {
      const list = hit.kind === "node" ? selection.nodes : selection.annotations;
      const inSelection = list.includes(hit.id);
      let next: TraceSelection;
      const group = withGroups({ nodes: hit.kind === "node" ? [hit.id] : [], edges: [], annotations: hit.kind === "annotation" ? [hit.id] : [] });
      if (event.shiftKey) {
        const drop = (ids: string[], gone: string[]) => ids.filter((id) => !gone.includes(id));
        next = inSelection ? { nodes: drop(selection.nodes, group.nodes), edges: [], annotations: drop(selection.annotations, group.annotations) } : { nodes: [...new Set([...selection.nodes, ...group.nodes])], edges: [], annotations: [...new Set([...selection.annotations, ...group.annotations])] };
      } else next = inSelection ? { ...selection, edges: [] } : group;
      choose(next);
      if (event.shiftKey && inSelection) return;
      const copies = event.altKey && next.annotations.length > 0;
      const set = moveSet(next);
      return begin(event, { kind: "move", origin: p, moved: false, nodes: copies ? {} : set.nodes, items: copies ? cloneAnnotations(presentation.annotations.filter((a) => next.annotations.includes(a.id)), { x: 0, y: 0 }) : set.items, copies, clicked: inSelection && !event.shiftKey ? hit : null });
    }
    const edge = edgeAt(p);
    if (edge) { choose({ nodes: [], edges: [edge.id], annotations: [] }); requestDraw(); return; }
    if (!event.shiftKey) choose({ nodes: [], edges: [], annotations: [] });
    begin(event, { kind: "marquee", origin: p, moved: false, additive: event.shiftKey });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "touch") return;
    const p = world(event), drag = dragRef.current;
    const connecting = tool === "connector" || tool === "arrow" || drag?.kind === "connector-end" || (drag?.kind === "create" && drag.from !== undefined);
    const anchor = connecting ? anchorAt(p) : null;
    if (anchor?.box !== anchorRef.current?.box || JSON.stringify(anchor?.side) !== JSON.stringify(anchorRef.current?.side)) { anchorRef.current = anchor; requestDraw(); }
    if (!drag) {
      const port = portAt(p), side = port && port.kind !== "point" ? port.side ?? null : null;
      if (side !== hoverPortRef.current) { hoverPortRef.current = side; event.currentTarget.style.cursor = side ? "crosshair" : ""; requestDraw(); }
    }
    if (!drag) { const item = nodeAt(p)?.id ?? edgeAt(p)?.id ?? null; if (item !== hover) { const r = canvasRef.current!.getBoundingClientRect(); setHover(item); setHoverAt({ x: event.clientX - r.left, y: event.clientY - r.top }); } return; }
    const k = transformRef.current.k;
    if (Math.hypot(p.x - drag.origin.x, p.y - drag.origin.y) > 2 / k) drag.moved = true;
    if (!drag.moved) return;
    const raw = { x: p.x - drag.origin.x, y: p.y - drag.origin.y };
    if (drag.kind === "move") {
      let delta = raw;
      guidesRef.current = [];
      // Smart guides line edges and centres up with everything else, unless the grid is snapping (or Ctrl/⌘ is held).
      if (!presentation.canvas.snap && !event.metaKey && !event.ctrlKey) {
        const moving = new Set([...Object.keys(drag.nodes), ...drag.items.map((a) => a.id)]);
        const startBoxes = [...Object.keys(drag.nodes).map((id) => { const b = nodeBox(id); const at = positionsRef.current[id], from = drag.nodes[id]; return b && { ...b, x: b.x - at.x + from.x, y: b.y - at.y + from.y }; }), ...drag.items.map(itemBox)].filter((b): b is Box => !!b);
        const bounds = boundsOf(startBoxes);
        if (bounds) {
          const others = [...view.nodes.filter((n) => !moving.has(n.id)).map((n) => nodeBox(n.id)), ...presentation.annotations.filter((a) => !moving.has(a.id) && a.kind !== "connector").map(itemBox)].filter((b): b is Box => !!b);
          const snapped = snapToGuides({ ...bounds, x: bounds.x + raw.x, y: bounds.y + raw.y }, others, 6 / k);
          delta = { x: raw.x + snapped.dx, y: raw.y + snapped.dy };
          guidesRef.current = snapped.guides;
        }
      }
      for (const [id, at] of Object.entries(drag.nodes)) positionsRef.current[id] = { x: at.x + delta.x, y: at.y + delta.y };
      draftsRef.current = new Map(drag.items.map((a) => [a.id, translated(a, delta)]));
    } else if (drag.kind === "resize") {
      const item = drag.annotation;
      if (item.kind !== "connector") {
        const box = resizeBox(annotationBox(item)!, drag.handle, raw, event.shiftKey, item.kind === "note" ? MIN_NOTE : MIN_SHAPE);
        draftsRef.current = new Map([[item.id, { ...item, at: { x: box.x, y: box.y }, width: box.width, height: box.height }]]);
      }
    } else if (drag.kind === "connector-end") draftsRef.current = new Map([[drag.annotation.id, { ...drag.annotation, [drag.end]: endAt(p) }]]);
    else if (drag.kind === "label") { const path = pathOf(drag.annotation); if (path) draftsRef.current = new Map([[drag.annotation.id, { ...drag.annotation, labelAt: Math.round(projectOnto(path, p).t * 1000) / 1000 }]]); }
    else if (drag.kind === "create" && drag.from !== undefined) { const id = "draft-connector"; draftsRef.current = new Map([[id, { id, kind: "connector", from: drag.from, to: endAt(p), label: "", arrow: tool === "connector" ? "none" : "end", color: "gray", ...(tool === "select" ? { lineStyle: "solid" as const } : {}) }]]); }
    else setMarquee({ a: drag.origin, b: p });
    requestDraw();
  };

  const finish = () => { dragRef.current = null; draftsRef.current = new Map(); guidesRef.current = []; anchorRef.current = null; setMarquee(null); setDragging(false); requestDraw(); };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = world(event);
    if (drag.kind === "move") {
      if (!drag.moved) {
        // A plain click on one item of a multi-selection narrows to it, as in Figma.
        if (drag.clicked && selection.nodes.length + selection.annotations.length > 1) choose(withGroups({ nodes: drag.clicked.kind === "node" ? [drag.clicked.id] : [], edges: [], annotations: drag.clicked.kind === "annotation" ? [drag.clicked.id] : [] }));
      } else {
        const grid = (at: Point) => (presentation.canvas.snap ? snap(at, GRID) : at);
        const drafts = [...draftsRef.current.values()].map((a) => (a.kind === "connector" ? a : { ...a, at: grid(a.at) }));
        if (drag.copies) { onAddAnnotations(drafts); choose({ nodes: [], edges: [], annotations: drafts.map((a) => a.id) }); }
        else {
          const moved = Object.fromEntries(Object.keys(drag.nodes).map((id) => [id, grid(positionsRef.current[id])]));
          Object.assign(positionsRef.current, moved);
          onMove(moved, drafts.map((a) => ({ id: a.id, patch: a.kind === "connector" ? { from: a.from, to: a.to } : { at: a.at } })));
        }
      }
    } else if (drag.kind === "label" && drag.moved) {
      const draft = draftsRef.current.get(drag.annotation.id);
      if (draft?.kind === "connector") onUpdateAnnotation(draft.id, { labelAt: draft.labelAt });
    } else if ((drag.kind === "resize" || drag.kind === "connector-end") && drag.moved) {
      const draft = draftsRef.current.get(drag.annotation.id);
      if (draft) onUpdateAnnotation(draft.id, draft.kind === "connector" ? { from: draft.from, to: draft.to } : { at: presentation.canvas.snap ? snap(draft.at, GRID) : draft.at, width: draft.width, ...(draft.height !== undefined ? { height: draft.height } : {}) });
    } else if (drag.kind === "create") {
      const id = crypto.randomUUID(), to = endAt(p);
      // From a connection dot, keep the line only when it lands on another node or shape.
      if (tool === "select" && (to.kind === "point" || (drag.from?.kind !== "point" && to.id === drag.from?.id))) return finish();
      if (drag.from && tool === "select") onAddAnnotation({ id, kind: "connector", from: drag.from, to, label: "", arrow: "end", color: "gray", lineStyle: "solid" });
      else if (tool === "connector" || tool === "arrow") onAddAnnotation({ id, kind: "connector", from: drag.from ?? { kind: "point", at: drag.origin }, to: endAt(p), label: "", arrow: tool === "arrow" ? "end" : "none", color: "gray", ...(tool === "arrow" ? { strokeWidth: 2 as const } : {}) });
      else if (tool === "text") { const text: Annotation = { id, kind: "note", variant: "text", at: p, width: 220, height: 32, text: "", color: "default", fontSize: "l" }; onAddAnnotation(text); showEditor(text); }
      else if (tool === "note") { const note: Annotation = { id, kind: "note", at: p, width: 200, height: 96, text: "", color: "yellow" }; onAddAnnotation(note); showEditor(note); }
      else { const box = boxFrom(drag.origin, p); onAddAnnotation({ id, kind: "shape", shape: tool === "rect" ? "rect" : tool === "ellipse" ? "ellipse" : "frame", at: { x: box.x, y: box.y }, width: Math.max(80, box.width), height: Math.max(48, box.height), label: "", stroke: "gray", fill: "none" }); }
      choose({ nodes: [], edges: [], annotations: [id] });
      if (!event.shiftKey) setTool("select");
    } else if (drag.kind === "marquee" && drag.moved) {
      const area = boxFrom(drag.origin, p);
      const inside = (b: Box | null) => !!b && b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height;
      const nodes = view.nodes.filter((n) => { const q = positionsRef.current[n.id]; return q && contains(area, q); }).map((n) => n.id);
      const annotations = presentation.annotations.filter((a) => inside(itemBox(a))).map((a) => a.id);
      choose(withGroups(drag.additive ? { nodes: [...new Set([...selection.nodes, ...nodes])], edges: [], annotations: [...new Set([...selection.annotations, ...annotations])] } : { nodes, edges: [], annotations }));
    }
    finish();
  };
  const onPointerCancel = () => {
    const drag = dragRef.current;
    if (drag?.kind === "move") Object.assign(positionsRef.current, drag.nodes);
    finish();
  };
  const beginEdit = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const item = annotationAt(world(event));
    if (!item) return;
    showEditor(item);
  };
  /** The editor sits exactly over the text it edits, at the canvas's zoom; a connector's label edits in a small box at its middle. */
  const showEditor = (item: Annotation) => {
    const t = transformRef.current;
    let box: Box | null;
    if (item.kind === "connector") {
      const points = connectorPoints(item, connectorLayout(), connectorBox);
      box = points && { x: (points.from.x + points.to.x) / 2 - 100 / t.k, y: (points.from.y + points.to.y) / 2 - 20 / t.k, width: 200 / t.k, height: 40 / t.k };
    } else {
      const full = annotationBox(item)!;
      box = item.kind === "shape" && item.shape === "frame" ? { ...full, height: Math.min(full.height, LABEL_FONT.line + LABEL_FONT.pad * 2) } : item.kind === "shape" && item.shape === "icon" ? { x: full.x - 30, y: full.y + full.height - 26, width: full.width + 60, height: 30 } : full;
    }
    if (!box) return;
    cancelEditRef.current = false; setEditing(item.id); setEditText(item.kind === "note" ? item.text : item.label);
    setEditScreen({ x: t.applyX(box.x), y: t.applyY(box.y), width: Math.max(120, box.width * t.k), height: Math.max(36, box.height * t.k), scale: item.kind === "connector" ? 1 : t.k });
  };
  /** A note grows to fit its text on commit; it never shrinks below what the investigator sized it to. */
  const noteHeightFor = (note: Extract<Annotation, { kind: "note" }>, text: string, width: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return MIN_NOTE.height;
    const { font } = textStyle(note);
    ctx.font = `${font.size}px ui-sans-serif, system-ui, sans-serif`;
    return wrapText(text, Math.max(1, width - font.pad * 2), (line) => ctx.measureText(line).width).length * font.line + font.pad * 2;
  };
  const commitEdit = () => {
    const item = presentation.annotations.find((annotation) => annotation.id === editing);
    if (item && !cancelEditRef.current) {
      const text = editText.slice(0, 2000);
      if (item.kind === "note") {
        const box = annotationBox(item)!;
        const needed = Math.max(item.variant === "text" ? 24 : MIN_NOTE.height, noteHeightFor(item, text, box.width));
        if (text !== item.text || item.height === undefined || needed > box.height) onUpdateAnnotation(item.id, { text, height: Math.max(box.height, needed) });
      } else if (text !== item.label) onUpdateAnnotation(item.id, { label: text });
    }
    cancelEditRef.current = false;
    setEditing(null);
  };
  const selected = () => presentation.annotations.filter((a) => selection.annotations.includes(a.id));
  const copy = () => { const items = selected(); if (items.length) clipboard = { items: structuredClone(items), pastes: 0 }; else if (selection.nodes.length) void navigator.clipboard.writeText(selection.nodes.join("\n")); };
  /** Pasted copies land offset from the originals (further each time), or at `at` when pasting from a right-click. */
  const paste = (at?: Point) => {
    if (!clipboard.items.length) return;
    clipboard.pastes++;
    const bounds = boundsOf(clipboard.items.map(itemBox).filter((b): b is Box => !!b));
    const offset = at && bounds ? { x: at.x - bounds.x, y: at.y - bounds.y } : { x: 24 * clipboard.pastes, y: 24 * clipboard.pastes };
    const copies = cloneAnnotations(clipboard.items, offset);
    onAddAnnotations(copies);
    choose({ nodes: [], edges: [], annotations: copies.map((a) => a.id) });
  };
  const duplicate = () => { const items = selected(); if (!items.length) return; const copies = cloneAnnotations(items, { x: 24, y: 24 }); onAddAnnotations(copies); choose({ nodes: [], edges: [], annotations: copies.map((a) => a.id) }); };
  /** An icon dropped in the middle of the view, selected, ready to move or label (as in Canva). */
  const placeIcon = (icon: IconKey) => {
    const t = transformRef.current, centre = { x: (size.width / 2 - t.x) / t.k, y: (size.height / 2 - t.y) / t.k };
    const item: Annotation = { id: crypto.randomUUID(), kind: "shape", shape: "icon", icon, at: { x: centre.x - 32, y: centre.y - 40 }, width: 64, height: 84, label: ICONS[icon].label, stroke: "default", fill: "none" };
    onAddAnnotation(item);
    choose({ nodes: [], edges: [], annotations: [item.id] });
    canvasRef.current?.focus();
  };
  const removeSelected = () => {
    const removable = selection.annotations.filter((id) => !lockedAnnotation(id));
    if (removable.length) { onRemoveAnnotations(new Set(removable)); choose({ nodes: [], edges: [], annotations: selection.annotations.filter((id) => !removable.includes(id)) }); }
    else if (selection.edges.length) onRemoveEvidence(new Set(view.edges.filter((edge) => selection.edges.includes(edge.id)).flatMap((edge) => edge.steps)));
  };
  /** Arrow keys move the selection by 1 (10 with Shift), as in every design tool. */
  const nudge = (dx: number, dy: number) => {
    const set = moveSet(selection);
    const moved = Object.fromEntries(Object.entries(set.nodes).map(([id, at]) => [id, { x: at.x + dx, y: at.y + dy }]));
    Object.assign(positionsRef.current, moved);
    onMove(moved, set.items.map((a) => { const t = translated(a, { x: dx, y: dy }); return { id: a.id, patch: t.kind === "connector" ? { from: t.from, to: t.to } : { at: t.at } }; }));
    requestDraw();
  };
  const count = selection.nodes.length + selection.annotations.length;
  const grouped = selection.nodes.some((id) => groupOf("node", id)) || selection.annotations.some((id) => groupOf("annotation", id));
  const allLocked = count > 0 && selection.nodes.every(lockedNode) && selection.annotations.every(lockedAnnotation);
  /** One change to every selected node's style and annotation, as a single edit. */
  const organise = (node: Partial<NodeStyle>, annotation: Partial<Annotation>) => onMove({}, selection.annotations.map((id) => ({ id, patch: annotation })), Object.fromEntries(selection.nodes.map((id) => [id, node])));
  const group = () => { if (count < 2) return; const id = crypto.randomUUID(); organise({ group: id }, { group: id }); };
  const ungroup = () => organise({ group: undefined }, { group: undefined });
  const toggleLock = () => organise({ locked: allLocked ? undefined : true }, { locked: allLocked ? undefined : true });
  /** Align or distribute the unlocked selected items by their boxes. */
  const arrange = (deltasFor: (items: { id: string; box: Box }[]) => Map<string, Point>) => {
    const items = [...selection.nodes.filter((id) => !lockedNode(id)).map((id) => ({ id: `n:${id}`, box: nodeBox(id) })), ...presentation.annotations.filter((a) => selection.annotations.includes(a.id) && !a.locked && a.kind !== "connector").map((a) => ({ id: `a:${a.id}`, box: annotationBox(a) }))].filter((i): i is { id: string; box: Box } => !!i.box);
    const deltas = deltasFor(items);
    const positions = Object.fromEntries([...deltas].filter(([id]) => id.startsWith("n:")).map(([id, d]) => { const at = positionsRef.current[id.slice(2)]; return [id.slice(2), { x: at.x + d.x, y: at.y + d.y }]; }));
    Object.assign(positionsRef.current, positions);
    onMove(positions, [...deltas].filter(([id]) => id.startsWith("a:")).map(([id, d]) => { const a = translated(presentation.annotations.find((x) => x.id === id.slice(2))!, d); return { id: a.id, patch: a.kind === "connector" ? { from: a.from, to: a.to } : { at: a.at } }; }));
    requestDraw();
  };
  const align = (mode: AlignMode) => arrange((items) => alignDeltas(items, mode));
  const distribute = (axis: "x" | "y") => arrange((items) => distributeDeltas(items, axis));
  const zoomTo = (box: Box | null) => {
    const canvas = canvasRef.current;
    if (!canvas || !box || !zoomRef.current) return;
    const pad = 80, scale = Math.min(MAX_FIT_ZOOM * 2, Math.max(0.2, Math.min(size.width / (box.width + pad * 2), size.height / (box.height + pad * 2))));
    select(canvas).call(zoomRef.current.transform, zoomIdentity.translate(size.width / 2 - scale * (box.x + box.width / 2), size.height / 2 - scale * (box.y + box.height / 2)).scale(scale));
  };
  const zoomBy = (k: number) => { if (canvasRef.current && zoomRef.current) select(canvasRef.current).call(zoomRef.current.scaleTo, k); };
  /** On the whole canvas area, so shortcuts keep working after using the toolbar; typing in a field is left alone. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
    const mod = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
    if (event.key === " ") { if (event.target === canvasRef.current) { spaceRef.current = true; event.preventDefault(); } return; }
    if (event.key === "Escape" && focusTarget) { setFocusTarget(null); return; }
    if (event.key === "Escape") { setTool("select"); setMenu(null); choose({ nodes: [], edges: [], annotations: [] }); return; }
    if (event.shiftKey && key === "f") { fit(); event.preventDefault(); return; }
    if (event.shiftKey && event.key === "@") { zoomTo(boundsOf(selectionBoxes())); event.preventDefault(); return; }
    if (mod && key === "a") { choose({ nodes: view.nodes.map((n) => n.id), edges: [], annotations: presentation.annotations.map((a) => a.id) }); event.preventDefault(); return; }
    if (mod && key === "c") { copy(); event.preventDefault(); return; }
    if (mod && key === "v") { paste(); event.preventDefault(); return; }
    if (mod && key === "d") { duplicate(); event.preventDefault(); return; }
    if (mod && key === "g") { if (event.shiftKey) ungroup(); else group(); event.preventDefault(); return; }
    if (mod && event.shiftKey && key === "l") { toggleLock(); event.preventDefault(); return; }
    if (mod && (event.key === "]" || event.key === "[" || event.code === "BracketRight" || event.code === "BracketLeft")) { const up = event.key === "]" || event.code === "BracketRight"; onReorder(selection.annotations, event.shiftKey ? (up ? "front" : "back") : up ? "forward" : "backward"); event.preventDefault(); return; }
    // Alt+A/H/D align left/centre/right, Alt+W/V/S top/middle/bottom, as in Figma (codes, since Alt changes the character on a Mac).
    const alignKeys: Record<string, AlignMode> = { KeyA: "left", KeyH: "center", KeyD: "right", KeyW: "top", KeyV: "middle", KeyS: "bottom" };
    if (event.altKey && !mod && alignKeys[event.code] && count > 1) { align(alignKeys[event.code]); event.preventDefault(); return; }
    if (!mod && !event.altKey) {
      const shortcuts: Record<string, Tool> = { v: "select", n: "note", t: "text", r: "rect", e: "ellipse", f: "frame", c: "connector", a: "arrow" };
      if (shortcuts[key]) { setTool(shortcuts[key]); event.preventDefault(); return; }
    }
    if (event.key === "Delete" || event.key === "Backspace") { removeSelected(); event.preventDefault(); return; }
    if ((event.key === "[" || event.key === "]") && selection.nodes.length) { onCandidateDirection(event.key === "]" ? "forward" : "backward"); event.preventDefault(); return; }
    if (event.key === "0" && !mod) { zoomBy(1); event.preventDefault(); return; }
    if (!event.key.startsWith("Arrow") || !(selection.nodes.length || selection.annotations.length)) return;
    event.preventDefault();
    if (!event.altKey) {
      const step = event.shiftKey ? 10 : 1;
      nudge(event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0);
      return;
    }
    // Alt+arrows walk the trace: right and left follow movements, up and down move to the nearest node above or below.
    const current = selection.nodes[0];
    if (!current) return;
    const adjacent = event.key === "ArrowRight" ? view.edges.filter((e) => e.from === current).map((e) => e.to) : event.key === "ArrowLeft" ? view.edges.filter((e) => e.to === current).map((e) => e.from) : view.nodes.filter((n) => n.id !== current && (event.key === "ArrowUp" ? positionsRef.current[n.id]?.y < positionsRef.current[current]?.y : positionsRef.current[n.id]?.y > positionsRef.current[current]?.y)).map((n) => n.id);
    const next = adjacent.filter((id) => positionsRef.current[id]).sort((a, b) => Math.hypot(positionsRef.current[a].x - positionsRef.current[current].x, positionsRef.current[a].y - positionsRef.current[current].y) - Math.hypot(positionsRef.current[b].x - positionsRef.current[current].x, positionsRef.current[b].y - positionsRef.current[current].y))[0];
    if (next) choose({ nodes: [next], edges: [], annotations: [] });
  };

  const openMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const p = world(event), rect = event.currentTarget.getBoundingClientRect();
    const hit = hitAt(p), edge = hit ? null : edgeAt(p);
    const place = { x: event.clientX - rect.left, y: event.clientY - rect.top, at: p };
    if (hit) {
      const list = hit.kind === "node" ? selection.nodes : selection.annotations;
      if (!list.includes(hit.id)) choose({ nodes: hit.kind === "node" ? [hit.id] : [], edges: [], annotations: hit.kind === "annotation" ? [hit.id] : [] });
      setMenu({ kind: hit.kind, id: hit.id, ...place });
    } else if (edge) { choose({ nodes: [], edges: [edge.id], annotations: [] }); setMenu({ kind: "edge", id: edge.id, ...place }); }
    else setMenu({ kind: "canvas", id: "", ...place });
  };
  const hoverCard = (id: string) => {
    const node = nodeById.get(id);
    if (node) {
      const state = stateOf(node.addresses[0]);
      return <>
        <p className="font-medium text-foreground">{node.service ? `${node.service.name} · ${node.service.category}` : names.of(id)}</p>
        <p className="break-all font-mono text-[11px] text-muted-foreground">{node.addresses.join(", ")}</p>
        <p className="mt-1">{node.isSeed ? "Seed" : node.depth === null ? "Not connected to the seed" : `${Math.abs(node.depth)} hop${Math.abs(node.depth) === 1 ? "" : "s"} ${node.depth < 0 ? "back" : "forward"}`} · {state === "PRIMARY" ? "Primary wallet" : state === "MAPPED" ? "Mapped wallet" : state === "OBSERVED" ? "Observed address" : "Infrastructure"}</p>
        {node.boundaries.map((kind) => <p key={kind} className="text-muted-foreground">Stops here: {boundaryLabel[kind].toLowerCase()}</p>)}
        {node.conversions.length > 0 && <p className="text-muted-foreground">{node.conversions.length} conversion{node.conversions.length === 1 ? "" : "s"}</p>}
        {presentation.nodeStyles[id]?.note && <p className="mt-1 border-t pt-1">{presentation.nodeStyles[id]!.note}</p>}
      </>;
    }
    const edge = view.edges.find((e) => e.id === id);
    if (!edge) return null;
    return <>
      <p className="font-medium text-foreground">{nodeById.get(edge.from)?.service?.name ?? names.of(edge.from)} → {nodeById.get(edge.to)?.service?.name ?? names.of(edge.to)}</p>
      <p>{edgeLabel(edge)}</p>
      {edge.via?.some((v) => v.from !== edge.from || v.to !== edge.to) && <p className="break-all text-muted-foreground">Via {edge.via.map((v) => `${names.of(v.from)} → ${names.of(v.to)}`).join("; ")}</p>}
    </>;
  };
  const edited = presentation.annotations.find((item) => item.id === editing);

  // The quick toolbar floats just above whatever is selected (below it near the top edge), from saved positions so it never reads mid-drag state.
  const restingBox = (id: string, kind: "node" | "annotation"): Box | null => {
    if (kind === "node") { const node = nodeById.get(id), at = presentation.positions[id]; if (!node || !at) return null; const sz = nodeSize(node, presentation); return { x: at.x - sz.width / 2, y: at.y - sz.height / 2, width: sz.width, height: sz.height }; }
    const a = presentation.annotations.find((x) => x.id === id);
    if (!a) return null;
    if (a.kind !== "connector") return annotationBox(a);
    const from = resolveEnd(a.from, presentation.positions, presentation.annotations), to = resolveEnd(a.to, presentation.positions, presentation.annotations);
    return from && to ? boxFrom(from, to) : null;
  };
  const chosen = presentation.annotations.filter((a) => selection.annotations.includes(a.id));
  const restBounds = boundsOf([...selection.nodes.map((id) => restingBox(id, "node")), ...selection.annotations.map((id) => restingBox(id, "annotation"))].filter((b): b is Box => !!b));
  const colourOf = (a: Annotation) => (a.kind === "shape" ? a.stroke : a.color);
  const sameOr = <T,>(values: T[]): T | "mixed" => (values.every((v) => v === values[0]) ? values[0] : "mixed");
  const patchAll = (patch: (a: Annotation) => Partial<Annotation>) => onMove({}, chosen.map((a) => ({ id: a.id, patch: patch(a) })));
  const shapes = chosen.filter((a): a is Extract<Annotation, { kind: "shape" }> => a.kind === "shape");
  const connectors = chosen.filter((a): a is Extract<Annotation, { kind: "connector" }> => a.kind === "connector");
  const texts = chosen.filter((a): a is Exclude<Annotation, { kind: "connector" }> => a.kind !== "connector");
  const lined = chosen.filter((a): a is Exclude<Annotation, { kind: "note" }> => a.kind !== "note");
  const quickBar = restBounds && !dragging && !panning && !editing && !menu && (chosen.length > 0 || selection.nodes.length > 0) && (() => {
    const top = viewT.y + restBounds.y * viewT.k, bottom = viewT.y + (restBounds.y + restBounds.height) * viewT.k;
    const centre = viewT.x + (restBounds.x + restBounds.width / 2) * viewT.k;
    // Above the selection unless that would run into the main toolbar (or below would leave the canvas); always fully inside the canvas.
    const above = top - 46 > 120 || bottom + 50 > size.height;
    const left = Math.max(8, Math.min(centre - barWidth / 2, size.width - barWidth - 8));
    return <div ref={(el) => { if (el && Math.abs(el.offsetWidth - barWidth) > 1) setBarWidth(el.offsetWidth); }} className="pointer-events-auto absolute z-20 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-0.5 rounded-lg border bg-popover/95 p-0.5 shadow-lg backdrop-blur" style={{ left, top: above ? top - 46 : bottom + 10 }} onPointerDown={(e) => e.stopPropagation()}>
      {chosen.length > 0 ? <>
        <Swatches label={shapes.length === chosen.length ? "Outline colour" : "Colour"} value={sameOr(chosen.map(colourOf))} onPick={(color) => patchAll((a) => (a.kind === "shape" ? { stroke: color as ColorKey } : { color: color as ColorKey }))} />
        {shapes.length === chosen.length && <Swatches label="Fill" allowNone value={sameOr(shapes.map((a) => a.fill))} onPick={(fill) => patchAll(() => ({ fill }))} />}
        {texts.length === chosen.length && <>
          <Divider />
          <Choice label="Text size" value={sameOr(texts.map((a) => a.fontSize ?? "m"))} options={[["s", "S"], ["m", "M"], ["l", "L"]]} onPick={(fontSize) => patchAll(() => ({ fontSize }))} />
          <Choice label="Alignment" value={sameOr(texts.map((a) => textStyle(a).align))} options={[["left", <AlignLeftIcon key="l" />], ["center", <AlignCenterIcon key="c" />], ["right", <AlignRightIcon key="r" />]]} onPick={(align) => patchAll(() => ({ align }))} />
        </>}
        {lined.length === chosen.length && <>
          <Divider />
          <Choice label="Line width" value={sameOr(lined.map((a) => a.strokeWidth ?? 1))} options={[[1, <span key="1" className="block h-px w-4 bg-current" />], [2, <span key="2" className="block h-0.5 w-4 bg-current" />], [4, <span key="4" className="block h-1 w-4 bg-current" />]]} onPick={(strokeWidth) => patchAll(() => ({ strokeWidth }))} />
        </>}
        {connectors.length === chosen.length && <>
          <Choice label="Line style" value={sameOr(connectors.map((a) => a.lineStyle ?? "dashed"))} options={[["solid", <span key="s" className="block w-4 border-t-2 border-current" />], ["dashed", <span key="d" className="block w-4 border-t-2 border-dashed border-current" />]]} onPick={(lineStyle) => patchAll(() => ({ lineStyle }))} />
          <Choice label="Route" value={sameOr(connectors.map((a) => a.route ?? "straight"))} options={[["straight", <SlashIcon key="s" />], ["curved", <SplineIcon key="c" />], ["elbow", <CornerDownRightIcon key="e" />]]} onPick={(route) => patchAll(() => ({ route }))} />
          <Choice label="Arrowheads" value={sameOr(connectors.map((a) => a.arrow))} options={[["none", <MinusIcon key="n" />], ["end", <MoveRightIcon key="e" />], ["both", <MoveHorizontalIcon key="b" />]]} onPick={(arrow) => patchAll(() => ({ arrow }))} />
        </>}
        <Divider />
        <Button variant="ghost" size="icon-sm" aria-label="Duplicate" title="Duplicate (⌘D)" onClick={duplicate}><CopyIcon /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Bring to front" title="Bring to front" onClick={() => onReorder(selection.annotations, "front")}><BringToFrontIcon /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Send to back" title="Send to back" onClick={() => onReorder(selection.annotations, "back")}><SendToBackIcon /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Delete" title="Delete (⌫)" onClick={removeSelected}><Trash2Icon /></Button>
      </> : <>
        <Swatches label="Node colour" value={sameOr(selection.nodes.map((id) => presentation.nodeStyles[id]?.color ?? "default"))} onPick={(color) => onNodeStyles(selection.nodes, { color: color as ColorKey })} />
        {selection.nodes.length === 1 && <>
          <Divider />
          <Button variant="ghost" size="sm" onClick={() => onCandidateDirection("forward")} title="Add the next movements (])">Next</Button>
          <Button variant="ghost" size="sm" onClick={() => onCandidateDirection("backward")} title="Add earlier movements ([)">Earlier</Button>
          <Button variant="ghost" size="sm" onClick={() => setFocusTarget(selection.nodes[0])} title="Dim everything off the path from the seed">Focus</Button>
        </>}
      </>}
      <Divider />
      {count > 1 && <AlignMenu onAlign={align} onDistribute={distribute} canDistribute={count > 2} />}
      {count > 1 && !grouped && <Button variant="ghost" size="icon-sm" aria-label="Group" title="Group (⌘G)" onClick={group}><GroupIcon /></Button>}
      {grouped && <Button variant="ghost" size="icon-sm" aria-label="Ungroup" title="Ungroup (⇧⌘G)" onClick={ungroup}><UngroupIcon /></Button>}
      <Button variant={allLocked ? "secondary" : "ghost"} size="icon-sm" aria-label={allLocked ? "Unlock" : "Lock"} aria-pressed={allLocked} title={`${allLocked ? "Unlock" : "Lock in place"} (⇧⌘L)`} onClick={toggleLock}>{allLocked ? <LockIcon /> : <UnlockIcon />}</Button>
    </div>;
  })();

  return (
    <div ref={boxRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden" aria-label="Trace graph canvas" onKeyDown={onKeyDown}>
      <canvas ref={canvasRef} className="block h-full w-full touch-none outline-none" tabIndex={0} aria-label="Trace graph. Select nodes with click or arrow keys; press Shift F to fit." onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onPointerLeave={() => { if (!dragRef.current) setHover(null); }} onDoubleClick={beginEdit} onKeyUp={(e) => { if (e.key === " ") spaceRef.current = false; }} onBlur={() => { spaceRef.current = false; }} onContextMenu={openMenu} />
      {menu && <div role="menu" ref={menuRef} className="absolute z-20 grid min-w-48 overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-lg" style={{ maxHeight: size.height - 8 }} onKeyDown={(event) => { if (event.key === "Escape") setMenu(null); }}>
        {menu.kind === "node" && <>
          <button type="button" role="menuitem" className="rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { onCandidateDirection("forward"); setMenu(null); }}>Next movements</button>
          <button type="button" role="menuitem" className="rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { onCandidateDirection("backward"); setMenu(null); }}>Earlier movements</button>
          {(() => { const node = nodeById.get(menu.id), isHidden = hidden.counts.has(menu.id), direction = node && branchDirection(node); return direction && (isHidden || view.edges.some((e) => (direction === "forward" ? e.from : e.to) === menu.id)) ? <button type="button" role="menuitem" className="rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { onBranchHidden(menu.id, !isHidden); setMenu(null); }}>{isHidden ? "Show branch" : "Hide branch"}</button> : <button type="button" role="menuitem" disabled className="rounded-md px-2 py-1.5 text-left text-muted-foreground" title="Nothing downstream to hide, or this is the seed">Hide branch</button>; })()}
          <button type="button" role="menuitem" className="rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { setFocusTarget(menu.id); setMenu(null); canvasRef.current?.focus(); }}>Focus path</button>
          {stateOf(menu.id) === "OBSERVED" && <button type="button" role="menuitem" className="rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { onMapWallet(menu.id); setMenu(null); }}>Map wallet</button>}
          <button type="button" role="menuitem" className="rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { const p = positionsRef.current[menu.id]; if (p) onAddAnnotation({ id: crypto.randomUUID(), kind: "note", at: { x: p.x + 100, y: p.y + 40 }, width: 200, height: 96, text: "", color: "yellow" }); setMenu(null); }}>Add note here</button>
          <button type="button" role="menuitem" className="rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { void navigator.clipboard.writeText(menu.id); setMenu(null); }}>Copy address</button>
          <button type="button" role="menuitem" className="rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { onStartAtNode(nodeById.get(menu.id)?.addresses[0] ?? menu.id); setMenu(null); }}>Start new trace here</button>
        </>}
        {menu.kind === "edge" && <>
          <button type="button" role="menuitem" className="rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => setMenu(null)}>Show movements</button>
          <button type="button" role="menuitem" className="rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { onRemoveEvidence(new Set(view.edges.find((edge) => edge.id === menu.id)?.steps ?? [])); setMenu(null); }}>Remove movements</button>
          <button type="button" role="menuitem" className="rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { const signatures = [...new Set((view.edges.find((edge) => edge.id === menu.id)?.steps ?? []).map((id) => stepById.get(id)).filter((step): step is Extract<TraceStep, { kind: "movement" }> => step?.kind === "movement").map((step) => step.ref.signature))]; void navigator.clipboard.writeText(signatures.join("\n")); setMenu(null); }}>Copy signatures</button>
        </>}
        {menu.kind === "annotation" && <>
          <MenuItem onClick={() => { const a = presentation.annotations.find((x) => x.id === menu.id); if (a) showEditor(a); setMenu(null); }} shortcut="Double-click">Edit text</MenuItem>
          <MenuItem onClick={() => { duplicate(); setMenu(null); }} shortcut="⌘D">Duplicate</MenuItem>
          <MenuItem onClick={() => { copy(); setMenu(null); }} shortcut="⌘C">Copy</MenuItem>
          <MenuItem onClick={() => { onReorder(selection.annotations, "front"); setMenu(null); }} shortcut="⇧⌘]">Bring to front</MenuItem>
          <MenuItem onClick={() => { onReorder(selection.annotations, "forward"); setMenu(null); }} shortcut="⌘]">Bring forward</MenuItem>
          <MenuItem onClick={() => { onReorder(selection.annotations, "backward"); setMenu(null); }} shortcut="⌘[">Send backward</MenuItem>
          <MenuItem onClick={() => { onReorder(selection.annotations, "back"); setMenu(null); }} shortcut="⇧⌘[">Send to back</MenuItem>
          {count > 1 && !grouped && <MenuItem onClick={() => { group(); setMenu(null); }} shortcut="⌘G">Group</MenuItem>}
          {grouped && <MenuItem onClick={() => { ungroup(); setMenu(null); }} shortcut="⇧⌘G">Ungroup</MenuItem>}
          <MenuItem onClick={() => { toggleLock(); setMenu(null); }} shortcut="⇧⌘L">{allLocked ? "Unlock" : "Lock"}</MenuItem>
          <MenuItem onClick={() => { removeSelected(); setMenu(null); }} shortcut="⌫" destructive>Delete</MenuItem>
        </>}
        {menu.kind === "canvas" && <>
          <MenuItem disabled={!clipboard.items.length} onClick={() => { paste(menu.at); setMenu(null); }} shortcut="⌘V">Paste here</MenuItem>
          <MenuItem onClick={() => { const note: Annotation = { id: crypto.randomUUID(), kind: "note", at: menu.at, width: 200, height: 96, text: "", color: "yellow" }; onAddAnnotation(note); choose({ nodes: [], edges: [], annotations: [note.id] }); showEditor(note); setMenu(null); }}>Add note here</MenuItem>
          <MenuItem onClick={() => { choose({ nodes: view.nodes.map((n) => n.id), edges: [], annotations: presentation.annotations.map((a) => a.id) }); setMenu(null); }} shortcut="⌘A">Select all</MenuItem>
          <MenuItem onClick={() => { fit(); setMenu(null); }} shortcut="⇧F">Zoom to fit</MenuItem>
        </>}
      </div>}
      {/* The trace's own menu on the left, the toolbar centred in the room left; they wrap rather than overlap on narrow screens. */}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-wrap items-start gap-2 px-3">
        {overlay && <div className="pointer-events-auto shrink-0">{overlay}</div>}
        <div className="pointer-events-auto mx-auto flex flex-wrap items-center justify-center gap-1 rounded-xl border bg-popover/95 p-1 shadow-lg backdrop-blur">
          {toolbarStart}
          {toolbarStart && <Divider />}
          {TOOLS.map(({ tool: item, label, icon: Icon, key }) => <Button key={item} variant={tool === item ? "secondary" : "ghost"} size="icon-sm" aria-label={label} aria-pressed={tool === item} title={`${label} (${key})`} onClick={() => setTool(item)}><Icon /></Button>)}
          <IconPicker onPick={placeIcon} />
          <Divider />
          <Button variant="ghost" size="icon-sm" aria-label="Tidy layout" title="Tidy layout: arrange by hops from the seed" onClick={() => { const placed = tidyLayout({ view, positions: positionsRef.current, obstacles: [], grid: presentation.canvas.snap ? GRID : null, spacing: TRACE_SPACING }); Object.assign(positionsRef.current, placed); onMove(placed); requestDraw(); }}><NetworkIcon /></Button>
          <Divider />
          <Button variant={presentation.canvas.grid ? "secondary" : "ghost"} size="icon-sm" aria-label="Grid" aria-pressed={presentation.canvas.grid} title="Show grid" onClick={() => onOptions({ grid: !presentation.canvas.grid })}><Grid3x3Icon /></Button>
          <Button variant={presentation.canvas.snap ? "secondary" : "ghost"} size="icon-sm" aria-label="Snap to grid" aria-pressed={presentation.canvas.snap} title="Snap to grid" onClick={() => onOptions({ snap: !presentation.canvas.snap })}><MagnetIcon /></Button>
          <Divider />
          <ZoomMenu level={viewT.k} onFit={fit} onSelection={() => zoomTo(boundsOf(selectionBoxes()))} canSelection={selection.nodes.length + selection.annotations.length > 0} onZoom={zoomBy} />
          {toolbarEnd && <Divider />}
          {toolbarEnd}
        </div>
      </div>
      {edited && editScreen && <div className="absolute z-10" style={{ left: editScreen.x, top: editScreen.y, width: editScreen.width, height: editScreen.height }}>
        <textarea
          autoFocus
          maxLength={2000}
          aria-label={edited.kind === "note" ? "Note text" : "Label"}
          placeholder={edited.kind === "note" ? (edited.variant === "text" ? "Type…" : "Write a note…") : "Label"}
          className="size-full resize-none rounded-sm bg-popover/95 text-foreground shadow-lg outline-none ring-2 ring-ring"
          style={{ fontSize: textStyle(edited).font.size * editScreen.scale, lineHeight: `${textStyle(edited).font.line * editScreen.scale}px`, padding: textStyle(edited).font.pad * editScreen.scale, textAlign: textStyle(edited).align }}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => { if (e.key === "Escape") { cancelEditRef.current = true; setEditing(null); e.preventDefault(); } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { commitEdit(); e.preventDefault(); } }}
        />
        {editText.length >= 1800 && <span className="absolute -bottom-5 right-0 rounded bg-popover px-1 text-xs">{editText.length}/2000</span>}
      </div>}
      {quickBar}
      {focusTarget && <div className="absolute inset-x-0 top-14 flex justify-center px-3"><div className="flex items-center gap-2 rounded-lg border bg-popover/95 py-1 pl-3 pr-1 text-xs shadow-lg backdrop-blur">{focus ? `Path from the seed to ${nodeById.get(focusTarget)?.service?.name ?? names.of(focusTarget)}` : "No path from the seed to this node"}<Button variant="ghost" size="xs" onClick={() => setFocusTarget(null)}>Exit focus · Esc</Button></div></div>}
      {hover && hoverAt && <div className="pointer-events-none absolute z-10 max-w-80 rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg" style={{ left: Math.min(hoverAt.x + 14, size.width - 330), top: Math.min(hoverAt.y + 14, size.height - 140) }}>{hoverCard(hover)}</div>}
      <details className="group pointer-events-auto absolute bottom-3 left-3 max-w-md rounded-lg border bg-popover/90 px-2.5 py-2 text-[11px] text-muted-foreground backdrop-blur">
        <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
          <span className="font-medium text-foreground">{plural(view.nodes.length, "address", "addresses")} · {plural(view.edges.length, "connection")} · {plural(steps.filter((s) => s.kind === "movement").length, "movement")}{hidden.counts.size ? ` · ${hidden.counts.size} hidden branch${hidden.counts.size === 1 ? "" : "es"}` : ""}</span>
          <ChevronUpIcon className="ml-auto size-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="mt-1.5 flex flex-col gap-1">
          <span>Observed movements in time order. Lines don&apos;t show that the same funds moved.</span>
          <span className="flex items-center gap-2"><span className="inline-block h-0.5 w-5 bg-muted-foreground" aria-hidden />Observed movement, labelled with the amount added</span>
          <span className="flex items-center gap-2"><span className="inline-block w-5 border-t border-dashed border-muted-foreground" aria-hidden />Your annotation (connector, note or shape): not evidence</span>
          <span className="flex items-center gap-2"><span className="inline-block size-2.5 rounded-full bg-foreground" aria-hidden />Mapped wallet · <span className="inline-block size-2.5 rounded-full border border-muted-foreground" aria-hidden />observed address · <span className="inline-block size-2.5 rotate-45 bg-tone-bridge" aria-hidden />service</span>
          <span className="flex items-center gap-2"><span className="inline-flex size-3 items-center justify-center rounded-full border border-muted-foreground text-[8px] leading-none" aria-hidden>/</span>History not loaded past here · <LockIcon className="size-3 text-tone-lookalike" aria-hidden />custodial</span>
          <span>Right-click a node for branches and focus; hover anything for details.</span>
        </div>
      </details>
      <p className="sr-only" aria-live="polite">{selection.nodes.length ? selection.nodes.map((id) => `${names.of(id)}, ${nodeById.get(id)?.depth ?? "unknown"} hops`).join("; ") : selection.edges.length ? `Movement ${selection.edges[0]}` : selection.annotations.length ? `Annotation ${selection.annotations[0]}, drawn by you` : "No selection"}</p>
    </div>
  );
}

function MenuItem({ children, onClick, shortcut, disabled, destructive }: { children: React.ReactNode; onClick: () => void; shortcut?: string; disabled?: boolean; destructive?: boolean }) {
  return <button type="button" role="menuitem" disabled={disabled} className={`flex items-center justify-between gap-6 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-40 ${destructive ? "text-destructive" : ""}`} onClick={onClick}>
    <span>{children}</span>{shortcut && <span className="text-xs text-muted-foreground">{shortcut}</span>}
  </button>;
}

/** − / zoom % / +, with the % opening fit, zoom to selection and fixed levels. */
function ZoomMenu({ level, onFit, onSelection, canSelection, onZoom }: { level: number; onFit: () => void; onSelection: () => void; canSelection: boolean; onZoom: (k: number) => void }) {
  const [open, setOpen] = useState(false);
  const item = (label: string, run: () => void, shortcut?: string, disabled = false) => <MenuItem disabled={disabled} shortcut={shortcut} onClick={() => { run(); setOpen(false); }}>{label}</MenuItem>;
  return <div className="flex items-center">
    <Button variant="ghost" size="icon-sm" aria-label="Zoom out" title="Zoom out" onClick={() => onZoom(Math.max(0.2, level / 1.25))}><MinusIcon /></Button>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="h-7 min-w-14 rounded-md px-1.5 text-xs tabular-nums hover:bg-muted" aria-label="Zoom options" title="Zoom options">{Math.round(level * 100)}%</PopoverTrigger>
      <PopoverContent align="center" className="grid w-56 p-1 text-sm">
        {item("Zoom to fit", onFit, "⇧F")}
        {item("Zoom to selection", onSelection, "⇧2", !canSelection)}
        <div className="my-1 h-px bg-border" />
        {item("50%", () => onZoom(0.5))}
        {item("100%", () => onZoom(1), "0")}
        {item("200%", () => onZoom(2))}
      </PopoverContent>
    </Popover>
    <Button variant="ghost" size="icon-sm" aria-label="Zoom in" title="Zoom in" onClick={() => onZoom(Math.min(4, level * 1.25))}><PlusIcon /></Button>
  </div>;
}

/** A colour picker as a row of swatches, for the quick toolbar. */
function Swatches({ value, label, onPick, allowNone }: { value: ColorKey | "none" | "mixed"; label: string; onPick: (color: ColorKey | "none") => void; allowNone?: boolean }) {
  const [open, setOpen] = useState(false);
  const swatch = (key: ColorKey | "none") => key === "none" ? "bg-[repeating-linear-gradient(45deg,transparent_0_3px,var(--border)_3px_5px)]" : key === "default" ? "bg-muted-foreground" : SWATCH[key];
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs hover:bg-muted" aria-label={label} title={label}>
      <span className={`size-4 rounded-full border ${value === "mixed" ? "bg-[conic-gradient(var(--color-red-500),var(--color-yellow-500),var(--color-green-500),var(--color-blue-500),var(--color-red-500))]" : swatch(value)}`} />
      <ChevronDownIcon className="size-3 text-muted-foreground" />
    </PopoverTrigger>
    <PopoverContent align="center" className="w-auto p-2">
      <div className="grid grid-cols-6 gap-1.5">
        {[...(allowNone ? ["none" as const] : []), ...COLOR_KEYS].map((key) => <button key={key} type="button" aria-label={key} title={key === "none" ? "No fill" : key[0].toUpperCase() + key.slice(1)} className={`size-6 rounded-full border ${swatch(key)} ${value === key ? "ring-2 ring-ring ring-offset-1 ring-offset-popover" : ""}`} onClick={() => { onPick(key); setOpen(false); }} />)}
      </div>
    </PopoverContent>
  </Popover>;
}

const SWATCH: Record<Exclude<ColorKey, "default">, string> = {
  red: "bg-red-500", orange: "bg-orange-500", yellow: "bg-yellow-500", green: "bg-green-500", teal: "bg-teal-500",
  blue: "bg-blue-500", purple: "bg-purple-500", pink: "bg-pink-500", gray: "bg-gray-500",
};

/** A small segmented control for the quick toolbar; shows nothing pressed when the selection is mixed. */
function Choice<T extends string | number>({ label, value, options, onPick }: { label: string; value: T | "mixed"; options: [T, React.ReactNode][]; onPick: (value: T) => void }) {
  return <div role="radiogroup" aria-label={label} title={label} className="flex items-center gap-0.5">
    {options.map(([option, content]) => <button key={String(option)} type="button" role="radio" aria-checked={value === option} aria-label={`${label}: ${option}`} className={`flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-xs [&_svg]:size-4 ${value === option ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"}`} onClick={() => onPick(option)}>{content}</button>)}
  </div>;
}

/** Align and distribute, as a popover of icon buttons. */
function AlignMenu({ onAlign, onDistribute, canDistribute }: { onAlign: (mode: AlignMode) => void; onDistribute: (axis: "x" | "y") => void; canDistribute: boolean }) {
  const [open, setOpen] = useState(false);
  const button = (label: string, icon: React.ReactNode, run: () => void, disabled = false) => <Button key={label} variant="ghost" size="icon-sm" aria-label={label} title={label} disabled={disabled} onClick={() => { run(); setOpen(false); }}>{icon}</Button>;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs hover:bg-muted [&_svg]:size-4" aria-label="Align" title="Align and distribute"><AlignStartVerticalIcon /><ChevronDownIcon className="size-3 text-muted-foreground" /></PopoverTrigger>
    <PopoverContent align="center" className="w-auto p-1">
      <div className="flex gap-0.5">
        {button("Align left (⌥A)", <AlignStartVerticalIcon />, () => onAlign("left"))}
        {button("Align centre (⌥H)", <AlignCenterVerticalIcon />, () => onAlign("center"))}
        {button("Align right (⌥D)", <AlignEndVerticalIcon />, () => onAlign("right"))}
        <span className="mx-0.5 w-px bg-border" />
        {button("Align top (⌥W)", <AlignStartHorizontalIcon />, () => onAlign("top"))}
        {button("Align middle (⌥V)", <AlignCenterHorizontalIcon />, () => onAlign("middle"))}
        {button("Align bottom (⌥S)", <AlignEndHorizontalIcon />, () => onAlign("bottom"))}
        <span className="mx-0.5 w-px bg-border" />
        {button("Distribute horizontally", <AlignHorizontalDistributeCenterIcon />, () => onDistribute("x"), !canDistribute)}
        {button("Distribute vertically", <AlignVerticalDistributeCenterIcon />, () => onDistribute("y"), !canDistribute)}
      </div>
    </PopoverContent>
  </Popover>;
}

/** The investigation icons as a grid; drawn from the same path data the canvas uses. */
function IconPicker({ onPick }: { onPick: (icon: IconKey) => void }) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger className="flex h-7 items-center gap-0.5 rounded-md px-1.5 hover:bg-muted [&_svg]:size-4" aria-label="Icons" title="Investigation icons"><IconGlyph icon="attacker" /><ChevronDownIcon className="size-3 text-muted-foreground" /></PopoverTrigger>
    <PopoverContent align="center" className="w-72 p-2">
      <p className="px-1 pb-2 text-xs text-muted-foreground">Icons are your annotations: they mark what you believe something is, not what the chain shows.</p>
      <div className="grid grid-cols-4 gap-1">
        {ICON_KEYS.map((key) => <button key={key} type="button" className="flex flex-col items-center gap-1 rounded-md p-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-6" onClick={() => { onPick(key); setOpen(false); }}><IconGlyph icon={key} /><span className="leading-tight">{ICONS[key].label}</span></button>)}
      </div>
    </PopoverContent>
  </Popover>;
}

function IconGlyph({ icon }: { icon: IconKey }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICONS[icon].paths.map((d) => <path key={d} d={d} />)}</svg>;
}
