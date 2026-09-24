import { describe, expect, it } from "vitest";
import type { EffectSummary } from "@/lib/state/summarize";
import { EMPTY_FILTER, isFilterActive, movedAssets, passesFilter, toggled } from "./filter";

const summary = (kind: EffectSummary["kind"], outflows: string[] = [], inflows: string[] = []): EffectSummary => ({
  kind,
  outflows: outflows.map((assetId) => ({ assetId, delta: "-1" })),
  inflows: inflows.map((assetId) => ({ assetId, delta: "1" })),
  counterparties: [],
});

describe("passesFilter", () => {
  it("shows everything with the empty filter", () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(passesFilter("a", summary("OTHER"), EMPTY_FILTER)).toBe(true);
  });

  it("hides by kind and by signature", () => {
    const f = { ...EMPTY_FILTER, hiddenKinds: new Set(["FEE" as const]), hiddenSignatures: new Set(["b"]) };
    expect(isFilterActive(f)).toBe(true);
    expect(passesFilter("a", summary("FEE"), f)).toBe(false);
    expect(passesFilter("b", summary("SEND", ["SOL"]), f)).toBe(false);
    expect(passesFilter("c", summary("SEND", ["SOL"]), f)).toBe(true);
  });

  it("hides by asset only when every moved asset is hidden", () => {
    const f = { ...EMPTY_FILTER, hiddenAssets: new Set(["SPAM"]) };
    expect(passesFilter("a", summary("RECEIVE", [], ["SPAM"]), f)).toBe(false);
    expect(passesFilter("b", summary("SWAP", ["SPAM"], ["USDC"]), f)).toBe(true);
    // Nothing moved: the asset filter doesn't apply.
    expect(passesFilter("c", summary("FEE"), f)).toBe(true);
  });
});

describe("movedAssets", () => {
  it("lists each asset once", () => {
    expect(movedAssets(summary("SWAP", ["USDC", "SOL"], ["USDC"]))).toEqual(["USDC", "SOL"]);
  });
});

describe("toggled", () => {
  it("adds and removes without mutating", () => {
    const a = new Set([1]);
    expect([...toggled(a, 2)]).toEqual([1, 2]);
    expect([...toggled(a, 1)]).toEqual([]);
    expect([...a]).toEqual([1]);
  });
});
