import { type TimeInterval, utcDay, utcHour, utcMinute, utcMonth, utcWeek } from "d3-time";

/**
 * Pure layout for the single-wallet timeline: where each event sits on the x
 * axis, which ones collapse into clusters, and which get a full card. The
 * canvas renderer only draws what this decides.
 */

export type SpacingMode = "time" | "event";

/** Event time in ms. Events without a block time inherit the previous event's time. */
export function eventTimes(timestamps: Array<string | null>, fallback: number): number[] {
  let last = fallback;
  return timestamps.map((t) => {
    const ms = t ? Date.parse(t) : Number.NaN;
    if (!Number.isNaN(ms)) last = ms;
    return last;
  });
}

export type Group = {
  /** Inclusive indices into the (chronological) event list. */
  first: number;
  last: number;
  count: number;
  /** Centre x of the group in screen pixels. */
  x: number;
  x0: number;
  x1: number;
};

/**
 * Greedy left-to-right clustering: an event joins the current group while it
 * sits within `minGap` px of the group's previous event. Singletons stay
 * individual; anything larger is drawn as one cluster.
 */
export function groupEvents(xs: number[], minGap: number): Group[] {
  const groups: Group[] = [];
  for (let i = 0; i < xs.length; i++) {
    const current = groups[groups.length - 1];
    if (current && xs[i] - xs[i - 1] < minGap) {
      current.last = i;
      current.count++;
      current.x1 = xs[i];
      current.x = (current.x0 + current.x1) / 2;
    } else {
      groups.push({ first: i, last: i, count: 1, x: xs[i], x0: xs[i], x1: xs[i] });
    }
  }
  return groups;
}

/**
 * Merge neighbouring groups until no two drawn shapes overlap. `widthOf` is the
 * on-screen width of a group's shape (a dot, or a labelled cluster pill), so
 * pills never collide however long their labels are. Runs of single dots that
 * fit are left alone.
 */
export function mergeOverlapping(groups: Group[], widthOf: (g: Group) => number, gap: number): Group[] {
  const merged: Group[] = [];
  for (const g of groups) {
    merged.push({ ...g });
    // Merging can widen the previous pill, so keep folding backwards until it fits.
    while (merged.length > 1) {
      const next = merged[merged.length - 1];
      const prev = merged[merged.length - 2];
      if (prev.count === 1 && next.count === 1) break;
      const overlap = prev.x + widthOf(prev) / 2 + gap > next.x - widthOf(next) / 2;
      if (!overlap) break;
      prev.last = next.last;
      prev.count += next.count;
      prev.x1 = next.x1;
      prev.x = (prev.x0 + prev.x1) / 2;
      merged.pop();
    }
  }
  return merged;
}

/** Calendar-aligned bucket sizes for dense periods, smallest first. */
const BUCKETS: Array<{ interval: TimeInterval; ms: number }> = [
  { interval: utcMinute, ms: 60_000 },
  { interval: utcMinute.every(5)!, ms: 5 * 60_000 },
  { interval: utcMinute.every(15)!, ms: 15 * 60_000 },
  { interval: utcHour, ms: 3_600_000 },
  { interval: utcHour.every(3)!, ms: 3 * 3_600_000 },
  { interval: utcHour.every(6)!, ms: 6 * 3_600_000 },
  { interval: utcDay, ms: 86_400_000 },
  { interval: utcWeek, ms: 7 * 86_400_000 },
  { interval: utcMonth, ms: 30 * 86_400_000 },
];

/** Smallest calendar bucket at least `minWidth` px wide at `pxPerMs`. */
export function chooseBucket(pxPerMs: number, minWidth: number): { interval: TimeInterval; ms: number } {
  return BUCKETS.find((b) => b.ms * pxPerMs >= minWidth) ?? BUCKETS[BUCKETS.length - 1];
}

/**
 * Split each multi-event group wherever the bucket key changes, so a long dense
 * run becomes one cluster per bucket (day, week, …) instead of one giant blob.
 * Keys must be non-decreasing in event order.
 */
export function splitByBucket(groups: Group[], xs: number[], keyOf: (index: number) => number): Group[] {
  const out: Group[] = [];
  for (const g of groups) {
    if (g.count === 1) {
      out.push(g);
      continue;
    }
    let start = g.first;
    for (let i = g.first + 1; i <= g.last + 1; i++) {
      if (i <= g.last && keyOf(i) === keyOf(start)) continue;
      const x0 = xs[start];
      const x1 = xs[i - 1];
      out.push({ first: start, last: i - 1, count: i - start, x: (x0 + x1) / 2, x0, x1 });
      start = i;
    }
  }
  return out;
}

