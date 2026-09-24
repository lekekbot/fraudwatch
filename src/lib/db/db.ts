import Dexie, { type EntityTable } from "dexie";
import type { CachedCoverage } from "@/lib/cache/coverage";
import type { FraudWatchCase } from "@/lib/case/model";
import type { IngestionCoverage } from "@/lib/ingest/ingest";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import type { RpcSettings } from "@/lib/rpc/settings";
import type { CanonicalTransaction } from "@/lib/solana/canonical";

export const DB_NAME = "fraudwatch";

/** `solana:<signature>`: transaction identity is (chain, signature). */
export type TransactionKey = `solana:${string}`;
export const transactionKey = (signature: string): TransactionKey => `solana:${signature}`;

/** Canonical transaction without `raw`; the raw response lives in `raw_transactions`. */
export type TransactionRecord = Omit<CanonicalTransaction, "raw"> & {
  key: TransactionKey;
  parserVersion: number;
};

export type RawTransactionRecord = { key: TransactionKey; raw: RawParsedTransaction; cachedAt: string };

/** Lightweight per-wallet index; the transaction itself is stored once in `transactions`. */
export type WalletTransactionRecord = { wallet: string; signature: string; blockTime: number };

/** Outcome of the most recent load for a case, so reopening can show its warnings. */
export type IngestionJobRecord = {
  caseId: string;
  range: { start: string; end: string };
  finishedAt: string;
  cancelled: boolean;
  wallets: Array<{ wallet: string; coverage: IngestionCoverage; error?: string }>;
};

/** Version of each derived cache when it was last written; see `derived.ts`. */
export type MetaRecord = { key: string; value: unknown };

/**
 * Local-only persistence.
 *
 * v1 (Sprint 01): cases, rpc_settings.
 * v2 (Sprint 03): transaction cache. Later sprints add wallet_states,
 * token_metadata, protocol_cache, and ui_state in their own version blocks.
 */
export class FraudWatchDB extends Dexie {
  cases!: EntityTable<FraudWatchCase, "id">;
  rpc_settings!: EntityTable<RpcSettings, "id">;
  transactions!: EntityTable<TransactionRecord, "key">;
  raw_transactions!: EntityTable<RawTransactionRecord, "key">;
  wallet_transactions!: Dexie.Table<WalletTransactionRecord, [string, string]>;
  coverage!: EntityTable<CachedCoverage, "wallet">;
  ingestion_jobs!: EntityTable<IngestionJobRecord, "caseId">;
  meta!: EntityTable<MetaRecord, "key">;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      cases: "id, updatedAt, primaryWallet",
      rpc_settings: "id",
    });
    this.version(2).stores({
      transactions: "key, parserVersion",
      raw_transactions: "key",
      wallet_transactions: "[wallet+signature], [wallet+blockTime]",
      coverage: "wallet",
      ingestion_jobs: "caseId",
      meta: "key",
    });
  }
}

let instance: FraudWatchDB | null = null;

export function getDb(): FraudWatchDB {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this environment.");
  }
  instance ??= new FraudWatchDB();
  return instance;
}

/** Forget the shared connection, e.g. after the database was deleted. */
export function resetDbInstance(): void {
  instance?.close();
  instance = null;
}

export function isQuotaError(err: unknown): boolean {
  for (let e = err as { name?: string; inner?: unknown } | undefined; e; e = e.inner as typeof e) {
    if (e.name === "QuotaExceededError") return true;
  }
  return false;
}

export function describeStorageError(err: unknown): string {
  if (isQuotaError(err)) {
    return "This browser's storage for FraudWatch is full. Clear the transaction cache in Storage settings, or free up disk space.";
  }
  return err instanceof Error ? err.message : "Local storage error.";
}
