import { type AssetMetadata, builtinAsset, NATIVE_SOL } from "@/lib/assets/assets";
import type { CaseRange } from "@/lib/case/range";
import { type CanonicalTransaction, PARSER_VERSION } from "@/lib/solana/canonical";
import { RECONSTRUCTION_VERSION, reconstructWalletState, type WalletState } from "@/lib/state/reconstruct";
import type { FraudWatchDB, WalletStateRecord } from "./db";
import { ensureDerivedCachesCurrent } from "./derived";

const stateKey = (wallet: string, range: CaseRange) => `${wallet}|${range.start}|${range.end}`;

/**
 * The wallet's reconstructed state, from the cache when it was built by the
 * same code from exactly these transactions, otherwise recomputed and saved.
 */
export async function getWalletState(
  db: FraudWatchDB,
  wallet: string,
  range: CaseRange,
  transactions: CanonicalTransaction[],
  historyComplete: boolean,
  now = new Date(),
): Promise<WalletState> {
  await ensureDerivedCachesCurrent(db);
  const key = stateKey(wallet, range);
  const sourceSignatures = transactions.map((t) => t.signature).sort();
  const cached = await db.wallet_states.get(key);
  if (
    cached &&
    cached.reconstructionVersion === RECONSTRUCTION_VERSION &&
    cached.parserVersion === PARSER_VERSION &&
    cached.historyComplete === historyComplete &&
    cached.sourceSignatures.length === sourceSignatures.length &&
    cached.sourceSignatures.every((s, i) => s === sourceSignatures[i])
  ) {
    return cached.state;
  }

  const state = reconstructWalletState(wallet, transactions, { historyComplete });
  const record: WalletStateRecord = {
    key,
    wallet,
    range,
    reconstructionVersion: RECONSTRUCTION_VERSION,
    parserVersion: PARSER_VERSION,
    sourceSignatures,
    historyComplete,
    computedAt: now.toISOString(),
    state,
  };
  // Best effort: a failed write only means recomputing next time.
  await db.wallet_states.put(record).catch(() => {});
  return state;
}

/** Retry mints that had no metadata after this long; found metadata is kept. */
const MISSING_METADATA_RETRY_MS = 7 * 86_400_000;

/** Cached or built-in metadata per asset id, plus the ids that should be looked up on-chain. */
export async function getAssetMetadata(
  db: FraudWatchDB,
  ids: string[],
  now = new Date(),
): Promise<{ known: Map<string, AssetMetadata>; toFetch: string[] }> {
  const known = new Map<string, AssetMetadata>();
  const toFetch: string[] = [];
  const unique = [...new Set(ids)];
  const cached = await db.token_metadata.bulkGet(unique);
  unique.forEach((id, i) => {
    const builtin = builtinAsset(id);
    if (builtin) return void known.set(id, builtin);
    const record = cached[i];
    if (record) known.set(id, record);
    const stale =
      !record ||
      // Saved before NFT detection (Sprint 07B): refetch once to learn whether it's an NFT.
      record.nft === undefined ||
      (record.source === "none" && now.getTime() - Date.parse(record.fetchedAt ?? "") > MISSING_METADATA_RETRY_MS);
    if (stale && id !== NATIVE_SOL) toFetch.push(id);
  });
  return { known, toFetch };
}

export async function saveAssetMetadata(db: FraudWatchDB, metadata: AssetMetadata[]): Promise<void> {
  await db.token_metadata.bulkPut(metadata);
}
