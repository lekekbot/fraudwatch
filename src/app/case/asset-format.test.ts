import { describe, expect, it } from "vitest";
import { compactAmount } from "./asset-format";

describe("compact amounts", () => {
  it("shortens large amounts and keeps the sign", () => {
    expect(compactAmount("1,234,567.891")).toBe("1.23M");
    expect(compactAmount("-6,315.903206")).toBe("-6.32K");
    expect(compactAmount("+12,000")).toBe("+12K");
  });

  it("leaves amounts under 1,000 exact, so dust never rounds away", () => {
    expect(compactAmount("999.123456789")).toBe("999.123456789");
    expect(compactAmount("0.000001")).toBe("0.000001");
  });
});
