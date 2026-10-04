import { describe, expect, it } from "vitest";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import { createCase } from "./model";
import { firstInteraction, mapWallet, MappingError, newWalletProblem, toggleWalletPaused, unmapWallet, walletRange, walletRanges } from "./wallet-range";

const A = "dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo";
const B = "4VWKf8NrCT5gK3f1YwPRspArUU7KZNKBvYqF8rxVZVCi";
const RANGE = { start: "2026-06-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" };
const base = () => createCase({ name: "c", primaryWallet: A, range: RANGE }, { id: "c", now: new Date("2026-09-24") });

const tx = (signature: string, timestamp: string | null, accounts: string[], owners: string[] = []): CanonicalTransaction => ({
  signature,
  slot: 1,
  transactionIndex: null,
  timestamp,
  success: true,
  feeLamports: "0",
  accounts: accounts.map((address) => ({ address, signer: false, writable: false, source: "transaction" })),
  nativeChanges: [],
  tokenChanges: owners.map((owner) => ({ account: `ata-${owner}`, mint: "M", owner, programId: null, decimals: 0, pre: "0", post: "1", delta: "1" })),
  instructions: [],
  innerInstructions: [],
  raw: null,
});

describe("mapWallet", () => {
  it("adds a wallet from its first interaction, remembering where it came from", () => {
    const c = mapWallet(base(), {
      address: B,
      rangeMode: "first_interaction",
      start: "2026-07-12T13:59:48.000Z",
      addedFromWallet: A,
    });
    expect(c.mappedWallets[1]).toEqual({
      address: B,
      rangeMode: "first_interaction",
      customStart: "2026-07-12T13:59:48.000Z",
      addedFromWallet: A,
    });
    expect(walletRange(c, c.mappedWallets[1])).toEqual({ start: "2026-07-12T13:59:48.000Z", end: RANGE.end });
    expect(walletRanges(c)[A]).toEqual(RANGE);
  });

  it("uses the case range for case mode and clamps early starts to the case start", () => {
    expect(walletRange(base(), mapWallet(base(), { address: B, rangeMode: "case" }).mappedWallets[1])).toEqual(RANGE);
    const early = mapWallet(base(), { address: B, rangeMode: "custom", start: "2020-01-01T00:00:00.000Z" });
    expect(early.mappedWallets[1].customStart).toBe(RANGE.start);
  });

  it("rejects duplicates, missing starts and starts after the case end", () => {
    expect(() => mapWallet(base(), { address: A, rangeMode: "case" })).toThrow(MappingError);
    expect(() => mapWallet(base(), { address: B, rangeMode: "custom" })).toThrow(/Choose a start/);
    expect(() => mapWallet(base(), { address: B, rangeMode: "custom", start: RANGE.end })).toThrow(/before the case end/);
  });
});

describe("unmapWallet", () => {
  it("removes a mapped wallet but never the primary", () => {
    const mapped = mapWallet(base(), { address: B, rangeMode: "case" });
    expect(unmapWallet(mapped, B).mappedWallets.map((w) => w.address)).toEqual([A]);
    expect(() => unmapWallet(mapped, A)).toThrow(/primary/);
    expect(() => unmapWallet(base(), B)).toThrow(/isn't mapped/);
  });
});

describe("toggleWalletPaused", () => {
  it("pauses and resumes a mapped wallet, but never the primary", () => {
    const mapped = mapWallet(base(), { address: B, rangeMode: "case" });
    const paused = toggleWalletPaused(mapped, B);
    expect(paused.mappedWallets.find((w) => w.address === B)?.paused).toBe(true);
    expect(toggleWalletPaused(paused, B).mappedWallets.find((w) => w.address === B)?.paused).toBe(false);
    expect(toggleWalletPaused(mapped, A)).toBe(mapped);
  });
});

describe("firstInteraction", () => {
  it("finds the earliest transaction involving the address as an account or token owner", () => {
    const txs = [
      tx("late", "2026-08-01T00:00:00.000Z", [A, B]),
      tx("owner", "2026-07-01T00:00:00.000Z", [A], [B]),
      tx("untimed", null, [B]),
      tx("other", "2026-06-01T00:00:00.000Z", [A]),
    ];
    expect(firstInteraction(B, txs)).toEqual({ timestamp: "2026-07-01T00:00:00.000Z", signature: "owner" });
    expect(firstInteraction("nobody", txs)).toBeNull();
  });
});

describe("newWalletProblem", () => {
  it("accepts a new, valid wallet address and trims it", () => {
    expect(newWalletProblem(`  ${B} `, base(), () => false)).toBeNull();
  });

  it("explains why an address can't be added", () => {
    expect(newWalletProblem("", base(), () => false)).toMatch(/Paste/);
    expect(newWalletProblem("0xabc", base(), () => false)).toMatch(/Not a valid/);
    expect(newWalletProblem(A, base(), () => false)).toMatch(/already mapped/);
    expect(newWalletProblem(B, base(), (a) => a === B)).toMatch(/program or protocol/);
  });
});
