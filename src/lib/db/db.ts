import Dexie, { type EntityTable } from "dexie";
import type { AssetMetadata } from "@/lib/assets/assets";
import type { CachedCoverage } from "@/lib/cache/coverage";
import type { FraudWatchCase } from "@/lib/case/model";
import type { IngestionCoverage } from "@/lib/ingest/ingest";
import type { AddressLabel } from "@/lib/labels/labels";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import type { RpcSettings } from "@/lib/rpc/settings";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { WalletState } from "@/lib/state/reconstruct";

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

/**
 * A wallet's reconstructed state for one range. Reused only while the
 * reconstruction and parser versions and the exact source transactions match.
 */
export type WalletStateRecord = {
  key: string;
  wallet: string;
  range: { start: string; end: string };
  reconstructionVersion: number;
  parserVersion: number;
  /** Sorted signatures of the transactions the state was built from. */
  sourceSignatures: string[];
  historyComplete: boolean;
  computedAt: string;
  state: WalletState;
};

/** Version of each derived cache when it was last written; see `derived.ts`. */
export type MetaRecord = { key: string; value: unknown };

/**
 * Local-only persistence.
 *
 * v1 (Sprint 01): cases, rpc_settings.
 * v2 (Sprint 03): transaction cache.
 * v3 (Sprint 04): wallet_states, token_metadata.
 * v4 (Sprint 06): address_labels; case labels/tags move out of the case record.
 * Later sprints add ui_state in its own version block.
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
  wallet_states!: EntityTable<WalletStateRecord, "key">;
  token_metadata!: EntityTable<AssetMetadata, "id">;
  address_labels!: Dexie.Table<AddressLabel, [string, string]>;

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
    this.version(3).stores({
      wallet_states: "key, wallet",
      token_metadata: "id",
    });
    this.version(4)
      .stores({ address_labels: "[caseId+address], caseId" })
      .upgrade(async (tx) => {
        // Sprint 01 cases carried `labels`/`tags` maps; move any entries into the new table.
        type V1Case = FraudWatchCase & { labels?: Record<string, string>; tags?: Record<string, string[]> };
        const cases: V1Case[] = await tx.table("cases").toArray();
        const labels = cases.flatMap((c) =>
          [...new Set([...Object.keys(c.labels ?? {}), ...Object.keys(c.tags ?? {})])].map((address) => ({
            caseId: c.id,
            address,
            name: c.labels?.[address] ?? "",
            tags: c.tags?.[address] ?? [],
          })),
        );
        await tx.table("address_labels").bulkPut(labels);
        await tx
          .table("cases")
          .toCollection()
          .modify((c: V1Case) => {
            delete c.labels;
            delete c.tags;
          });
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
