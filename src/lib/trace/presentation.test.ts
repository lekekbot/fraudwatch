import { describe, expect, it } from "vitest";
import { type Annotation, type AnnotationEnd, detachEnds, emptyPresentation, isColorKey, resolveEnd } from "./presentation";

const note: Annotation = { id: "n", kind: "note", at: { x: 10, y: 20 }, width: 200, text: "exchange replied", color: "yellow" };
const box: Annotation = { id: "b", kind: "shape", shape: "frame", at: { x: 0, y: 0 }, width: 100, height: 60, label: "Group", stroke: "blue", fill: "none" };
const line = (from: AnnotationEnd, to: AnnotationEnd): Annotation => ({
  id: "c",
  kind: "connector",
  from,
  to,
  label: "same operator?",
  arrow: "end",
  color: "red",
});

describe("canvas presentation", () => {
  it("resolves connector ends to nodes, shapes, notes and points", () => {
    const positions = { A: { x: 5, y: 6 } };
    expect(resolveEnd({ kind: "node", id: "A" }, positions, [])).toEqual({ x: 5, y: 6 });
    expect(resolveEnd({ kind: "annotation", id: "b" }, positions, [box])).toEqual({ x: 50, y: 30 });
    expect(resolveEnd({ kind: "annotation", id: "n" }, positions, [note])).toEqual({ x: 110, y: 20 });
    expect(resolveEnd({ kind: "point", at: { x: 1, y: 2 } }, positions, [])).toEqual({ x: 1, y: 2 });
    expect(resolveEnd({ kind: "node", id: "gone" }, positions, [])).toBeNull();
  });

  it("turns an end on a removed item into a point where it was, keeping the connector", () => {
    const p = { ...emptyPresentation(), positions: { A: { x: 5, y: 6 } }, annotations: [note, line({ kind: "node", id: "A" }, { kind: "annotation", id: "n" })] };
    const detached = detachEnds(p, new Set(["A", "n"]));
    const c = detached.annotations.find((a) => a.id === "c");
    expect(c).toMatchObject({ from: { kind: "point", at: { x: 5, y: 6 } }, to: { kind: "point", at: { x: 110, y: 20 } }, label: "same operator?" });
  });

  it("leaves an end dangling when the removed item had no known position", () => {
    const p = { ...emptyPresentation(), annotations: [line({ kind: "node", id: "Z" }, { kind: "point", at: { x: 0, y: 0 } })] };
    const detached = detachEnds(p, new Set(["Z"]));
    expect(detached).toBe(p);
    expect(resolveEnd({ kind: "node", id: "Z" }, detached.positions, detached.annotations)).toBeNull();
  });

  it("knows its colour keys", () => {
    expect([isColorKey("red"), isColorKey("#ff0000"), isColorKey(undefined)]).toEqual([true, false, false]);
  });
});
