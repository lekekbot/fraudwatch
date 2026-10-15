import { describe, expect, it } from "vitest";
import { annotationBox, borderPoint, connectorPath, connectorPoints, contains, fontFor, handleAt, MIN_NOTE, nearestSide, pointAlong, projectOnto, resizeBox, sidePoint, wrapText } from "./geometry";
import { emptyPresentation } from "./presentation";
import { isValidAnnotation } from "./storage";

describe("annotation geometry", () => {
  it("attaches at borders and keeps resized boxes valid", () => {
    const box = { x: 10, y: 20, width: 100, height: 50 };
    expect(borderPoint(box, { x: 300, y: 45 })).toEqual({ x: 110, y: 45 });
    expect(handleAt(box, { x: 110, y: 70 })).toBe("se");
    expect(handleAt(box, { x: 30, y: 72 })).toBe("s");
    expect(handleAt(box, { x: 30, y: 40 })).toBeNull();
    expect(resizeBox(box, "nw", { x: 200, y: 200 })).toEqual({ x: 94, y: 54, width: 16, height: 16 });
    expect(contains(box, { x: 60, y: 45 })).toBe(true);
  });

  it("gives notes stable bounds from text and width", () => {
    const short = annotationBox({ id: "n", kind: "note", at: { x: 0, y: 0 }, width: 200, text: "short", color: "yellow" });
    const long = annotationBox({ id: "n", kind: "note", at: { x: 0, y: 0 }, width: 200, text: "x".repeat(200), color: "yellow" });
    expect(short?.height).toBeGreaterThanOrEqual(72);
    expect(long!.height).toBeGreaterThan(short!.height);
  });

  it("wraps at word boundaries, splits only words too wide for a line, and keeps newlines", () => {
    const measure = (text: string) => text.length * 10; // 10 units per character
    expect(wrapText("forwarded most of it within minutes", 100, measure)).toEqual(["forwarded", "most of it", "within", "minutes"]);
    expect(wrapText("abcdefghijklmnop", 50, measure)).toEqual(["abcde", "fghij", "klmno", "p"]);
    expect(wrapText("one\ntwo", 100, measure)).toEqual(["one", "two"]);
    expect(wrapText("", 100, measure)).toEqual([""]);
  });

  it("uses a note's stored height, falls back for older notes, and keeps notes above their minimum size", () => {
    const note = { id: "n", kind: "note" as const, at: { x: 0, y: 0 }, width: 200, text: "x", color: "yellow" as const };
    expect(annotationBox({ ...note, height: 150 })?.height).toBe(150);
    expect(annotationBox(note)?.height).toBe(72);
    expect(annotationBox({ ...note, text: "a\n\n\n\nb" })?.height).toBe(110);
    expect(isValidAnnotation({ ...note, height: 150 })).toBe(true);
    expect(isValidAnnotation({ ...note, height: -1 })).toBe(false);
    expect(resizeBox({ x: 0, y: 0, width: 200, height: 96 }, "se", { x: -500, y: -500 }, false, MIN_NOTE)).toEqual({ x: 0, y: 0, width: MIN_NOTE.width, height: MIN_NOTE.height });
  });

  it("routes elbow connectors with right-angle segments only", () => {
    const right = connectorPath({ x: 0, y: 0 }, { x: 100, y: 50 }, "elbow", "e", "w");
    expect(right[0]).toEqual({ x: 0, y: 0 });
    expect(right.at(-1)).toEqual({ x: 100, y: 50 });
    for (let i = 1; i < right.length; i++) expect(right[i].x === right[i - 1].x || right[i].y === right[i - 1].y).toBe(true);
    // East side to north side: one bend.
    expect(connectorPath({ x: 0, y: 0 }, { x: 100, y: 100 }, "elbow").length).toBeGreaterThan(2);
    expect(connectorPath({ x: 0, y: 0 }, { x: 100, y: 100 })).toEqual([{ x: 0, y: 0 }, { x: 100, y: 100 }]);
  });

  it("curves connectors out of and into the sides they attach to", () => {
    const curve = connectorPath({ x: 0, y: 0 }, { x: 100, y: 50 }, "curved", "e", "w");
    expect(curve[0]).toEqual({ x: 0, y: 0 });
    expect(curve.at(-1)).toEqual({ x: 100, y: 50 });
    // Leaves heading east and arrives heading east, into the west side.
    expect(curve[1].x).toBeGreaterThan(0);
    expect(Math.abs(curve[1].y)).toBeLessThan(curve[1].x);
    expect(curve.at(-2)!.x).toBeLessThan(100);
  });

  it("places and projects points along a path, and finds connection points", () => {
    const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(pointAlong(path, 0.5)).toEqual({ x: 100, y: 0 });
    expect(pointAlong(path, 0.75)).toEqual({ x: 100, y: 50 });
    expect(projectOnto(path, { x: 110, y: 50 })).toEqual({ t: 0.75, distance: 10 });
    const box = { x: 0, y: 0, width: 100, height: 40 };
    expect(sidePoint(box, "e")).toEqual({ x: 100, y: 20 });
    expect(nearestSide(box, { x: 97, y: 22 }, 10)).toBe("e");
    expect(nearestSide(box, { x: 50, y: 20 }, 10)).toBeNull();
  });

  it("attaches a connector end to a chosen side", () => {
    const p = { ...emptyPresentation(), positions: { A: { x: 50, y: 20 }, B: { x: 300, y: 20 } } };
    const box = (id: string) => (p.positions[id as "A" | "B"] ? { x: p.positions[id as "A" | "B"].x - 50, y: 0, width: 100, height: 40 } : null);
    const points = connectorPoints({ id: "c", kind: "connector", from: { kind: "node", id: "A", side: "s" }, to: { kind: "node", id: "B" }, label: "", arrow: "end", color: "gray" }, p, box);
    expect(points).toEqual({ from: { x: 50, y: 40 }, to: { x: 250, y: 20 } });
  });

  it("scales fonts by size", () => {
    expect(fontFor("note").size).toBe(13);
    expect(fontFor("note", "l").size).toBeGreaterThan(fontFor("note", "s").size);
  });

  it("accepts icon shapes only with a known icon, and the newer optional fields only with allowed values", () => {
    const icon = { id: "i", kind: "shape" as const, shape: "icon" as const, icon: "mixer" as const, at: { x: 0, y: 0 }, width: 64, height: 84, label: "Mixer", stroke: "default" as const, fill: "none" as const };
    expect(isValidAnnotation(icon)).toBe(true);
    expect(isValidAnnotation({ ...icon, icon: "rocket" })).toBe(false);
    expect(isValidAnnotation({ ...icon, strokeWidth: 3 })).toBe(false);
    expect(isValidAnnotation({ ...icon, group: "g1", locked: true, fontSize: "l", align: "right" })).toBe(true);
    const line = { id: "c", kind: "connector" as const, from: { kind: "node" as const, id: "A", side: "e" as const }, to: { kind: "point" as const, at: { x: 1, y: 1 } }, label: "", arrow: "end" as const, color: "gray" as const };
    expect(isValidAnnotation({ ...line, route: "elbow", labelAt: 0.3 })).toBe(true);
    expect(isValidAnnotation({ ...line, from: { kind: "node", id: "A", side: "up" } })).toBe(false);
    expect(isValidAnnotation({ ...line, labelAt: 2 })).toBe(false);
  });
});
