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
  it("is a case view with no wallet segment", () => {
    expect(isCaseRoute(["c", "trace"])).toBe(true);
    expect(isCaseRoute(["c", "trace", "W"])).toBe(false);
    expect(parseCasePath("/case/c/trace/")).toEqual({ caseId: "c", view: "trace", wallet: null });
    expect(buildCasePath("c", "trace")).toBe("/case/c/trace");
  });
});
