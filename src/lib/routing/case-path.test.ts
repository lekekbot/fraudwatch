import { describe, expect, it } from "vitest";
import { buildCasePath, casePathFor, isCaseRoute, parseCasePath } from "./case-path";

describe("where a case opens", () => {
  it("opens on the chosen view, or the last one used", () => {
    expect(casePathFor({ id: "c" }, "graph")).toBe("/case/c/graph");
    expect(casePathFor({ id: "c", lastView: "table" }, "last")).toBe("/case/c/table");
    expect(casePathFor({ id: "c" }, "last")).toBe("/case/c/timeline");
    expect(casePathFor({ id: "c", lastView: "bogus" as never }, "last")).toBe("/case/c/timeline");
  });
});

describe("the trace view", () => {
  it("accepts an optional trace id but no id on other views", () => {
    expect(isCaseRoute(["c", "trace"])).toBe(true);
    expect(isCaseRoute(["c", "trace", "t1"])).toBe(true);
    expect(isCaseRoute(["c", "graph", "t1"])).toBe(false);
    expect(parseCasePath("/case/c/trace/")).toEqual({ caseId: "c", view: "trace", wallet: null, traceId: null });
    expect(parseCasePath("/case/c/trace/t1/")).toEqual({ caseId: "c", view: "trace", wallet: null, traceId: "t1" });
    expect(buildCasePath("c", "trace")).toBe("/case/c/trace");
    expect(buildCasePath("c", "trace", "t1")).toBe("/case/c/trace/t1");
  });
});
