import type { IconKey } from "./icons";

/**
 * The investigator's canvas for a trace: where things sit, how evidence nodes
 * look, and what they drew on top. None of it is evidence. A connector here is
 * the investigator's claim, never an observed movement; `buildTraceView` reads
 * none of this (see docs/sprints/trace-graph/02 and 05A).
 */

/** World coordinates. */
export type Point = { x: number; y: number };

/** A palette key, resolved to a CSS variable at draw time so themes keep working. */
export const COLOR_KEYS = ["default", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "gray"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export const isColorKey = (v: unknown): v is ColorKey => typeof v === "string" && (COLOR_KEYS as readonly string[]).includes(v);

/** `group` and `locked` mean the same as on annotations: a node can be grouped with notes and shapes, and locked in place. */
export type NodeStyle = { color?: ColorKey; size?: "s" | "m" | "l"; note?: string; locked?: boolean; group?: string };

export type Side = "n" | "e" | "s" | "w";
export const SIDES: readonly Side[] = ["n", "e", "s", "w"];
export type FontSize = "s" | "m" | "l";
export type TextAlign = "left" | "center" | "right";
export type StrokeWidth = 1 | 2 | 4;
export type Route = "straight" | "curved" | "elbow";

/**
 * Where a user connector ends: an evidence node, another annotation, or a free
 * point. With `side`, the end sits on that side's midpoint (a draw.io
 * connection point); without, on the border facing the other end.
 */
export type AnnotationEnd = { kind: "node"; id: string; side?: Side } | { kind: "annotation"; id: string; side?: Side } | { kind: "point"; at: Point };

/** What every annotation may carry: membership of a group (moved and selected together) and a lock (not moved or resized). */
type Common = { group?: string; locked?: boolean };

/**
 * `height` is set once the note is resized or its text grows it; notes saved
 * before it existed size to their text. `variant: "text"` draws the text alone,
 * with no note behind it (the Text tool).
 */
export type NoteAnnotation = Common & { id: string; kind: "note"; at: Point; width: number; height?: number; text: string; color: ColorKey; variant?: "text"; fontSize?: FontSize; align?: TextAlign };
export type ShapeAnnotation = Common & {
  id: string;
  kind: "shape";
  /** `icon`: one of the investigation icons (`icon`), with its label underneath. */
  shape: "rect" | "ellipse" | "frame" | "icon";
  icon?: IconKey;
  /** Top-left corner. */
  at: Point;
  width: number;
  height: number;
  label: string;
  stroke: ColorKey;
  fill: ColorKey | "none";
  strokeWidth?: StrokeWidth;
  fontSize?: FontSize;
  align?: TextAlign;
};
export type ConnectorAnnotation = Common & {
  id: string;
  kind: "connector";
  from: AnnotationEnd;
  to: AnnotationEnd;
  label: string;
  arrow: "none" | "end" | "both";
  color: ColorKey;
  /** `curved`: a smooth curve; `elbow`: right-angle segments, as draw.io's orthogonal connector. Straight when unset. */
  route?: Route;
  /** Where the label sits along the line, 0 (from) to 1 (to); 0.5 when unset. */
  labelAt?: number;
  strokeWidth?: StrokeWidth;
  /** Dashed when unset, the default for the investigator's own lines; lines drawn from a connection dot start solid. */
  lineStyle?: "solid" | "dashed";
};
export type Annotation = NoteAnnotation | ShapeAnnotation | ConnectorAnnotation;

export type TracePresentation = {
  /** Every evidence node that has been placed, by node id. A node without one is auto-placed and then gets one. */
  positions: Record<string, Point>;
  nodeStyles: Record<string, NodeStyle>;
  /** In draw order: later on top. */
  annotations: Annotation[];
  /** Services shown as their individual addresses (Sprint 07); collapsed is the default. */
  expandedServices: string[];
  /** Nodes whose downstream branch is hidden (Sprint 08). */
  hiddenBranches: string[];
  canvas: { grid: boolean; snap: boolean };
};

export const emptyPresentation = (): TracePresentation => ({
  positions: {},
  nodeStyles: {},
  annotations: [],
  expandedServices: [],
  hiddenBranches: [],
  canvas: { grid: false, snap: false },
});

/**
 * The point a connector end refers to: a node's position, a shape's centre, or
 * a note's top centre (its height depends on wrapped text, which only the
 * canvas measures). The canvas moves it to the item's border when drawing.
 * Null when the item isn't there and has no known position; a connector to a
 * connector has no anchor.
 */
export function resolveEnd(end: AnnotationEnd, positions: Readonly<Record<string, Point>>, annotations: readonly Annotation[]): Point | null {
  if (end.kind === "point") return end.at;
  if (end.kind === "node") return positions[end.id] ?? null;
  const a = annotations.find((x) => x.id === end.id);
  if (!a || a.kind === "connector") return null;
  return a.kind === "shape" ? { x: a.at.x + a.width / 2, y: a.at.y + a.height / 2 } : { x: a.at.x + a.width / 2, y: a.at.y };
}

/**
 * Connector ends that point at removed nodes or annotations become free points
 * where those items were, so the investigator's line is never silently
 * deleted. `lastPositions` overrides where a removed node was; an end whose
 * item had no known position is left as is (drawn dangling, never dropped).
 */
export function detachEnds(p: TracePresentation, removedIds: ReadonlySet<string>, lastPositions: Readonly<Record<string, Point>> = {}): TracePresentation {
  const detach = (end: AnnotationEnd): AnnotationEnd => {
    if (end.kind === "point" || !removedIds.has(end.id)) return end;
    const at = (end.kind === "node" && lastPositions[end.id]) || resolveEnd(end, p.positions, p.annotations);
    return at ? { kind: "point", at } : end;
  };
  let changed = false;
  const annotations = p.annotations.map((a) => {
    if (a.kind !== "connector") return a;
    const [from, to] = [detach(a.from), detach(a.to)];
    if (from === a.from && to === a.to) return a;
    changed = true;
    return { ...a, from, to };
  });
  return changed ? { ...p, annotations } : p;
}
