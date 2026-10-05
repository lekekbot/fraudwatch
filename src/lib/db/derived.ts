import { PARSER_VERSION } from "@/lib/solana/canonical";
import { RECONSTRUCTION_VERSION } from "@/lib/state/reconstruct";
import type { FraudWatchDB } from "./db";

/**
 * Caches computed from immutable chain data. Each has a version; when the code's
 * version differs from the one recorded in `meta`, the cache is cleared and
 * rebuilt on demand. Raw transactions are never in this list.
 *
 * Protocol annotations keyed to the registry version register here in Sprint 06.
 * Semantic events (`SEMANTIC_VERSION` plus each interpreter's version) are computed on read and not stored; a
 * table for them registers here with that version.
 */
export type DerivedCache = {
  name: string;
  version: number | string;
  clear: (db: FraudWatchDB) => Promise<void>;
};

export const DERIVED_CACHES: DerivedCache[] = [
  // Parsed transactions are re-derived from raw_transactions, so no refetch is needed.
  { name: "parser", version: PARSER_VERSION, clear: (db) => db.transactions.clear() },
  { name: "reconstruction", version: RECONSTRUCTION_VERSION, clear: (db) => db.wallet_states.clear() },
];

const metaKey = (name: string) => `derived:${name}`;

/** Clear every derived cache whose recorded version is stale. Returns the names cleared. */
export async function invalidateStaleDerivedCaches(
  db: FraudWatchDB,
  caches: DerivedCache[] = DERIVED_CACHES,
): Promise<string[]> {
  const cleared: string[] = [];
  for (const cache of caches) {
    const recorded = await db.meta.get(metaKey(cache.name));
    if (recorded?.value === cache.version) continue;
    if (recorded !== undefined) {
      await cache.clear(db);
      cleared.push(cache.name);
    }
    await db.meta.put({ key: metaKey(cache.name), value: cache.version });
  }
  return cleared;
}

const checked = new WeakMap<FraudWatchDB, Promise<string[]>>();

/** `invalidateStaleDerivedCaches`, run once per database connection. */
export function ensureDerivedCachesCurrent(db: FraudWatchDB): Promise<string[]> {
  let pending = checked.get(db);
  if (!pending) {
    pending = invalidateStaleDerivedCaches(db);
    pending.catch(() => checked.delete(db));
    checked.set(db, pending);
  }
  return pending;
}
