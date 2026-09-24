import { describe, expect, it } from "vitest";
import { registry } from "@/lib/protocols/registry";
import { addressState } from "./address-state";

const PRIMARY = "dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo";
const MAPPED = "4VWKf8NrCT5gK3f1YwPRspArUU7KZNKBvYqF8rxVZVCi";
const c = {
  primaryWallet: PRIMARY,
  mappedWallets: [
    { address: PRIMARY, role: "primary" as const, rangeMode: "case" as const },
    { address: MAPPED, role: "mapped" as const, rangeMode: "case" as const },
  ],
};

describe("addressState", () => {
  it("classifies primary, mapped, registry infrastructure, and everything else as observed", () => {
    expect(addressState(PRIMARY, c, registry)).toBe("PRIMARY");
    expect(addressState(MAPPED, c, registry)).toBe("MAPPED");
    expect(addressState("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", c, registry)).toBe("INFRASTRUCTURE");
    expect(addressState("3WNqDSBxxZ7BtdyGYHdLHeZWBu2aXEomkX9YVAeZGy5a", c, registry)).toBe("OBSERVED");
  });

  it("treats an invoked program as infrastructure even when the registry doesn't know it", () => {
    const unknownProgram = "HobbakUnknownProgram1111111111111111111111";
    expect(addressState(unknownProgram, c, registry)).toBe("OBSERVED");
    expect(addressState(unknownProgram, c, registry, new Set([unknownProgram]))).toBe("INFRASTRUCTURE");
  });
});
