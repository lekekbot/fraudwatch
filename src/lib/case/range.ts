/**
 * Case ranges are half-open UTC intervals: [start, end).
 * The UI collects inclusive calendar dates in UTC; `end` is stored as
 * 00:00:00Z of the day *after* the last selected date.
 */
export type CaseRange = { start: string; end: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function parseUtcDate(date: string): number | null {
  if (!DATE_ONLY.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  // Reject rollovers such as 2026-02-31 → 2026-03-03.
  return new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

export function rangeFromDates(startDate: string, endDate: string): CaseRange | null {
  const start = parseUtcDate(startDate);
  const end = parseUtcDate(endDate);
  if (start === null || end === null) return null;
  return { start: new Date(start).toISOString(), end: new Date(end + DAY_MS).toISOString() };
}

export function datesFromRange(range: CaseRange): { startDate: string; endDate: string } {
  return {
    startDate: range.start.slice(0, 10),
    endDate: new Date(Date.parse(range.end) - 1).toISOString().slice(0, 10),
  };
}

export function rangeFromUnix(from: number, to: number): CaseRange {
  return { start: new Date(from * 1000).toISOString(), end: new Date(to * 1000).toISOString() };
}

export function rangeToUnix(range: CaseRange): { from: number; to: number } {
  return { from: Math.floor(Date.parse(range.start) / 1000), to: Math.floor(Date.parse(range.end) / 1000) };
}

export function isValidRange(range: CaseRange): boolean {
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  return !Number.isNaN(start) && !Number.isNaN(end) && start < end;
}

export function sameRange(a: CaseRange, b: CaseRange): boolean {
  return Date.parse(a.start) === Date.parse(b.start) && Date.parse(a.end) === Date.parse(b.end);
}

export function formatRange(range: CaseRange): string {
  const { startDate, endDate } = datesFromRange(range);
  return startDate === endDate ? `${startDate} (UTC)` : `${startDate} → ${endDate} (UTC)`;
}

/**
 * The range carried on to the end of today (UTC), so later activity is in it;
 * null when it already reaches that far.
 */
export function extendedToToday(range: CaseRange, now = new Date()): CaseRange | null {
  const endOfToday = Math.floor(now.getTime() / DAY_MS) * DAY_MS + DAY_MS;
  return Date.parse(range.end) >= endOfToday ? null : { start: range.start, end: new Date(endOfToday).toISOString() };
}
