import { describe, expect, it } from "vitest";
import { annotationBox, borderPoint, contains, handleAt, resizeBox } from "./geometry";

describe("annotation geometry", () => {
  it("attaches at borders and keeps resized boxes valid", () => {
    const box = { x: 10, y: 20, width: 100, height: 50 };
    expect(borderPoint(box, { x: 300, y: 45 })).toEqual({ x: 110, y: 45 });
    expect(handleAt(box, { x: 110, y: 70 })).toBe("se");
    expect(resizeBox(box, "nw", { x: 200, y: 200 })).toEqual({ x: 94, y: 54, width: 16, height: 16 });
    expect(contains(box, { x: 60, y: 45 })).toBe(true);
  });

  it("gives notes stable bounds from text and width", () => {
    const short = annotationBox({ id: "n", kind: "note", at: { x: 0, y: 0 }, width: 200, text: "short", color: "yellow" });
    const long = annotationBox({ id: "n", kind: "note", at: { x: 0, y: 0 }, width: 200, text: "x".repeat(200), color: "yellow" });
    expect(short?.height).toBeGreaterThanOrEqual(72);
    expect(long!.height).toBeGreaterThan(short!.height);
  });
});
