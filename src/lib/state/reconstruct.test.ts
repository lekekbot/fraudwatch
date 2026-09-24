import { describe, expect, it } from "vitest";
import { generateHighActivity } from "../../../fixtures/solana/synthetic/generate";
import { NATIVE_SOL } from "@/lib/assets/assets";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { type CanonicalTransaction, canonicalize } from "@/lib/solana/canonical";
import { type Fixture, loadFixture } from "@/test/fixture-rpc";
import { type AssetChange, reconstructWalletState } from "./reconstruct";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function walletTransactions(fixture: Fixture, wallet: string): CanonicalTransaction[] {
  const wanted = new Set(fixture.manifest.expected.signaturesByWallet[wallet]);
  return fixture.rpc
    .filter((c) => c.request.method === "getTransaction" && wanted.has(c.request.params[0] as string))
    .map((c) => canonicalize((c.response as { result: RawParsedTransaction }).result));
}

const change = (effect: { assetChanges: AssetChange[] }, assetId: string) =>
  effect.assetChanges.find((c) => c.assetId === assetId);

describe("reconstructWalletState on A → B → C", () => {
  const fixture = loadFixture("a-to-b-to-c");
  const B = fixture.manifest.wallets[1].address;
  const A = fixture.manifest.wallets[0].address;

  it("rebuilds the intermediary's USDC: receive 200, poisoning dust, forward everything", () => {
    const state = reconstructWalletState(B, walletTransactions(fixture, B), { historyComplete: true });
    expect(state.effects.map((e) => change(e, USDC))).toEqual([
      { assetId: USDC, before: "0", delta: "200000000", after: "200000000" },
      { assetId: USDC, before: "200000000", delta: "1000", after: "200001000" },
      { assetId: USDC, before: "200001000", delta: "-200001000", after: "0" },
    ]);
    expect(state.opening.find((a) => a.assetId === USDC)).toEqual({ assetId: USDC, amount: "0", confidence: "observed" });
    expect(state.closing.find((a) => a.assetId === USDC)?.amount).toBe("0");
    expect(state.mismatches).toEqual([]);
    expect(state.openingStatus).toBe("OBSERVED");
    expect(state.decimals[USDC]).toBe(6);
  });

  it("charges fees only to the wallet that paid them, inside the SOL delta", () => {
    const state = reconstructWalletState(B, walletTransactions(fixture, B), { historyComplete: true });
    // B never paid a fee: A funded the first transfer, a relayer paid the forward.
    expect(state.effects.every((e) => e.feeLamports === "0")).toBe(true);

    const a = reconstructWalletState(A, walletTransactions(fixture, A), { historyComplete: true });
    const send = a.effects.find((e) => e.signature.startsWith("4C2F"))!;
    expect(send.feeLamports).toBe("18598");
    const sol = change(send, NATIVE_SOL)!;
    expect(BigInt(sol.delta)).toBeLessThanOrEqual(-BigInt(send.feeLamports));
  });

  it("orders effects chronologically even when given out of order", () => {
    const txs = walletTransactions(fixture, A).reverse();
    const state = reconstructWalletState(A, txs, { historyComplete: true });
    const slots = state.effects.map((e) => e.slot);
    expect(slots).toEqual([...slots].sort((x, y) => x - y));
  });

  it("gives every in-range transaction a wallet-specific effect", () => {
    for (const w of fixture.manifest.wallets) {
      const txs = walletTransactions(fixture, w.address);
      const state = reconstructWalletState(w.address, txs, { historyComplete: true });
      expect(state.effects).toHaveLength(txs.length);
      for (const e of state.effects) expect(e.assetChanges.length).toBeGreaterThan(0);
    }
  });
});

describe("reconstructWalletState on the high-activity wallet", () => {
  const fixture = generateHighActivity() as unknown as Fixture;
  const wallet = fixture.manifest.wallets[0].address;
  const txs = walletTransactions(fixture, wallet);

  it("chains every balance across 1,000 transactions with no mismatches", () => {
    const state = reconstructWalletState(wallet, txs, { historyComplete: true });
    expect(state.mismatches).toEqual([]);
    for (let i = 1; i < state.effects.length; i++) {
      for (const c of state.effects[i].assetChanges) {
        const previous = state.effects
          .slice(0, i)
          .reverse()
          .flatMap((e) => e.assetChanges)
          .find((p) => p.assetId === c.assetId);
        if (previous) expect(c.before, `${c.assetId} at ${i}`).toBe(previous.after);
      }
    }
  });

  it("closing state equals opening plus every delta", () => {
    const state = reconstructWalletState(wallet, txs, { historyComplete: true });
    for (const open of state.opening) {
      const total = state.effects
        .flatMap((e) => e.assetChanges)
        .filter((c) => c.assetId === open.assetId)
        .reduce((sum, c) => sum + BigInt(c.delta), BigInt(open.amount));
      expect(state.closing.find((c) => c.assetId === open.assetId)!.amount).toBe(total.toString());
    }
  });

  it("surfaces STATE_MISMATCH when a transaction is missing from the history", () => {
    const sorted = reconstructWalletState(wallet, txs, { historyComplete: true }).effects.map((e) => e.signature);
    const dropped = sorted[500];
    const state = reconstructWalletState(
      wallet,
      txs.filter((t) => t.signature !== dropped),
      { historyComplete: true },
    );
    expect(state.mismatches.length).toBeGreaterThan(0);
    expect(state.mismatches[0]).toMatchObject({ afterSignature: sorted[499], beforeSignature: sorted[501] });
    expect(state.openingStatus).toBe("OPENING_STATE_PARTIAL");
    expect(state.partialReasons.join(" ")).toMatch(/STATE_MISMATCH/);
  });

  it("marks opening and closing partial when history is incomplete", () => {
    const state = reconstructWalletState(wallet, txs.slice(0, 10), { historyComplete: false });
    expect(state.openingStatus).toBe("OPENING_STATE_PARTIAL");
    expect(state.closingStatus).toBe("CLOSING_STATE_PARTIAL");
    expect(state.opening.every((a) => a.confidence === "partial")).toBe(true);
  });
});

describe("reconstructWalletState with several token accounts for one mint", () => {
  const W = "Wallet1111111111111111111111111111111111111";
  const tx = (signature: string, slot: number, balances: Array<[string, string, string]>): CanonicalTransaction => ({
    signature,
    slot,
    transactionIndex: 0,
    timestamp: null,
    success: true,
    feeLamports: "5000",
    accounts: [],
    nativeChanges: [],
    tokenChanges: balances.map(([account, pre, post]) => ({
      account,
      owner: W,
      mint: USDC,
      programId: null,
      decimals: 6,
      pre,
      post,
      delta: (BigInt(post) - BigInt(pre)).toString(),
    })),
    instructions: [],
    innerInstructions: [],
    raw: null,
  });

  it("sums the wallet's balance across accounts a transaction didn't touch", () => {
    const state = reconstructWalletState(
      W,
      [tx("s1", 1, [["acct1", "100", "150"]]), tx("s2", 2, [["acct2", "40", "0"]]), tx("s3", 3, [["acct1", "150", "160"]])],
      { historyComplete: true },
    );
    expect(state.opening[0].amount).toBe("140");
    expect(state.effects.map((e) => change(e, USDC))).toEqual([
      { assetId: USDC, before: "140", delta: "50", after: "190" },
      { assetId: USDC, before: "190", delta: "-40", after: "150" },
      { assetId: USDC, before: "150", delta: "10", after: "160" },
    ]);
    expect(state.closing[0].amount).toBe("160");
  });
});
