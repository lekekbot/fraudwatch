import { describe, expect, it } from "vitest";
import { buildCasePath, isCaseRoute, parseCasePath } from "./case-path";

describe("case paths", () => {
  it("round-trips views and the optional table wallet", () => {
    expect(parseCasePath("/case/case-123/graph")).toEqual({ caseId: "case-123", view: "graph", wallet: null });
    expect(parseCasePath(buildCasePath("case-123", "table", "Wallet123"))).toEqual({
      caseId: "case-123",
      view: "table",
      wallet: "Wallet123",
    });
  });

  it("accepts a case and view, and a wallet only on the table", () => {
    expect(isCaseRoute(["c1", "graph"])).toBe(true);
    expect(isCaseRoute(["c1", "table", "W"])).toBe(true);
    expect(isCaseRoute(["c1", "graph", "W"])).toBe(false);
    expect(isCaseRoute(["c1", "nope"])).toBe(false);
    expect(isCaseRoute(["c1"])).toBe(false);
    expect(isCaseRoute(["c1", "table", "W", "x"])).toBe(false);
  });
});
