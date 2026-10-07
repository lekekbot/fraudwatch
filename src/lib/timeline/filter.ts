import type { EventCategory, SemanticEvent } from "@/lib/semantic/events";
import { abs } from "@/lib/solana/amount";
import type { EffectKind, EffectSummary } from "@/lib/state/summarize";

/**
 * What to leave off the map. Filtering only hides transactions from view;
 * wallet state, coverage and mismatch checks always use the full history.
 * Lasting hides ("Hide from map", hide rules) live on the case, not here.
 */
export type TxFilter = {
  /** Semantic event categories to leave out (see `SemanticEvent.category`). */
  hiddenCategories: ReadonlySet<EventCategory>;
  /** Leave out events FraudWatch reads with low confidence. */
  hideLowConfidence: boolean;
  hiddenKinds: ReadonlySet<EffectKind>;
  /** A transaction is hidden only when every asset it moves is hidden. */
  hiddenAssets: ReadonlySet<string>;
  /** in: value came into the wallet; out: value left it (a swap is both). */
  direction: "any" | "in" | "out";
  /** Only transactions moving at least this much of one asset (base units). */
  minAmount: { assetId: string; amount: string } | null;
  /** Only transactions using one of these protocols (registry ids); empty = any. */
  protocols: ReadonlySet<string>;
  /** Only transactions involving this address. */
  address: string | null;
  /** Only transactions involving an address tagged with one of these; empty = any. */
  tags: ReadonlySet<string>;
  /** Only transactions in [start, end) (ms). */
  dateRange: { start: number; end: number } | null;
  /** Leave out transactions involving a likely address-poisoning decoy (dust look-alike). */
  hideDecoys: boolean;
  /** Only the transactions behind one graph relationship, named for the filter chip. */
  relationship: { label: string; signatures: ReadonlySet<string> } | null;
};

export const EMPTY_FILTER: TxFilter = {
  hiddenCategories: new Set(),
  hideLowConfidence: false,
  hiddenKinds: new Set(),
  hiddenAssets: new Set(),
  direction: "any",
  minAmount: null,
  protocols: new Set(),
  address: null,
  tags: new Set(),
  dateRange: null,
  hideDecoys: false,
  relationship: null,
};

export const isFilterActive = (f: TxFilter) =>
  f.hiddenCategories.size + f.hiddenKinds.size + f.hiddenAssets.size + f.protocols.size + f.tags.size > 0 ||
  f.hideLowConfidence ||
  f.direction !== "any" ||
  f.minAmount !== null ||
  f.hideDecoys ||
  f.address !== null ||
  f.relationship !== null ||
  f.dateRange !== null;

/**
 * What filters look at for one wallet's side of a transaction. Built once per
 * transaction, so filtering is plain comparisons.
 */
export type FilterableTx = {
  signature: string;
  /** ms. */
  time: number;
  summary: EffectSummary;
  /** The transaction's semantic event; null only if it couldn't be interpreted. */
  event: SemanticEvent | null;
  /** Non-core protocols the transaction used (registry ids). */
  protocols: readonly string[];
  /** Everyone on the other side: counterparties, sender, NFT party. */
  addresses: readonly string[];
};

/** Addresses on the other side of a transaction, each once. */
export function involvedAddresses(summary: EffectSummary): string[] {
  return [
    ...new Set([...summary.counterparties.map((c) => c.address), ...(summary.actor ? [summary.actor] : []), ...(summary.nft?.party ? [summary.nft.party] : [])]),
  ];
}

/** Assets the transaction moved for the wallet, fee excluded, each once. */
export function movedAssets(summary: EffectSummary): string[] {
  return [...new Set([...summary.outflows, ...summary.inflows].map((c) => c.assetId))];
}

/** `isDecoy` says whether an address is a likely dust decoy; only consulted when `hideDecoys` is on. */
export function passesFilter(
  tx: FilterableTx,
  f: TxFilter,
  tagsOf: (address: string) => readonly string[] = () => [],
  isDecoy: (address: string) => boolean = () => false,
): boolean {
  const { summary, event } = tx;
  if (event && f.hiddenCategories.has(event.category)) return false;
  if (f.hideLowConfidence && event?.confidence === "LOW") return false;
  if (f.hiddenKinds.has(summary.kind)) return false;
  const moved = movedAssets(summary);
  if (moved.length > 0 && moved.every((a) => f.hiddenAssets.has(a))) return false;
  if (f.direction === "in" && summary.inflows.length === 0) return false;
  if (f.direction === "out" && summary.outflows.length === 0) return false;
  if (f.minAmount) {
    const { assetId, amount } = f.minAmount;
    const floor = BigInt(amount);
    if (![...summary.inflows, ...summary.outflows].some((c) => c.assetId === assetId && abs(BigInt(c.delta)) >= floor)) return false;
  }
  if (f.protocols.size > 0 && !tx.protocols.some((p) => f.protocols.has(p))) return false;
  if (f.address !== null && !tx.addresses.includes(f.address)) return false;
  if (f.tags.size > 0 && !tx.addresses.some((a) => tagsOf(a).some((t) => f.tags.has(t)))) return false;
  if (f.dateRange && (tx.time < f.dateRange.start || tx.time >= f.dateRange.end)) return false;
  if (f.hideDecoys && tx.addresses.some(isDecoy)) return false;
  if (f.relationship && !f.relationship.signatures.has(tx.signature)) return false;
  return true;
}

/** Returns a copy of `set` with `value` added or removed. */
export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}
