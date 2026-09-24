import Dexie from "dexie";
import { DB_NAME, type FraudWatchDB, resetDbInstance } from "./db";

export type StorageSummary = {
  cases: number;
  transactions: number;
  walletIndexEntries: number;
  walletsWithCoverage: number;
};

export async function getStorageSummary(db: FraudWatchDB): Promise<StorageSummary> {
  const [cases, transactions, walletIndexEntries, walletsWithCoverage] = await Promise.all([
    db.cases.count(),
    db.raw_transactions.count(),
    db.wallet_transactions.count(),
    db.coverage.count(),
  ]);
  return { cases, transactions, walletIndexEntries, walletsWithCoverage };
}

/** Whole-origin usage and quota from the browser, when it reports them. */
export async function getStorageEstimate(): Promise<{ usageBytes: number; quotaBytes: number } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate().catch(() => null);
  if (estimate?.usage == null || estimate.quota == null) return null;
  return { usageBytes: estimate.usage, quotaBytes: estimate.quota };
}

/** Drop all fetched chain data. Cases, labels, and RPC settings are kept. */
export async function clearTransactionCache(db: FraudWatchDB): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.transactions,
      db.raw_transactions,
      db.wallet_transactions,
      db.coverage,
      db.ingestion_jobs,
      db.wallet_states,
      db.token_metadata,
    ],
    async () => {
      await Promise.all([
        db.wallet_states.clear(),
        db.token_metadata.clear(),
        db.transactions.clear(),
        db.raw_transactions.clear(),
        db.wallet_transactions.clear(),
        db.coverage.clear(),
        db.ingestion_jobs.clear(),
      ]);
    },
  );
}

/** Delete the whole database: cases, cache, and RPC settings. */
export async function clearAllLocalData(db: FraudWatchDB): Promise<void> {
  db.close();
  resetDbInstance();
  await Dexie.delete(db.name ?? DB_NAME);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
