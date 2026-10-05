import type { EffectSummary } from "./summarize";

/** One mapped wallet's transactions: their summaries, and the signatures they belong to in the same order. */
export type CounterpartySide = { wallet: string; summaries: readonly EffectSummary[]; signatures: readonly string[] };

/**
 * Every address on the other side of the wallets' transactions (balance
 * counterparties and whoever sent the transaction), with how many
 * transactions each appears in: a transaction two wallets share counts once.
 * Each wallet is left out of its own side. Most frequent first.
 */
export function collectCounterparties(sides: readonly CounterpartySide[]): { address: string; count: number }[] {
  const seen = new Map<string, Set<string>>();
  for (const { wallet, summaries, signatures } of sides) {
    summaries.forEach((s, i) => {
      const inTx = new Set(s.counterparties.map((c) => c.address));
      if (s.actor) inTx.add(s.actor);
      inTx.delete(wallet);
      for (const address of inTx) seen.set(address, (seen.get(address) ?? new Set()).add(signatures[i]));
    });
  }
  return [...seen]
    .map(([address, txs]) => ({ address, count: txs.size }))
    .sort((a, b) => b.count - a.count || a.address.localeCompare(b.address));
}
