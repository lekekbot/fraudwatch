import { describe, expect, it } from "vitest";
import type { EffectSummary } from "@/lib/state/summarize";
import { EMPTY_FILTER, type FilterableTx, involvedAddresses, isFilterActive, movedAssets, passesFilter, type TxFilter, toggled } from "./filter";

const summary = (kind: EffectSummary["kind"], outflows: [string, string][] = [], inflows: [string, string][] = [], extra: Partial<EffectSummary> = {}): EffectSummary => ({
  kind,
  outflows: outflows.map(([assetId, delta]) => ({ assetId, delta })),
  inflows: inflows.map(([assetId, delta]) => ({ assetId, delta })),
  counterparties: [],
  action: null,
  actor: null,
  ...extra,
});

const tx = (s: EffectSummary, extra: Partial<FilterableTx> = {}): FilterableTx => ({ signature: "sig", time: 1000, summary: s, protocols: [], addresses: [], ...extra });
const with_ = (patch: Partial<TxFilter>): TxFilter => ({ ...EMPTY_FILTER, ...patch });

describe("passesFilter", () => {
  it("shows everything with the empty filter", () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(passesFilter(tx(summary("PROGRAM")), EMPTY_FILTER)).toBe(true);
  });

  it("hides by kind", () => {
    const f = with_({ hiddenKinds: new Set(["ACCOUNT" as const]) });
    expect(isFilterActive(f)).toBe(true);
    expect(passesFilter(tx(summary("ACCOUNT")), f)).toBe(false);
    expect(passesFilter(tx(summary("SEND", [["SOL", "-1"]])), f)).toBe(true);
  });

  it("hides by asset only when every moved asset is hidden", () => {
    const f = with_({ hiddenAssets: new Set(["SPAM"]) });
    expect(passesFilter(tx(summary("RECEIVE", [], [["SPAM", "1"]])), f)).toBe(false);
    expect(passesFilter(tx(summary("SWAP", [["SPAM", "-1"]], [["USDC", "1"]])), f)).toBe(true);
    // Nothing moved: the asset filter doesn't apply.
    expect(passesFilter(tx(summary("PROGRAM")), f)).toBe(true);
  });

  it("filters by direction; a swap is both incoming and outgoing", () => {
    const send = tx(summary("SEND", [["SOL", "-1"]]));
    const receive = tx(summary("RECEIVE", [], [["SOL", "1"]]));
    const swap = tx(summary("SWAP", [["SOL", "-1"]], [["USDC", "1"]]));
    expect([send, receive, swap].map((t) => passesFilter(t, with_({ direction: "in" })))).toEqual([false, true, true]);
    expect([send, receive, swap].map((t) => passesFilter(t, with_({ direction: "out" })))).toEqual([true, false, true]);
  });

  it("keeps only transactions moving at least the minimum of an asset, either way", () => {
    const f = with_({ minAmount: { assetId: "USDC", amount: "1000000" } });
    expect(passesFilter(tx(summary("SEND", [["USDC", "-1000000"]])), f)).toBe(true);
    expect(passesFilter(tx(summary("RECEIVE", [], [["USDC", "999999"]])), f)).toBe(false);
    expect(passesFilter(tx(summary("RECEIVE", [], [["SOL", "5000000000"]])), f)).toBe(false);
  });

  it("filters by protocol, address, tag and date range", () => {
    const t = tx(summary("SWAP", [["SOL", "-1"]], [["USDC", "1"]]), { protocols: ["jupiter"], addresses: ["A", "B"], time: 5000 });
    const tags = (a: string) => (a === "B" ? ["cex"] : []);
    expect(passesFilter(t, with_({ protocols: new Set(["jupiter", "raydium"]) }))).toBe(true);
    expect(passesFilter(t, with_({ protocols: new Set(["raydium"]) }))).toBe(false);
    expect(passesFilter(t, with_({ address: "B" }))).toBe(true);
    expect(passesFilter(t, with_({ address: "C" }))).toBe(false);
    expect(passesFilter(t, with_({ tags: new Set(["cex"]) }), tags)).toBe(true);
    expect(passesFilter(t, with_({ tags: new Set(["mixer"]) }), tags)).toBe(false);
    expect(passesFilter(t, with_({ dateRange: { start: 5000, end: 6000 } }))).toBe(true);
    expect(passesFilter(t, with_({ dateRange: { start: 0, end: 5000 } }))).toBe(false);
  });
});

describe("involvedAddresses", () => {
  it("keeps only a graph relationship's transactions", () => {
    const f = with_({ relationship: { label: "A ↔ B", signatures: new Set(["sig"]) } });
    expect(isFilterActive(f)).toBe(true);
    expect(passesFilter(tx(summary("SEND")), f)).toBe(true);
    expect(passesFilter(tx(summary("SEND"), { signature: "other" }), f)).toBe(false);
  });

  it("collects counterparties, sender and NFT party once each", () => {
    const s = summary("PROGRAM", [], [], {
      counterparties: [
        { address: "A", assetId: "SOL", delta: "1" },
        { address: "A", assetId: "USDC", delta: "1" },
      ],
      actor: "BOT",
    });
    expect(involvedAddresses(s)).toEqual(["A", "BOT"]);
  });
});

describe("movedAssets", () => {
  it("lists each asset once", () => {
    expect(movedAssets(summary("SWAP", [["USDC", "-1"], ["SOL", "-1"]], [["USDC", "1"]]))).toEqual(["USDC", "SOL"]);
  });
});

describe("toggled", () => {
  it("adds and removes without mutating", () => {
    const a = new Set([1]);
    expect([...toggled(a, 2)]).toEqual([1, 2]);
    expect([...toggled(a, 1)]).toEqual([]);
    expect([...a]).toEqual([1]);
  });

  it("leaves out transactions with a likely decoy only when asked", () => {
    const withDecoy = tx(summary("RECEIVE", [["SOL", "1"]]), { addresses: ["DECOY"] });
    const isDecoy = (a: string) => a === "DECOY";
    expect(passesFilter(withDecoy, EMPTY_FILTER, undefined, isDecoy)).toBe(true);
    const f = with_({ hideDecoys: true });
    expect(isFilterActive(f)).toBe(true);
    expect(passesFilter(withDecoy, f, undefined, isDecoy)).toBe(false);
    expect(passesFilter(tx(summary("RECEIVE", [["SOL", "1"]]), { addresses: ["FRIEND"] }), f, undefined, isDecoy)).toBe(true);
  });
});

