import { resolveEnd, type Annotation, type AnnotationEnd, type FontSize, type Point, type Route, type Side, type TracePresentation } from "./presentation";

export type Box = { x: number; y: number; width: number; height: number };
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Annotation text, in world units so it scales with the canvas. */
export const NOTE_FONT = { size: 13, line: 18, pad: 10 };
export const LABEL_FONT = { size: 12, line: 16, pad: 8 };
export type Font = typeof NOTE_FONT;

/** Small, medium (the default) and large text, for notes and for labels. */
export function fontFor(kind: "note" | "label", size: FontSize = "m"): Font {
  const base = kind === "note" ? NOTE_FONT : LABEL_FONT, scale = size === "s" ? 0.85 : size === "l" ? 1.45 : 1;
  return { size: Math.round(base.size * scale), line: Math.round(base.line * scale), pad: base.pad };
}
export const MIN_NOTE = { width: 80, height: 40 };
export const MIN_SHAPE = 24;

/** A note saved before notes had a height: sized from its text as it used to be. */
const legacyNoteHeight = (width: number, text: string) => {
  const perLine = Math.max(12, width / 8);
  const lines = text.split("\n").reduce((sum, paragraph) => sum + Math.max(1, Math.ceil(paragraph.length / perLine)), 0);
  return Math.max(72, NOTE_FONT.pad * 2 + lines * NOTE_FONT.line);
};

export function annotationBox(item: Annotation): Box | null {
  if (item.kind === "connector") return null;
  return { x: item.at.x, y: item.at.y, width: item.width, height: item.kind === "note" ? item.height ?? legacyNoteHeight(item.width, item.text) : item.height };
}

/**
 * Text broken into lines no wider than `width` by `measure`: at spaces, and
 * inside a word only when the word alone is too wide. Explicit newlines are kept.
 */
export function wrapText(text: string, width: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      line = "";
      let rest = word;
      while (measure(rest) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && measure(rest.slice(0, cut)) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

export function borderPoint(box: Box, toward: Point): Point {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const dx = toward.x - center.x, dy = toward.y - center.y;
  const scale = Math.max(Math.abs(dx) / (box.width / 2 || 1), Math.abs(dy) / (box.height / 2 || 1));
  if (scale === 0) return { x: box.x + box.width, y: center.y };
  return { x: center.x + dx / scale, y: center.y + dy / scale };
}

/** The midpoint of a box's side: a draw.io connection point. */
export function sidePoint(box: Box, side: Side): Point {
  return side === "n" ? { x: box.x + box.width / 2, y: box.y } : side === "s" ? { x: box.x + box.width / 2, y: box.y + box.height } : side === "e" ? { x: box.x + box.width, y: box.y + box.height / 2 } : { x: box.x, y: box.y + box.height / 2 };
}

/** The side whose connection point is nearest `p`, if within `radius`. */
export function nearestSide(box: Box, p: Point, radius: number): Side | null {
  let best: Side | null = null, distance = radius;
  for (const side of ["n", "e", "s", "w"] as const) {
    const q = sidePoint(box, side), d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= distance) { best = side; distance = d; }
  }
  return best;
}

/** Which way a line leaves a side. */
const outward = (side: Side): Point => (side === "n" ? { x: 0, y: -1 } : side === "s" ? { x: 0, y: 1 } : side === "e" ? { x: 1, y: 0 } : { x: -1, y: 0 });

/**
 * The points a connector passes through. Straight: its two ends. Curved: a
 * cubic curve, sampled, leaving and entering along the sides the ends are on.
 * Elbow: horizontal and vertical segments only, leaving and entering along the
 * sides the ends are on (or the dominant direction for free ends), like
 * draw.io's orthogonal edge.
 */
export function connectorPath(from: Point, to: Point, route: Route = "straight", fromSide?: Side | null, toSide?: Side | null): Point[] {
  if (route === "straight") return [from, to];
  const dx = to.x - from.x, dy = to.y - from.y;
  if (route === "curved") {
    const across = Math.abs(dx) >= Math.abs(dy);
    const toward = (sign: number): Point => (across ? { x: Math.sign(dx) * sign || sign, y: 0 } : { x: 0, y: Math.sign(dy) * sign || sign });
    const a = fromSide ? outward(fromSide) : toward(1), b = toSide ? outward(toSide) : toward(-1);
    const reach = Math.max(30, Math.hypot(dx, dy) * 0.4);
    const c1 = { x: from.x + a.x * reach, y: from.y + a.y * reach }, c2 = { x: to.x + b.x * reach, y: to.y + b.y * reach };
    return Array.from({ length: 25 }, (_, i) => {
      const t = i / 24, u = 1 - t;
      return { x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x, y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y };
    });
  }
  const horizontal = (side: Side | null | undefined) => (side ? side === "e" || side === "w" : Math.abs(dx) >= Math.abs(dy));
  const a = horizontal(fromSide), b = horizontal(toSide);
  const stub = 16;
  const start = fromSide ? { x: from.x + outward(fromSide).x * stub, y: from.y + outward(fromSide).y * stub } : from;
  const end = toSide ? { x: to.x + outward(toSide).x * stub, y: to.y + outward(toSide).y * stub } : to;
  let middle: Point[];
  if (a && b) { const mx = (start.x + end.x) / 2; middle = [{ x: mx, y: start.y }, { x: mx, y: end.y }]; }
  else if (!a && !b) { const my = (start.y + end.y) / 2; middle = [{ x: start.x, y: my }, { x: end.x, y: my }]; }
  else middle = a ? [{ x: end.x, y: start.y }] : [{ x: start.x, y: end.y }];
  const points = [from, ...(fromSide ? [start] : []), ...middle, ...(toSide ? [end] : []), to];
  // Drop repeated and collinear points so the line has no zero-length segments.
  return points.filter((p, i) => i === 0 || i === points.length - 1 || !((Math.abs(p.x - points[i - 1].x) < 0.01 && Math.abs(p.y - points[i - 1].y) < 0.01) || (Math.abs(points[i - 1].x - p.x) < 0.01 && Math.abs(p.x - points[i + 1].x) < 0.01) || (Math.abs(points[i - 1].y - p.y) < 0.01 && Math.abs(p.y - points[i + 1].y) < 0.01)));
}

const lengths = (path: readonly Point[]) => path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));

