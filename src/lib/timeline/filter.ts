import type { EffectKind, EffectSummary } from "@/lib/state/summarize";

/**
 * What to leave off the map. Filtering only hides transactions from view;
 * wallet state, coverage and mismatch checks always use the full history.
 */
export type TxFilter = {
  hiddenKinds: ReadonlySet<EffectKind>;
  /** A transaction is hidden only when every asset it moves is hidden. */
  hiddenAssets: ReadonlySet<string>;
  /** Individually hidden transactions. */
  hiddenSignatures: ReadonlySet<string>;
};

export const EMPTY_FILTER: TxFilter = { hiddenKinds: new Set(), hiddenAssets: new Set(), hiddenSignatures: new Set() };

export const isFilterActive = (f: TxFilter) => f.hiddenKinds.size + f.hiddenAssets.size + f.hiddenSignatures.size > 0;

/** Assets the transaction moved for the wallet, fee excluded, each once. */
export function movedAssets(summary: EffectSummary): string[] {
  return [...new Set([...summary.outflows, ...summary.inflows].map((c) => c.assetId))];
}

export function passesFilter(signature: string, summary: EffectSummary, f: TxFilter): boolean {
  if (f.hiddenSignatures.has(signature) || f.hiddenKinds.has(summary.kind)) return false;
  const moved = movedAssets(summary);
  return moved.length === 0 || moved.some((a) => !f.hiddenAssets.has(a));
}

/** Returns a copy of `set` with `value` added or removed. */
export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}
