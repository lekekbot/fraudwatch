import { describe, expect, it } from "vitest";
import { NATIVE_SOL } from "@/lib/assets/assets";
import type { EffectSummary } from "./summarize";
import { counterpartyRows, transactedOverview, type TransactedRow } from "./volume";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NFT = "NFTMint1111111111111111111111111111111111111111";

/** A minimal summary: only the fields the overview reads. */
const summary = (inflows: [string, string][], outflows: [string, string][] = [], parties: [string, string, string][] = []): EffectSummary => ({
  kind: "SEND",
  outflows: outflows.map(([assetId, delta]) => ({ assetId, delta })),
  inflows: inflows.map(([assetId, delta]) => ({ assetId, delta })),
  counterparties: parties.map(([address, assetId, delta]) => ({ address, assetId, delta })),
  action: null,
  actor: null,
});

const NFTS = { isNft: (mint: string) => mint === NFT, royaltyRecipients: () => [] };
const NO_NFTS = { isNft: () => false, royaltyRecipients: () => [] };

const rows = (...r: [string, EffectSummary][]): TransactedRow[] => r.map(([signature, s]) => ({ signature, time: null, summary: s }));

describe("transactedOverview", () => {
  it("sums in, out and net per asset across transactions", () => {
    const overview = transactedOverview(
      rows(
        ["a", summary([[USDC, "200000000"]], [[NATIVE_SOL, "-1000000"]])],
        ["b", summary([[NATIVE_SOL, "3000000000"]], [[USDC, "-50000000"]])],
      ),
      NO_NFTS,
    );
    expect(overview.transactions).toBe(2);
    expect(overview.assets).toEqual([
      { assetId: NATIVE_SOL, in: "3000000000", out: "1000000", net: "2999000000", count: 2 },
      { assetId: USDC, in: "200000000", out: "50000000", net: "150000000", count: 2 },
    ]);
  });

  it("counts a transaction shared by two mapped wallets once, from the first side", () => {
    const send = summary([], [[USDC, "-1000000"]]);
    const receive = summary([[USDC, "1000000"]]);
    const overview = transactedOverview(rows(["shared", send], ["shared", receive], ["other", summary([], [[NATIVE_SOL, "-2000"]])]), NO_NFTS);
    expect(overview.transactions).toBe(2);
    expect(overview.sharedSides).toBe(1);
    expect(overview.assets.find((a) => a.assetId === USDC)).toMatchObject({ in: "0", out: "1000000", net: "-1000000" });
  });

  it("counts NFTs moved instead of summing them as amounts", () => {
    const overview = transactedOverview(
      rows(["a", summary([[NFT, "1"], [NATIVE_SOL, "50000000"]], [[NFT, "1"]])], ["b", summary([[NFT, "2"]])]),
      NFTS,
    );
    expect(overview.assets.map((a) => a.assetId)).toEqual([NATIVE_SOL]);
    expect(overview.nfts).toEqual({ in: 3, out: 1 });
  });

  it("reports nothing for transactions that moved no value", () => {
    const overview = transactedOverview(rows(["a", summary([], [])]), NO_NFTS);
    expect(overview.assets).toEqual([]);
    expect(overview.transactions).toBe(1);
  });
});

describe("counterpartyRows", () => {
  it("flips to the counterparty's side and counts a shared transaction once", () => {
    const withParty = (s: EffectSummary, address: string, assetId: string, delta: string): EffectSummary => ({
      ...s,
      counterparties: [{ address, assetId, delta }],
    });
    const sides = rows(
      ["a", withParty(summary([], [[USDC, "-5"]]), "X", USDC, "5")],
      ["a", withParty(summary([[USDC, "5"]]), "X", USDC, "5")],
      ["b", withParty(summary([[NATIVE_SOL, "7"]]), "X", NATIVE_SOL, "-7")],
      ["c", withParty(summary([[NATIVE_SOL, "9"]]), "Y", NATIVE_SOL, "-9")],
    );
    const overview = transactedOverview(counterpartyRows("X", sides), NO_NFTS);
    expect(overview.transactions).toBe(2);
    expect(overview.assets).toEqual([
      { assetId: NATIVE_SOL, in: "0", out: "7", net: "-7", count: 1 },
      { assetId: USDC, in: "5", out: "0", net: "5", count: 1 },
    ]);
  });

  it("keeps the transaction's time for the drill-down", () => {
    const sides: TransactedRow[] = [{ signature: "a", time: 123, summary: summary([], [[USDC, "-5"]], [["X", USDC, "5"]]) }];
    expect(counterpartyRows("X", sides)[0].time).toBe(123);
  });
});
