import { describe, expect, it } from "vitest";
import { graphWheelAction, wheelAction } from "./gestures";

describe("wheelAction", () => {
  const wheel = (deltaX: number, deltaY: number, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; deltaMode: number }> = {}) => ({
    deltaX,
    deltaY,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    ...extra,
  });

  it("zooms on a pinch (ctrlKey), in or out, even when lanes overflow", () => {
    const zoomIn = wheelAction(wheel(0, -10, { ctrlKey: true }), true);
    expect(zoomIn.type).toBe("zoom");
    expect(zoomIn.type === "zoom" && zoomIn.factor).toBeGreaterThan(1);
    const zoomOut = wheelAction(wheel(0, 10, { metaKey: true }), true);
    expect(zoomOut.type === "zoom" && zoomOut.factor).toBeLessThan(1);
  });

  it("pans on a sideways swipe", () => {
    expect(wheelAction(wheel(30, 4), false)).toEqual({ type: "pan", dx: 30 });
    // Line-mode deltas (mouse with Shift) are converted to px.
    expect(wheelAction(wheel(-3, 0, { deltaMode: 1 }), true)).toEqual({ type: "pan", dx: -48 });
  });

  it("scrolls overflowing lanes on a vertical swipe, and zooms when they fit", () => {
    expect(wheelAction(wheel(0, 20), true)).toEqual({ type: "scroll" });
    const zoom = wheelAction(wheel(0, -20), false);
    expect(zoom.type === "zoom" && zoom.factor).toBeGreaterThan(1);
  });
});

describe("graphWheelAction", () => {
  const wheel = (deltaX: number, deltaY: number, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; deltaMode: number }> = {}) => ({
    deltaX,
    deltaY,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    ...extra,
  });

  it("zooms on a pinch or Ctrl/⌘ + wheel", () => {
    const a = graphWheelAction(wheel(0, -10, { ctrlKey: true }));
    expect(a.type === "zoom" && a.factor).toBeGreaterThan(1);
  });

  it("pans on any swipe, in both directions, with line-mode deltas in px", () => {
    expect(graphWheelAction(wheel(12, -30))).toEqual({ type: "pan", dx: 12, dy: -30 });
    expect(graphWheelAction(wheel(0, 3, { deltaMode: 1 }))).toEqual({ type: "pan", dx: 0, dy: 48 });
  });
});
