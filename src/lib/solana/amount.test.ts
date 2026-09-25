import { describe, expect, it } from "vitest";
import { formatBaseUnits, formatLamports, parseUnits } from "./amount";

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

describe("parseUnits", () => {
  it("turns typed decimals into base units", () => {
    expect(parseUnits("1.5", 6)).toBe("1500000");
    expect(parseUnits("  250 ", 6)).toBe("250000000");
    expect(parseUnits(".25", 9)).toBe("250000000");
    expect(parseUnits("1", 0)).toBe("1");
  });

  it("rejects what isn't a plain amount or is finer than the asset allows", () => {
    expect(parseUnits("", 6)).toBeNull();
    expect(parseUnits("-1", 6)).toBeNull();
    expect(parseUnits("1e3", 6)).toBeNull();
    expect(parseUnits("0.0000001", 6)).toBeNull();
  });
});
