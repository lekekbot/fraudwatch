import type { Box } from "./geometry";

/**
 * Pure helpers behind the trace canvas's direct manipulation: selection
 * bounds, marquee hits and smart alignment guides (as in Figma and draw.io).
 * Boxes are in world units.
 */

export function boundsOf(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((b) => b.x)), top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width)), bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export const intersects = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** A box from two corners, in either order. */
export const boxFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });

export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };

const lines = (b: Box, axis: "x" | "y") => (axis === "x" ? [b.x, b.x + b.width / 2, b.x + b.width] : [b.y, b.y + b.height / 2, b.y + b.height]);

/**
 * How far to shift `moving` so one of its edges or its centre lines up with
 * another box's, when one is within `threshold`; and the guide lines to draw.
 * Each axis snaps independently to its nearest match.
 */
export function snapToGuides(moving: Box, others: readonly Box[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const best = (axis: "x" | "y") => {
    let shift = 0, distance = threshold;
    for (const other of others) for (const target of lines(other, axis)) for (const line of lines(moving, axis)) {
      const d = Math.abs(target - line);
      if (d < distance || (d === distance && d > 0 && Math.abs(target - line) < Math.abs(shift))) { distance = d; shift = target - line; }
    }
    return distance < threshold ? shift : 0;
  };
  const dx = best("x"), dy = best("y");
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides: Guide[] = [];
  for (const axis of ["x", "y"] as const) {
    if ((axis === "x" ? dx : dy) === 0 && !others.some((o) => lines(o, axis).some((t) => lines(snapped, axis).some((l) => Math.abs(t - l) < 0.5)))) continue;
    for (const other of others) for (const target of lines(other, axis)) {
      if (!lines(snapped, axis).some((l) => Math.abs(target - l) < 0.5)) continue;
      const [a1, a2] = axis === "x" ? [snapped.y, snapped.y + snapped.height] : [snapped.x, snapped.x + snapped.width];
      const [b1, b2] = axis === "x" ? [other.y, other.y + other.height] : [other.x, other.x + other.width];
      guides.push({ axis, at: target, from: Math.min(a1, b1), to: Math.max(a2, b2) });
    }
  }
  return { dx, dy, guides };
}

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** How far to move each item so they line up on the selection's edge or centre (Figma's align buttons). */
export function alignDeltas(items: readonly { id: string; box: Box }[], mode: AlignMode): Map<string, { x: number; y: number }> {
  const all = boundsOf(items.map((i) => i.box));
  const out = new Map<string, { x: number; y: number }>();
  if (!all) return out;
  for (const { id, box } of items) {
    const x = mode === "left" ? all.x - box.x : mode === "right" ? all.x + all.width - (box.x + box.width) : mode === "center" ? all.x + all.width / 2 - (box.x + box.width / 2) : 0;
    const y = mode === "top" ? all.y - box.y : mode === "bottom" ? all.y + all.height - (box.y + box.height) : mode === "middle" ? all.y + all.height / 2 - (box.y + box.height / 2) : 0;
    if (x || y) out.set(id, { x, y });
  }
  return out;
}

/** Even gaps between three or more items along an axis, keeping the outermost two where they are. */
export function distributeDeltas(items: readonly { id: string; box: Box }[], axis: "x" | "y"): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (items.length < 3) return out;
  const start = (b: Box) => (axis === "x" ? b.x : b.y), size = (b: Box) => (axis === "x" ? b.width : b.height);
  const sorted = [...items].sort((a, b) => start(a.box) - start(b.box));
  const first = sorted[0].box, last = sorted[sorted.length - 1].box;
  const span = start(last) + size(last) - start(first), used = sorted.reduce((sum, i) => sum + size(i.box), 0);
  const gap = (span - used) / (sorted.length - 1);
  let at = start(first);
  for (const { id, box } of sorted) {
    const shift = at - start(box);
    if (Math.abs(shift) > 0.001) out.set(id, axis === "x" ? { x: shift, y: 0 } : { x: 0, y: shift });
    at += size(box) + gap;
  }
  return out;
}
