import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { FraudWatchCase, MappedWalletConfig } from "./model";
import type { CaseRange } from "./range";

/**
 * The range a mapped wallet's history is loaded for. `case` uses the case
 * range; `first_interaction` and `custom` start at `customStart` (for
 * first_interaction, the time of that interaction, resolved when mapped).
 * Every wallet ends at the case end.
 */
export function walletRange(c: Pick<FraudWatchCase, "range">, w: MappedWalletConfig): CaseRange {
  if (w.rangeMode === "case" || !w.customStart) return c.range;
  return { start: w.customStart, end: c.range.end };
}

export function walletRanges(c: Pick<FraudWatchCase, "range" | "mappedWallets">): Record<string, CaseRange> {
  return Object.fromEntries(c.mappedWallets.map((w) => [w.address, walletRange(c, w)]));
}

/**
 * Earliest loaded transaction that involves `address` in any role (signer,
 * counterparty, token owner or plain account): where it first met the mapped
 * wallets.
 */
export function firstInteraction(
  address: string,
  transactions: Iterable<CanonicalTransaction>,
): { timestamp: string; signature: string } | null {
  let first: { timestamp: string; signature: string } | null = null;
  for (const tx of transactions) {
    if (!tx.timestamp || (first && tx.timestamp >= first.timestamp)) continue;
    const involved =
      tx.accounts.some((a) => a.address === address) || tx.tokenChanges.some((t) => t.owner === address);
    if (involved) first = { timestamp: tx.timestamp, signature: tx.signature };
  }
  return first;
}

export type MapWalletInput = {
  address: string;
  rangeMode: MappedWalletConfig["rangeMode"];
  /** Required for first_interaction and custom. */
  start?: string;
  addedFromWallet?: string;
  addedFromTransaction?: string;
};

export class MappingError extends Error {}

/** Adds a mapped wallet. Only the given address is added: nothing expands recursively. */
export function mapWallet(c: FraudWatchCase, input: MapWalletInput, now = new Date()): FraudWatchCase {
  if (c.mappedWallets.some((w) => w.address === input.address)) throw new MappingError("This wallet is already mapped.");
  let customStart: string | undefined;
  if (input.rangeMode !== "case") {
    if (!input.start || Number.isNaN(Date.parse(input.start))) throw new MappingError("Choose a start for this wallet's history.");
    const start = Date.parse(input.start);
    if (start >= Date.parse(c.range.end)) throw new MappingError("The start must be before the case end.");
    // Never load before the case itself starts.
    customStart = new Date(Math.max(start, Date.parse(c.range.start))).toISOString();
  }
  const added: MappedWalletConfig = {
    address: input.address,
    role: "mapped",
    rangeMode: input.rangeMode,
    ...(customStart ? { customStart } : {}),
    ...(input.addedFromWallet ? { addedFromWallet: input.addedFromWallet } : {}),
    ...(input.addedFromTransaction ? { addedFromTransaction: input.addedFromTransaction } : {}),
  };
  return { ...c, mappedWallets: [...c.mappedWallets, added], updatedAt: now.toISOString() };
}

/** Removes a mapped wallet. Labels and cached chain data are untouched; the primary wallet can't be removed. */
export function unmapWallet(c: FraudWatchCase, address: string, now = new Date()): FraudWatchCase {
  const target = c.mappedWallets.find((w) => w.address === address);
  if (!target) throw new MappingError("This wallet isn't mapped.");
  if (target.role === "primary") throw new MappingError("The primary wallet can't be removed from the case.");
  return { ...c, mappedWallets: c.mappedWallets.filter((w) => w.address !== address), updatedAt: now.toISOString() };
}
