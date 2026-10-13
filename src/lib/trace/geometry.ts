import { resolveEnd, type Annotation, type AnnotationEnd, type Point, type TracePresentation } from "./presentation";

export type Box = { x: number; y: number; width: number; height: number };
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function annotationBox(item: Annotation): Box | null {
  if (item.kind === "connector") return null;
  return { x: item.at.x, y: item.at.y, width: item.width, height: item.kind === "note" ? Math.max(72, 36 + Math.ceil(item.text.length / Math.max(12, item.width / 8)) * 16) : item.height };
}

export function borderPoint(box: Box, toward: Point): Point {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const dx = toward.x - center.x, dy = toward.y - center.y;
  const scale = Math.max(Math.abs(dx) / (box.width / 2 || 1), Math.abs(dy) / (box.height / 2 || 1));
  if (scale === 0) return { x: box.x + box.width, y: center.y };
  return { x: center.x + dx / scale, y: center.y + dy / scale };
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
  return { from: box(item.from) ? borderPoint(box(item.from)!, to) : from, to: box(item.to) ? borderPoint(box(item.to)!, from) : to };
}

export function handleAt(box: Box, point: Point, radius = 8): Handle | null {
  const x = [box.x, box.x + box.width / 2, box.x + box.width];
  const y = [box.y, box.y + box.height / 2, box.y + box.height];
  const spots: [Handle, number, number][] = [["nw", x[0], y[0]], ["n", x[1], y[0]], ["ne", x[2], y[0]], ["e", x[2], y[1]], ["se", x[2], y[2]], ["s", x[1], y[2]], ["sw", x[0], y[2]], ["w", x[0], y[1]]];
  return spots.find(([, sx, sy]) => Math.abs(point.x - sx) <= radius && Math.abs(point.y - sy) <= radius)?.[0] ?? null;
}

export function resizeBox(box: Box, handle: Handle, delta: Point, keepAspect = false): Box {
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
  if (width < 16) { if (handle.includes("w")) x = box.x + box.width - 16; width = 16; }
  if (height < 16) { if (handle.includes("n")) y = box.y + box.height - 16; height = 16; }
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