export type Placement = { tier: 0 | 1; left: number } | null;

/**
 * Give single events a card when it fits: above the lane first, then below
 * (only above with `tiers` 1, when lanes are stacked); otherwise the event stays a dot. Deterministic, so cards don't jump around
 * while panning.
 */
export function placeCards(groups: Group[], cardWidth: number, padding: number, tiers: 1 | 2 = 2): Placement[] {
  const edge: [number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const order = tiers === 1 ? ([0] as const) : ([0, 1] as const);
  return groups.map((g) => {
    if (g.count !== 1) return null;
    const left = g.x - cardWidth / 2;
    for (const tier of order) {
      if (left >= edge[tier] + padding) {
        edge[tier] = left + cardWidth;
        return { tier, left };
      }
    }
    return null;
  });
}

/** Transaction counts per equal-width bin across [start, end). */
export function histogram(times: number[], start: number, end: number, bins: number): number[] {
  const counts = new Array<number>(Math.max(1, bins)).fill(0);
  const span = end - start;
  if (span <= 0) return counts;
  for (const t of times) {
    if (t < start || t >= end) continue;
    counts[Math.min(counts.length - 1, Math.floor(((t - start) / span) * counts.length))]++;
  }
  return counts;
}

/** Index of the nearest event strictly after / before `from` in chronological order. */
export function stepEvent(count: number, from: number | null, direction: 1 | -1): number | null {
  if (count === 0) return null;
  if (from === null) return direction === 1 ? 0 : count - 1;
  const next = from + direction;
  return next < 0 || next >= count ? from : next;
}

/** First event at or after `time`, else the last event. */
export function eventAtOrAfter(times: number[], time: number): number | null {
  if (times.length === 0) return null;
  const i = times.findIndex((t) => t >= time);
  return i === -1 ? times.length - 1 : i;
}

/**
 * Zoom transform (x-only) that fits base-scale pixels [x0, x1] into the view
 * between `pad` and `width - pad`, with scale clamped to [1, maxK].
 */
export function fitTransform(x0: number, x1: number, width: number, pad: number, maxK: number): { k: number; x: number } {
  // Only guard against zero: at deep zoom the visible span is a tiny fraction of a base pixel.
  const span = Math.max(1e-9, x1 - x0);
  const k = Math.max(1, Math.min(maxK, (width - 2 * pad) / span));
  return { k, x: width / 2 - k * ((x0 + x1) / 2) };
}

/** When zoomed out this far (share of the range in view), a minimap click zooms in instead of re-centring. */
const ZOOMED_OUT = 0.9;
/** Share of the range a minimap click zooms to from fully zoomed out. */
const CLICK_ZOOM = 1 / 8;

/**
 * Where a minimap click at `time` should move the view. Zoomed in, it keeps
 * the view's span and centres it on `time`; zoomed out (re-centring would do
 * nothing), it zooms to an eighth of the range around `time`. Kept inside the range.
 */
export function minimapTarget(
  time: number,
  view: { start: number; end: number } | null,
  range: { start: number; end: number },
): { start: number; end: number } {
  const total = range.end - range.start;
  const current = view ? view.end - view.start : total;
  const span = current >= total * ZOOMED_OUT ? total * CLICK_ZOOM : current;
  const start = Math.min(Math.max(range.start, time - span / 2), range.end - span);
  return { start, end: start + span };
}

export type WheelInput = { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean };
export type WheelAction = { type: "zoom"; factor: number } | { type: "pan"; dx: number } | { type: "scroll" };

/** Line- and page-mode wheel deltas in px, so mice and trackpads move alike. */
const deltaPx = (delta: number, mode: number) => delta * (mode === 1 ? 16 : mode === 2 ? 400 : 1);

/**
 * What a wheel or trackpad gesture does on the timeline. A pinch arrives as a
 * wheel event with ctrlKey set (Ctrl/⌘ + wheel on a mouse): zoom. A mostly
 * sideways swipe (or Shift + wheel) pans through time. Vertical movement scrolls
 * the lanes when they overflow, and zooms otherwise.
 */
export function wheelAction(e: WheelInput, lanesOverflow: boolean): WheelAction {
  const dx = deltaPx(e.deltaX, e.deltaMode);
  const dy = deltaPx(e.deltaY, e.deltaMode);
  if (e.ctrlKey || e.metaKey) return { type: "zoom", factor: Math.exp(-dy * 0.01) };
  if (Math.abs(dx) > Math.abs(dy)) return { type: "pan", dx };
  if (lanesOverflow) return { type: "scroll" };
  return { type: "zoom", factor: Math.exp(-dy * 0.002) };
}
