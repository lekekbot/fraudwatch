import type { EffectSummary } from "./summarize";

/**
 * Every address on the other side of a wallet's transactions (balance
 * counterparties and whoever sent the transaction), with how many
 * transactions each appears in. Most frequent first.
 */
export function collectCounterparties(wallet: string, summaries: EffectSummary[]): { address: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of summaries) {
    const inTx = new Set(s.counterparties.map((c) => c.address));
    if (s.actor) inTx.add(s.actor);
    inTx.delete(wallet);
    for (const address of inTx) counts.set(address, (counts.get(address) ?? 0) + 1);
  }
  return [...counts]
    .map(([address, count]) => ({ address, count }))
    .sort((a, b) => b.count - a.count || a.address.localeCompare(b.address));
}
