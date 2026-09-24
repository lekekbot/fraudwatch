import { describe, expect, it } from "vitest";
import { type CachedCoverage, clampToFinalized, missingRanges, recordCoverage } from "./coverage";

const W = "wallet";
const d = (day: number) => `2026-06-${String(day).padStart(2, "0")}T00:00:00.000Z`;
const r = (a: number, b: number) => ({ start: d(a), end: d(b) });

describe("missingRanges", () => {
  it("returns the whole range when nothing is cached", () => {
    expect(missingRanges(undefined, r(1, 10))).toEqual([r(1, 10)]);
  });

  it("returns nothing when a complete range covers the request", () => {
    const cov = recordCoverage(undefined, W, r(1, 20), true);
    expect(missingRanges(cov, r(5, 10))).toEqual([]);
  });

  it("finds gaps before, between, and after cached ranges", () => {
    let cov = recordCoverage(undefined, W, r(3, 5), true);
    cov = recordCoverage(cov, W, r(7, 9), true);
    expect(missingRanges(cov, r(1, 12))).toEqual([r(1, 3), r(5, 7), r(9, 12)]);
  });

  it("does not trust incomplete ranges", () => {
    const cov = recordCoverage(undefined, W, r(1, 10), false);
    expect(missingRanges(cov, r(1, 10))).toEqual([r(1, 10)]);
  });
});

describe("recordCoverage", () => {
  it("merges overlapping and adjacent complete ranges", () => {
    let cov = recordCoverage(undefined, W, r(1, 5), true);
    cov = recordCoverage(cov, W, r(5, 8), true);
    cov = recordCoverage(cov, W, r(7, 12), true);
    expect(cov.ranges).toEqual([{ ...r(1, 12), complete: true }]);
  });

  it("keeps a partial attempt visible until a complete load covers it", () => {
    let cov: CachedCoverage = recordCoverage(undefined, W, r(1, 10), false);
    expect(cov.ranges).toEqual([{ ...r(1, 10), complete: false }]);
    cov = recordCoverage(cov, W, r(1, 10), true);
    expect(cov.ranges).toEqual([{ ...r(1, 10), complete: true }]);
  });
});

describe("clampToFinalized", () => {
  it("caps a range that reaches past the finality cutoff", () => {
    const clamped = clampToFinalized(r(1, 30), new Date(d(10)));
    expect(clamped).toEqual({ start: d(1), end: new Date(Date.parse(d(10)) - 120_000).toISOString() });
  });

  it("returns null when the whole range is too recent", () => {
    expect(clampToFinalized({ start: d(10), end: d(11) }, new Date(d(10)))).toBeNull();
  });
});