/** The point a fraction `t` of the way along a path. */
export function pointAlong(path: readonly Point[], t: number): Point {
  const parts = lengths(path), total = parts.reduce((a, b) => a + b, 0);
  let left = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < parts.length; i++) {
    if (left <= parts[i] || i === parts.length - 1) { const u = parts[i] ? Math.min(1, left / parts[i]) : 0; return { x: path[i].x + (path[i + 1].x - path[i].x) * u, y: path[i].y + (path[i + 1].y - path[i].y) * u }; }
    left -= parts[i];
  }
  return path[0];
}

/** How far along a path (0 to 1) the point nearest `p` is, and how far away it is. */
export function projectOnto(path: readonly Point[], p: Point): { t: number; distance: number } {
  const parts = lengths(path), total = parts.reduce((a, b) => a + b, 0) || 1;
  let best = { t: 0, distance: Infinity }, walked = 0;
  for (let i = 0; i < parts.length; i++) {
    const a = path[i], b = path[i + 1], dx = b.x - a.x, dy = b.y - a.y;
    const u = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    const distance = Math.hypot(p.x - (a.x + dx * u), p.y - (a.y + dy * u));
    if (distance < best.distance) best = { t: (walked + parts[i] * u) / total, distance };
    walked += parts[i];
  }
  return best;
}

export function connectorPoints(item: Extract<Annotation, { kind: "connector" }>, presentation: TracePresentation, nodeBox: (id: string) => Box | null): { from: Point; to: Point } | null {
  const resolve = (end: AnnotationEnd) => end.kind === "node" ? presentation.positions[end.id] ?? null : resolveEnd(end, presentation.positions, presentation.annotations);
  const from = resolve(item.from), to = resolve(item.to);
  if (!from || !to) return null;
  const box = (end: AnnotationEnd) => {
    if (end.kind === "node") return nodeBox(end.id);
    const target = end.kind === "annotation" ? presentation.annotations.find((a) => a.id === end.id) : null;
    return target ? annotationBox(target) : null;
  };
  const place = (end: AnnotationEnd, toward: Point, fallback: Point) => {
    const b = box(end);
    if (!b) return fallback;
    return end.kind !== "point" && end.side ? sidePoint(b, end.side) : borderPoint(b, toward);
  };
  return { from: place(item.from, to, from), to: place(item.to, from, to) };
}

/** The resize handle at `point`: a corner, or anywhere along a side (whose midpoint the caller may claim first as a connection point). */
export function handleAt(box: Box, point: Point, radius = 8): Handle | null {
  const right = box.x + box.width, bottom = box.y + box.height;
  const near = (a: number, b: number) => Math.abs(a - b) <= radius;
  const between = (v: number, lo: number, hi: number) => v >= lo - radius && v <= hi + radius;
  const ns = near(point.y, box.y) ? "n" : near(point.y, bottom) ? "s" : "";
  const we = near(point.x, box.x) ? "w" : near(point.x, right) ? "e" : "";
  if (ns && we) return (ns + we) as Handle;
  if (ns && between(point.x, box.x, right)) return ns as Handle;
  if (we && between(point.y, box.y, bottom)) return we as Handle;
  return null;
}

export function resizeBox(box: Box, handle: Handle, delta: Point, keepAspect = false, min: number | { width: number; height: number } = 16): Box {
  let { x, y, width, height } = box;
  if (handle.includes("w")) { x += delta.x; width -= delta.x; }
  if (handle.includes("e")) width += delta.x;
  if (handle.includes("n")) { y += delta.y; height -= delta.y; }
  if (handle.includes("s")) height += delta.y;
  if (keepAspect && (handle.length === 2)) {
    const ratio = box.width / box.height;
    if (Math.abs(delta.x) >= Math.abs(delta.y)) height = width / ratio;
    else width = height * ratio;
    if (handle.includes("w")) x = box.x + box.width - width;
    if (handle.includes("n")) y = box.y + box.height - height;
  }
  const [minW, minH] = typeof min === "number" ? [min, min] : [min.width, min.height];
  if (width < minW) { if (handle.includes("w")) x = box.x + box.width - minW; width = minW; }
  if (height < minH) { if (handle.includes("n")) y = box.y + box.height - minH; height = minH; }
  return { x, y, width, height };
}

export function contains(box: Box, point: Point): boolean {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
