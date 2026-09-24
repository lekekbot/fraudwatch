import { describe, expect, it } from "vitest";
import { formatBaseUnits, formatLamports } from "./amount";

describe("formatBaseUnits", () => {
  it.each([
    ["2000000000", 6, "2,000"],
    ["199819667", 6, "199.819667"],
    ["-181513", 6, "-0.181513"],
    ["5", 9, "0.000000005"],
    ["0", 6, "0"],
    ["-0", 6, "0"],
    ["1234567", 0, "1,234,567"],
  ])("%s with %i decimals → %s", (amount, decimals, expected) => {
    expect(formatBaseUnits(amount, decimals)).toBe(expected);
  });

  it("formats lamports as SOL", () => {
    expect(formatLamports("110000")).toBe("0.00011 SOL");
  });
});
