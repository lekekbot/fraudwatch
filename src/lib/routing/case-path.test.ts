import { describe, expect, it } from "vitest";
import { casePathFor } from "./case-path";

describe("where a case opens", () => {
  it("opens on the chosen view, or the last one used", () => {
    expect(casePathFor({ id: "c" }, "graph")).toBe("/case/c/graph");
    expect(casePathFor({ id: "c", lastView: "table" }, "last")).toBe("/case/c/table");
    expect(casePathFor({ id: "c" }, "last")).toBe("/case/c/timeline");
    expect(casePathFor({ id: "c", lastView: "bogus" as never }, "last")).toBe("/case/c/timeline");
  });
});
