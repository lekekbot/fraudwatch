import { describe, expect, it } from "vitest";
import { isValidSolanaAddress, shortenAddress } from "./address";

describe("isValidSolanaAddress", () => {
  it("accepts real base58 32-byte addresses", () => {
    expect(isValidSolanaAddress("dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo")).toBe(true);
    expect(isValidSolanaAddress("11111111111111111111111111111111")).toBe(true);
    expect(isValidSolanaAddress("  dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo  ")).toBe(true);
  });

  it("rejects non-base58, wrong-length, and EVM addresses", () => {
    expect(isValidSolanaAddress("")).toBe(false);
    expect(isValidSolanaAddress("0x5b88f39f62661aa5d8da7619515ac1b5d73aadcf")).toBe(false);
    expect(isValidSolanaAddress("dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5V0")).toBe(false); // 0 is not base58
    expect(isValidSolanaAddress("dLm61Lvpigiaig9ZHcdh6iE7mFp7")).toBe(false);
  });
});

describe("shortenAddress", () => {
  it("keeps head and tail", () => {
    expect(shortenAddress("dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo")).toBe("dLm6…f5Vo");
    expect(shortenAddress("abc")).toBe("abc");
  });
});
