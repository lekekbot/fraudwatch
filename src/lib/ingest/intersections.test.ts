import { describe, expect, it } from "vitest";
import type { WalletIngestion } from "./ingest";
import { mappingSummary, sharedTransactions } from "./intersections";

const w = (wallet: string, signatures: string[], cached = 0, fetched = 0): WalletIngestion => ({
  wallet,
  signatures,
  tokenAccounts: [],
  coverage: { complete: true, signatureCount: signatures.length, transactionCount: signatures.length, warnings: [] },
  stats: { cachedTransactions: cached, fetchedTransactions: fetched, rangesFetched: [] },
});

describe("sharedTransactions", () => {
  it("compares every pair of mapped wallets, not just the one B was mapped from", () => {
    const shared = sharedTransactions([w("A", ["1", "2", "3"]), w("C", ["3", "4"]), w("B", ["2", "3", "4", "5"])]);
    expect(Object.fromEntries(shared.get("B")!)).toEqual({ A: ["2", "3"], C: ["3", "4"] });
    expect(Object.fromEntries(shared.get("A")!)).toEqual({ B: ["2", "3"], C: ["3"] });
  });
});

describe("mappingSummary", () => {
  it("reports what loading B found", () => {
    const wallets = [w("A", ["1", "2"]), w("B", ["2", "3", "4"], 1, 2)];
    const summary = mappingSummary(wallets[1], sharedTransactions(wallets), ["X", "Y", "A", "Z"], new Set(["A", "X"]));
    expect(summary).toEqual({ wallet: "B", inRange: 3, cached: 1, fetched: 2, shared: [{ wallet: "A", count: 1 }], newObserved: 2 });
  });
});
