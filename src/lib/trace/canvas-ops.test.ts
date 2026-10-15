import { describe, expect, it } from "vitest";
import { alignDeltas, boundsOf, boxFrom, distributeDeltas, intersects, snapToGuides } from "./canvas-ops";

describe("canvas operations", () => {
  it("bounds, intersects and boxes from corners", () => {
    expect(boundsOf([{ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: -5, width: 5, height: 5 }])).toEqual({ x: 0, y: -5, width: 25, height: 15 });
    expect(boundsOf([])).toBeNull();
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 5, height: 5 })).toBe(true);
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 })).toBe(false);
    expect(boxFrom({ x: 10, y: 5 }, { x: 0, y: 15 })).toEqual({ x: 0, y: 5, width: 10, height: 10 });
  });

  it("snaps an edge or centre to the nearest line within the threshold and reports guides", () => {
    const other = { x: 100, y: 100, width: 50, height: 20 };
    // Left edge 3 units right of the other's left edge: snaps back; tops 40 apart: no vertical snap.
    const result = snapToGuides({ x: 103, y: 160, width: 30, height: 30 }, [other], 6);
    expect(result.dx).toBe(-3);
    expect(result.dy).toBe(0);
    expect(result.guides).toContainEqual({ axis: "x", at: 100, from: 100, to: 190 });
    // Centres line up vertically.
    expect(snapToGuides({ x: 300, y: 104, width: 30, height: 10 }, [other], 6).dy).toBe(1);
    // Nothing near: no shift, no guides.
    expect(snapToGuides({ x: 400, y: 400, width: 10, height: 10 }, [other], 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("aligns to the selection's edges and centres, and distributes evenly", () => {
    const items = [{ id: "a", box: { x: 0, y: 0, width: 10, height: 10 } }, { id: "b", box: { x: 30, y: 20, width: 20, height: 10 } }];
    expect([...alignDeltas(items, "left")]).toEqual([["b", { x: -30, y: 0 }]]);
    expect([...alignDeltas(items, "right")]).toEqual([["a", { x: 40, y: 0 }]]);
    expect([...alignDeltas(items, "middle")]).toEqual([["a", { x: 0, y: 10 }], ["b", { x: 0, y: -10 }]]);
    const row = [{ id: "a", box: { x: 0, y: 0, width: 10, height: 10 } }, { id: "b", box: { x: 12, y: 0, width: 10, height: 10 } }, { id: "c", box: { x: 90, y: 0, width: 10, height: 10 } }];
    expect([...distributeDeltas(row, "x")]).toEqual([["b", { x: 33, y: 0 }]]);
    expect(distributeDeltas(row.slice(0, 2), "x").size).toBe(0);
  });
});
