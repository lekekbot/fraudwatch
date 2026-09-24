import type { WalletIngestion } from "./ingest";

/**
 * For each mapped wallet, the other mapped wallets it shares loaded
 * transactions with, and which. Every pair is compared, not just a wallet and
 * the one it was mapped from.
 */
export function sharedTransactions(wallets: Pick<WalletIngestion, "wallet" | "signatures">[]): Map<string, Map<string, string[]>> {
  const owners = new Map<string, string[]>();
  for (const w of wallets) for (const s of w.signatures) owners.set(s, [...(owners.get(s) ?? []), w.wallet]);
  const shared = new Map<string, Map<string, string[]>>(wallets.map((w) => [w.wallet, new Map()]));
  for (const w of wallets) {
    for (const s of w.signatures) {
      for (const other of owners.get(s) ?? []) {
        if (other === w.wallet) continue;
        const byOther = shared.get(w.wallet)!;
        byOther.set(other, [...(byOther.get(other) ?? []), s]);
      }
    }
  }
  return shared;
}

export type MappingSummary = {
  wallet: string;
  inRange: number;
  cached: number;
  fetched: number;
  /** Shared transaction counts with every other mapped wallet, most first. */
  shared: { wallet: string; count: number }[];
  /** Counterparties of this wallet that no mapped wallet had revealed before. They stay observed. */
  newObserved: number;
};

export function mappingSummary(
  w: WalletIngestion,
  shared: Map<string, Map<string, string[]>>,
  counterparties: Iterable<string>,
  alreadyKnown: ReadonlySet<string>,
): MappingSummary {
  const fresh = new Set([...counterparties].filter((a) => !alreadyKnown.has(a)));
  return {
    wallet: w.wallet,
    inRange: w.signatures.length,
    cached: w.stats.cachedTransactions,
    fetched: w.stats.fetchedTransactions,
    shared: [...(shared.get(w.wallet) ?? new Map<string, string[]>())]
      .map(([wallet, signatures]) => ({ wallet, count: signatures.length }))
      .sort((a, b) => b.count - a.count),
    newObserved: fresh.size,
  };
}
