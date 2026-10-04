import { describe, expect, it } from "vitest";
import { datesFromRange, extendedToToday, formatRange, isValidRange, rangeFromDates, rangeFromUnix, rangeToUnix, sameRange } from "./range";

describe("case ranges", () => {
  it("converts inclusive UTC dates to a half-open range", () => {
    expect(rangeFromDates("2026-06-01", "2026-06-30")).toEqual({
      start: "2026-06-01T00:00:00.000Z",
      end: "2026-07-01T00:00:00.000Z",
    });
  });

  it("allows single-day ranges", () => {
    const range = rangeFromDates("2026-06-09", "2026-06-09")!;
    expect(isValidRange(range)).toBe(true);
    expect(formatRange(range)).toBe("2026-06-09 (UTC)");
  });

  it("rejects malformed and rolled-over dates", () => {
    expect(rangeFromDates("2026-02-31", "2026-03-01")).toBeNull();
    expect(rangeFromDates("06/01/2026", "2026-06-30")).toBeNull();
  });

  it("round-trips dates and unix seconds", () => {
    const range = rangeFromDates("2026-06-01", "2026-09-16")!;
    expect(datesFromRange(range)).toEqual({ startDate: "2026-06-01", endDate: "2026-09-16" });
    const unix = rangeToUnix(range);
    expect(sameRange(rangeFromUnix(unix.from, unix.to), range)).toBe(true);
  });

  it("flags start >= end", () => {
    expect(isValidRange({ start: "2026-06-02T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z" })).toBe(false);
    expect(isValidRange({ start: "2026-06-01T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z" })).toBe(false);
  });
});

describe("extendedToToday", () => {
  const now = new Date("2026-10-04T15:30:00.000Z");
  it("carries a past end to the end of today, keeping the start", () => {
    expect(extendedToToday({ start: "2022-07-25T00:00:00.000Z", end: "2025-09-11T00:00:00.000Z" }, now)).toEqual({
      start: "2022-07-25T00:00:00.000Z",
      end: "2026-10-05T00:00:00.000Z",
    });
  });

  it("leaves a range that already covers today", () => {
    expect(extendedToToday({ start: "2026-01-01T00:00:00.000Z", end: "2026-10-05T00:00:00.000Z" }, now)).toBeNull();
  });
});
