import { describe, expect, it } from "vitest";
import { DENSITY } from "./timeline-canvas";

describe("timeline density", () => {
  it("comfortable is the spacing the timeline always had", () => {
    expect(DENSITY.comfortable).toEqual({ cardGap: 22, laneBand: 22 + 64 + 48, bucketMin: 84, dotGap: 12 });
  });

  it("compact is tighter and spacious looser in every measure", () => {
    for (const key of ["cardGap", "laneBand", "bucketMin", "dotGap"] as const) {
      expect(DENSITY.compact[key]).toBeLessThan(DENSITY.comfortable[key]);
      expect(DENSITY.spacious[key]).toBeGreaterThan(DENSITY.comfortable[key]);
    }
  });
});
