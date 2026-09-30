import { describe, expect, it } from "vitest";
import { buildCasePath, parseCasePath } from "./case-path";

describe("case paths", () => {
  it("round-trips views and the optional table wallet", () => {
    expect(parseCasePath("/case/case-123/graph")).toEqual({ caseId: "case-123", view: "graph", wallet: null });
    expect(parseCasePath(buildCasePath("case-123", "table", "Wallet123"))).toEqual({
      caseId: "case-123",
      view: "table",
      wallet: "Wallet123",
    });
  });
});
