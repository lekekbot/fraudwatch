import { isValidSolanaAddress } from "@/lib/solana/address";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import { compareTransactions } from "@/lib/state/reconstruct";
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
  let first: CanonicalTransaction | null = null;
  for (const tx of transactions) {
    // Ties go to chain order, so the answer doesn't depend on the order transactions were loaded in.
    if (!tx.timestamp || (first && (tx.timestamp > first.timestamp! || (tx.timestamp === first.timestamp && compareTransactions(tx, first) >= 0)))) continue;
    const involved =
      tx.accounts.some((a) => a.address === address) || tx.tokenChanges.some((t) => t.owner === address);
    if (involved) first = tx;
  }
  return first && { timestamp: first.timestamp!, signature: first.signature };
}

export type MapWalletInput = {
  address: string;
  rangeMode: MappedWalletConfig["rangeMode"];
  /** Required for first_interaction and custom. */
  start?: string;
  addedFromWallet?: string;
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
    rangeMode: input.rangeMode,
    ...(customStart ? { customStart } : {}),
    ...(input.addedFromWallet ? { addedFromWallet: input.addedFromWallet } : {}),
  };
  return { ...c, mappedWallets: [...c.mappedWallets, added], updatedAt: now.toISOString() };
}

/** Removes a mapped wallet. Labels and cached chain data are untouched; the primary wallet can't be removed. */
export function unmapWallet(c: FraudWatchCase, address: string, now = new Date()): FraudWatchCase {
  const target = c.mappedWallets.find((w) => w.address === address);
  if (!target) throw new MappingError("This wallet isn't mapped.");
  if (address === c.primaryWallet) throw new MappingError("The primary wallet can't be removed from the case.");
  return { ...c, mappedWallets: c.mappedWallets.filter((w) => w.address !== address), updatedAt: now.toISOString() };
}

/**
 * Why an address can't be added as a wallet, or null if it can: it must be a
 * valid Solana address, not already mapped, and not a program or protocol
 * address (`isInfrastructure`).
 */
export function newWalletProblem(
  input: string,
  c: Pick<FraudWatchCase, "mappedWallets">,
  isInfrastructure: (address: string) => boolean,
): string | null {
  const address = input.trim();
  if (!address) return "Paste a wallet address.";
  if (!isValidSolanaAddress(address)) return "Not a valid Solana address.";
  if (c.mappedWallets.some((w) => w.address === address)) return "This wallet is already mapped.";
  if (isInfrastructure(address)) return "That's a program or protocol address, not a wallet.";
  return null;
}

/** Pauses or resumes RPC loading for a mapped wallet (never the primary); its cached history stays. */
export function toggleWalletPaused(c: FraudWatchCase, address: string, now = new Date()): FraudWatchCase {
  if (address === c.primaryWallet) return c;
  return {
    ...c,
    mappedWallets: c.mappedWallets.map((w) => (w.address === address ? { ...w, paused: !w.paused } : w)),
    updatedAt: now.toISOString(),
  };
}
