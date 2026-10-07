import { NATIVE_SOL } from "@/lib/assets/assets";
import type { CanonicalTransaction } from "@/lib/solana/canonical";

/** Bump when reconstruction output changes; cached wallet states are then rebuilt. */
export const RECONSTRUCTION_VERSION = 1;

export type AssetChange = {
  /** Mint address, or NATIVE_SOL. */
  assetId: string;
  before?: string;
  delta: string;
  after?: string;
};

export type WalletTransactionEffect = {
  wallet: string;
  signature: string;
  slot: number;
  timestamp: string | null;
  success: boolean;
  assetChanges: AssetChange[];
  /** Fee this wallet paid; "0" when someone else was the fee payer. Already included in the SOL delta. */
  feeLamports: string;
};

export type Confidence = "observed" | "partial";

export type AssetState = { assetId: string; amount: string; confidence: Confidence };

/**
 * A balance that doesn't chain: an account's balance after one transaction
 * differs from its balance before the next one. Something moved the balance in
 * between that isn't in the loaded history.
 */
export type StateMismatch = {
  assetId: string;
  /** The wallet account (SOL) or token account whose balance didn't chain. */
  account: string;
  expected: string;
  observed: string;
  afterSignature: string;
  beforeSignature: string;
};

export type WalletState = {
  wallet: string;
  effects: WalletTransactionEffect[];
  opening: AssetState[];
  closing: AssetState[];
  /** OPENING_STATE_PARTIAL when the opening can't be taken as exact; the reasons say why. */
  openingStatus: "OBSERVED" | "OPENING_STATE_PARTIAL";
  closingStatus: "OBSERVED" | "CLOSING_STATE_PARTIAL";
  partialReasons: string[];
  mismatches: StateMismatch[];
  /** Decimals per asset, as reported by the transactions themselves. */
  decimals: Record<string, number>;
};

type Observation = { index: number; pre: bigint; post: bigint };

type Holding = { account: string; assetId: string; observations: Observation[] };

/** Chronological order: slot, then position in the slot, then signature as a stable tiebreak. */
export function compareTransactions(a: CanonicalTransaction, b: CanonicalTransaction): number {
  if (a.slot !== b.slot) return a.slot - b.slot;
  const ai = a.transactionIndex ?? Number.MAX_SAFE_INTEGER;
  const bi = b.transactionIndex ?? Number.MAX_SAFE_INTEGER;
  if (ai !== bi) return ai - bi;
  return a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0;
}

/**
 * Rebuild a wallet's balances before and after each of its transactions.
 *
 * Every balance here is observed, not simulated: transaction metadata carries
 * pre/post balances for each account it touches. State is tracked per account
 * (the wallet's own lamports, and each token account it owns), because a
 * transaction may touch one of several token accounts holding the same mint.
 * The wallet's per-asset balance is the sum across those accounts, using each
 * account's most recent observation.
 */
