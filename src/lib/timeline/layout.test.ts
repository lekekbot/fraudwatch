import { describe, expect, it } from "vitest";
import { chooseBucket, eventAtOrAfter, fitTransform, eventTimes, groupEvents, histogram, mergeOverlapping, minimapTarget, placeCards, splitByBucket, stepEvent } from "./layout";

describe("eventTimes", () => {
  it("fills missing block times from the previous event", () => {
    expect(eventTimes(["1970-01-01T00:00:01.000Z", null, "1970-01-01T00:00:03.000Z"], 0)).toEqual([1000, 1000, 3000]);
    expect(eventTimes([null], 42)).toEqual([42]);
  });
});

describe("groupEvents", () => {
  it("keeps well-spaced events separate and clusters dense runs", () => {
    const groups = groupEvents([0, 100, 102, 104, 300], 10);
    expect(groups.map((g) => [g.first, g.last, g.count])).toEqual([
      [0, 0, 1],
      [1, 3, 3],
      [4, 4, 1],
    ]);
    expect(groups[1]).toMatchObject({ x0: 100, x1: 104, x: 102 });
  });

  it("collapses a thousand events at one pixel into a single cluster", () => {
    const groups = groupEvents(new Array(1000).fill(50), 10);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(1000);
  });
});

describe("mergeOverlapping", () => {
  const width = (g: { count: number }) => (g.count > 1 ? 60 : 10);

  it("merges a cluster with neighbours its pill would cover, leaving spaced dots alone", () => {
    const groups = groupEvents([0, 20, 40, 100, 101, 102, 130, 400], 10);
    expect(mergeOverlapping(groups, width, 4).map((g) => [g.first, g.last])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 6],
      [7, 7],
    ]);
  });

  it("keeps folding when a merge widens the pill into the previous one", () => {
    const wide = (g: { count: number }) => (g.count > 1 ? 20 * g.count : 10);
    const groups = groupEvents([0, 1, 50, 51, 62, 63], 5);
    const merged = mergeOverlapping(groups, wide, 4);
    expect(merged).toHaveLength(1);
    expect(merged[0].count).toBe(6);
  });

  it("never leaves two shapes overlapping", () => {
    const xs = Array.from({ length: 500 }, (_, i) => Math.floor(i * 1.7) + (i % 7) * 3);
    const merged = mergeOverlapping(groupEvents(xs.sort((a, b) => a - b), 12), (g) => (g.count > 1 ? 150 : 10), 6);
    for (let i = 1; i < merged.length; i++) {
      const prev = merged[i - 1];
      const next = merged[i];
      if (prev.count === 1 && next.count === 1) continue;
      const w = (g: typeof prev) => (g.count > 1 ? 150 : 10);
      expect(prev.x + w(prev) / 2 + 6).toBeLessThanOrEqual(next.x - w(next) / 2);
    }
  });
});

describe("dense-period buckets", () => {
  it("picks the smallest calendar bucket that fits the pill", () => {
    const day = 86_400_000;
    expect(chooseBucket(80 / day, 80).ms).toBe(day);
    expect(chooseBucket(79 / day, 80).ms).toBe(7 * day);
    expect(chooseBucket(1, 80).ms).toBe(60_000);
  });

  it("splits a dense run into one cluster per bucket and leaves singletons", () => {
    const xs = [0, 1, 2, 3, 4, 50];
    const groups = groupEvents(xs, 10);
    const days = [1, 1, 2, 2, 2, 3];
    expect(splitByBucket(groups, xs, (i) => days[i]).map((g) => [g.first, g.last, g.count])).toEqual([
      [0, 1, 2],
      [2, 4, 3],
      [5, 5, 1],
    ]);
  });
});

describe("placeCards", () => {
  const single = (x: number) => ({ first: 0, last: 0, count: 1, x, x0: x, x1: x });

  it("uses the upper tier, then the lower, then falls back to a dot", () => {
    const placements = placeCards([single(100), single(150), single(200), single(400)], 140, 8);
    expect(placements.map((p) => p?.tier ?? null)).toEqual([0, 1, null, 0]);
  });

  it("never gives a cluster a card", () => {
    expect(placeCards([{ first: 0, last: 4, count: 5, x: 0, x0: 0, x1: 0 }], 140, 8)).toEqual([null]);
  });
});

describe("histogram", () => {
  it("bins events across the range and ignores events outside it", () => {
    expect(histogram([0, 1, 5, 9, 10, -1], 0, 10, 2)).toEqual([2, 2]);
  });
});

describe("navigation", () => {
  it("steps within bounds", () => {
    expect(stepEvent(3, null, 1)).toBe(0);
    expect(stepEvent(3, null, -1)).toBe(2);
    expect(stepEvent(3, 2, 1)).toBe(2);
    expect(stepEvent(3, 1, -1)).toBe(0);
    expect(stepEvent(0, null, 1)).toBeNull();
  });

  it("jumps to the first event on or after a date", () => {
    expect(eventAtOrAfter([10, 20, 30], 15)).toBe(1);
    expect(eventAtOrAfter([10, 20, 30], 99)).toBe(2);
    expect(eventAtOrAfter([], 1)).toBeNull();
  });
});

describe("fitTransform", () => {
  it("fits a range into the padded view", () => {
    expect(fitTransform(100, 200, 1000, 50, 1e9)).toEqual({ k: 9, x: 500 - 9 * 150 });
  });

  it("keeps deep zoom when the range is a fraction of a base pixel", () => {
    // Regression: the span used to be clamped to 1px, capping zoom at (width - 2·pad).
    const { k } = fitTransform(500, 500.01, 1000, 50, 1e9);
    expect(k).toBeCloseTo(90_000, 0);
  });

  it("never zooms out past the full range or beyond maxK", () => {
    expect(fitTransform(0, 5000, 1000, 50, 1e9).k).toBe(1);
    expect(fitTransform(10, 10, 1000, 50, 1234).k).toBe(1234);
  });
});

describe("placeCards with one tier", () => {
  it("never places a card below the lane", () => {
    const groups = groupEvents([0, 40, 400], 10);
    expect(placeCards(groups, 150, 8, 1).map((p) => p?.tier ?? null)).toEqual([0, null, 0]);
  });
});

describe("minimapTarget", () => {
  const range = { start: 0, end: 800 };

  it("zooms in around the click when the whole range is in view", () => {
    expect(minimapTarget(400, null, range)).toEqual({ start: 350, end: 450 });
    expect(minimapTarget(400, { start: 0, end: 800 }, range)).toEqual({ start: 350, end: 450 });
  });

  it("re-centres a zoomed-in view, keeping its span", () => {
    expect(minimapTarget(300, { start: 500, end: 600 }, range)).toEqual({ start: 250, end: 350 });
  });

  it("stays inside the range near the ends", () => {
    expect(minimapTarget(10, { start: 500, end: 600 }, range)).toEqual({ start: 0, end: 100 });
    expect(minimapTarget(790, null, range)).toEqual({ start: 700, end: 800 });
  });
});
