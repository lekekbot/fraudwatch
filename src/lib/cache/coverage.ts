import type { CaseRange } from "@/lib/case/range";

/**
 * Which parts of a wallet's history are cached. Ranges are half-open UTC
 * intervals [start, end). Only `complete` ranges let a load skip the RPC;
 * incomplete ones record that an attempt was made and came back partial.
 */
export type CachedCoverage = {
  wallet: string;
  ranges: Array<{ start: string; end: string; complete: boolean }>;
  updatedAt: string;
};

type Interval = { start: number; end: number };

const toInterval = (r: { start: string; end: string }): Interval => ({ start: Date.parse(r.start), end: Date.parse(r.end) });
const toRange = (i: Interval): CaseRange => ({ start: new Date(i.start).toISOString(), end: new Date(i.end).toISOString() });

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.start < i.end).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const i of sorted) {
    const last = merged[merged.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else merged.push({ ...i });
  }
  return merged;
}

/** Parts of `range` not covered by any complete cached range, oldest first. */
export function missingRanges(coverage: CachedCoverage | undefined, range: CaseRange): CaseRange[] {
  const want = toInterval(range);
  const have = mergeIntervals((coverage?.ranges ?? []).filter((r) => r.complete).map(toInterval));
  const gaps: Interval[] = [];
  let cursor = want.start;
  for (const h of have) {
    if (h.end <= cursor) continue;
    if (h.start >= want.end) break;
    if (h.start > cursor) gaps.push({ start: cursor, end: h.start });
    cursor = Math.max(cursor, h.end);
  }
  if (cursor < want.end) gaps.push({ start: cursor, end: want.end });
  return gaps.map(toRange);
}

/**
 * Record the outcome of loading `range`. Complete ranges merge with existing
 * complete ranges; an incomplete attempt is kept only where nothing complete
 * covers it yet.
 */
export function recordCoverage(
  coverage: CachedCoverage | undefined,
  wallet: string,
  range: CaseRange,
  complete: boolean,
  now = new Date(),
): CachedCoverage {
  const existing = coverage?.ranges ?? [];
  let completeIntervals = existing.filter((r) => r.complete).map(toInterval);
  let incomplete = existing.filter((r) => !r.complete).map(toInterval);
  const added = toInterval(range);

  if (complete) completeIntervals = mergeIntervals([...completeIntervals, added]);
  else incomplete.push(added);

  // Drop incomplete attempts that complete coverage now fully contains.
  incomplete = mergeIntervals(incomplete).filter(
    (i) => !completeIntervals.some((c) => c.start <= i.start && c.end >= i.end),
  );

  return {
    wallet,
    ranges: [
      ...completeIntervals.map((i) => ({ ...toRange(i), complete: true })),
      ...incomplete.map((i) => ({ ...toRange(i), complete: false })),
    ].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    updatedAt: now.toISOString(),
  };
}

/**
 * History newer than a few minutes may not be finalized yet, so a range that
 * reaches into the recent past is only ever cached as complete up to this cutoff.
 */
export const FINALITY_MARGIN_MS = 2 * 60_000;

export function clampToFinalized(range: CaseRange, fetchStartedAt: Date): CaseRange | null {
  const cutoff = fetchStartedAt.getTime() - FINALITY_MARGIN_MS;
  const start = Date.parse(range.start);
  const end = Math.min(Date.parse(range.end), cutoff);
  return start < end ? toRange({ start, end }) : null;
}
