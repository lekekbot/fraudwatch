import { describe, expect, it } from "vitest";
import { createCase } from "./model";
import { mapWallet, secondaryWalletProblems } from "./wallet-range";

const PRIMARY = "HkGz4KmoZ7Zmk7HN6ndJ31UJ1qZ2qgwQxgVqQwovpZES";
const A = "8ubo4HwmYpSWuwDUSGtp9HkfJqqa9CfNtEiMhAZ9rGxw";
const B = "BGm1QuqFqG5mUnp2ZAhJHrQ8p8D3KFf3XKtRuVyvKD5Y";
const PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const isInfrastructure = (address: string) => address === PROGRAM;

describe("secondary wallets on a new case", () => {
  it("accepts valid, distinct wallets and ignores blank rows", () => {
    expect(secondaryWalletProblems([A, "", ` ${B} `], PRIMARY, isInfrastructure)).toEqual([null, null, null]);
  });

  it("explains each bad row: the primary again, a duplicate, an invalid address, a program", () => {
    expect(secondaryWalletProblems([PRIMARY, A, A, "not-an-address", PROGRAM], PRIMARY, isInfrastructure)).toEqual([
      "That's the primary wallet.",
      null,
      "This wallet is already mapped.",
      "Not a valid Solana address.",
      "That's a program or protocol address, not a wallet.",
    ]);
  });

  it("maps each secondary wallet over the whole case range", () => {
    const range = { start: "2026-03-24T00:00:00.000Z", end: "2026-09-29T00:00:00.000Z" };
    const c = [A, B].reduce((acc, address) => mapWallet(acc, { address, rangeMode: "case" }), createCase({ name: "Case", primaryWallet: PRIMARY, range }));
    expect(c.mappedWallets).toEqual([
      { address: PRIMARY, rangeMode: "case" },
      { address: A, rangeMode: "case" },
      { address: B, rangeMode: "case" },
    ]);
  });
});