export function reconstructWalletState(
  wallet: string,
  transactions: CanonicalTransaction[],
  options: { historyComplete: boolean },
): WalletState {
  const ordered = [...transactions].sort(compareTransactions);
  const holdings = new Map<string, Holding>();
  const decimals: Record<string, number> = {};
  const touched: Array<Set<string>> = [];

  const observe = (key: string, account: string, assetId: string, index: number, pre: bigint, post: bigint) => {
    let holding = holdings.get(key);
    if (!holding) {
      holding = { account, assetId, observations: [] };
      holdings.set(key, holding);
    }
    holding.observations.push({ index, pre, post });
    touched[index].add(key);
  };

  ordered.forEach((tx, index) => {
    touched[index] = new Set();
    const native = tx.nativeChanges.find((c) => c.account === wallet);
    if (native) observe(`${NATIVE_SOL}:${wallet}`, wallet, NATIVE_SOL, index, BigInt(native.pre), BigInt(native.post));
    for (const t of tx.tokenChanges) {
      if (t.owner !== wallet) continue;
      decimals[t.mint] = t.decimals;
      observe(`${t.mint}:${t.account}`, t.account, t.mint, index, BigInt(t.pre), BigInt(t.post));
    }
  });

  // Mismatches: consecutive observations of the same account must chain.
  const mismatches: StateMismatch[] = [];
  for (const h of holdings.values()) {
    for (let i = 1; i < h.observations.length; i++) {
      const prev = h.observations[i - 1];
      const next = h.observations[i];
      if (prev.post !== next.pre) {
        mismatches.push({
          assetId: h.assetId,
          account: h.account,
          expected: prev.post.toString(),
          observed: next.pre.toString(),
          afterSignature: ordered[prev.index].signature,
          beforeSignature: ordered[next.index].signature,
        });
      }
    }
  }

  // Balance of a holding just before transaction `index` (or after the last one when index = length).
  const balanceBefore = (h: Holding, index: number): bigint => {
    let balance = h.observations[0].pre;
    for (const o of h.observations) {
      if (o.index >= index) break;
      balance = o.post;
    }
    return balance;
  };
  const sumBy = (assetId: string, value: (h: Holding) => bigint) =>
    [...holdings.values()].filter((h) => h.assetId === assetId).reduce((sum, h) => sum + value(h), 0n);

  const effects: WalletTransactionEffect[] = ordered.map((tx, index) => {
    const assets = [...new Set([...touched[index]].map((key) => holdings.get(key)!.assetId))];
    const assetChanges = assets
      .sort((a, b) => (a === NATIVE_SOL ? -1 : b === NATIVE_SOL ? 1 : a.localeCompare(b)))
      .map((assetId) => {
        const before = sumBy(assetId, (h) => balanceBefore(h, index));
        const after = sumBy(assetId, (h) => balanceBefore(h, index + 1));
        return { assetId, before: before.toString(), delta: (after - before).toString(), after: after.toString() };
      });
    const payer = tx.accounts[0]?.address === wallet;
    return {
      wallet,
      signature: tx.signature,
      slot: tx.slot,
      timestamp: tx.timestamp,
      success: tx.success,
      assetChanges,
      feeLamports: payer ? tx.feeLamports : "0",
    };
  });

  const partialReasons: string[] = [];
  if (!options.historyComplete) {
    partialReasons.push("Transaction history for the range is incomplete, so balances may have moved in transactions that aren't loaded.");
  }
  if (mismatches.length > 0) {
    partialReasons.push(`${mismatches.length} balance(s) don't chain between consecutive transactions (STATE_MISMATCH).`);
  }
  const confidence: Confidence = partialReasons.length > 0 ? "partial" : "observed";
  const assetIds = [...new Set([...holdings.values()].map((h) => h.assetId))].sort((a, b) =>
    a === NATIVE_SOL ? -1 : b === NATIVE_SOL ? 1 : a.localeCompare(b),
  );
  const stateAt = (index: number): AssetState[] =>
    assetIds.map((assetId) => ({
      assetId,
      amount: sumBy(assetId, (h) => balanceBefore(h, index)).toString(),
      confidence,
    }));

  return {
    wallet,
    effects,
    opening: stateAt(0),
    closing: stateAt(ordered.length),
    openingStatus: confidence === "observed" ? "OBSERVED" : "OPENING_STATE_PARTIAL",
    closingStatus: confidence === "observed" ? "OBSERVED" : "CLOSING_STATE_PARTIAL",
    partialReasons,
    mismatches,
    decimals,
  };
}

/** Closing minus opening per asset, for assets whose balance changed over the range, in opening order. */
export function netChange(state: Pick<WalletState, "opening" | "closing">): { assetId: string; delta: string }[] {
  const opening = new Map(state.opening.map((a) => [a.assetId, BigInt(a.amount)]));
  const ids = [...new Set([...state.opening, ...state.closing].map((a) => a.assetId))];
  const closing = new Map(state.closing.map((a) => [a.assetId, BigInt(a.amount)]));
  return ids
    .map((assetId) => ({ assetId, delta: (closing.get(assetId) ?? 0n) - (opening.get(assetId) ?? 0n) }))
    .filter((c) => c.delta !== 0n)
    .map((c) => ({ assetId: c.assetId, delta: c.delta.toString() }));
}
