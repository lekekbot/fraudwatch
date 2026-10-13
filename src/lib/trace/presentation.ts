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

export type NodeStyle = { color?: ColorKey; size?: "s" | "m" | "l"; note?: string };

/** Where a user connector ends: an evidence node, another annotation, or a free point. */
export type AnnotationEnd = { kind: "node"; id: string } | { kind: "annotation"; id: string } | { kind: "point"; at: Point };

export type NoteAnnotation = { id: string; kind: "note"; at: Point; width: number; text: string; color: ColorKey };
export type ShapeAnnotation = {
  id: string;
  kind: "shape";
  shape: "rect" | "ellipse" | "frame";
  /** Top-left corner. */
  at: Point;
  width: number;
  height: number;
  label: string;
  stroke: ColorKey;
  fill: ColorKey | "none";
};
export type ConnectorAnnotation = {
  id: string;
  kind: "connector";
  from: AnnotationEnd;
  to: AnnotationEnd;
  label: string;
  arrow: "none" | "end" | "both";
  color: ColorKey;
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
