import type { CaseRange } from "@/lib/case/range";
import type { IngestionCache, SignatureEntry } from "@/lib/ingest/ingest";
import { type CanonicalTransaction, canonicalize, PARSER_VERSION } from "@/lib/solana/canonical";
import {
  describeStorageError,
  type FraudWatchDB,
  type TransactionRecord,
  transactionKey,
  type WalletTransactionRecord,
} from "./db";
import { ensureDerivedCachesCurrent } from "./derived";

function toRecord(tx: CanonicalTransaction): TransactionRecord {
  const record: TransactionRecord & { raw?: unknown } = { ...tx, key: transactionKey(tx.signature), parserVersion: PARSER_VERSION };
  delete record.raw;
  return record;
}

/** Cached transactions carry `raw: null`; load the raw response separately when it's needed. */
function fromRecord(record: TransactionRecord): CanonicalTransaction {
  const tx: CanonicalTransaction & { key?: string; parserVersion?: number } = { ...record, raw: null };
  delete tx.key;
  delete tx.parserVersion;
  return tx;
}

/**
 * Cached canonical transactions by signature. Records from an older parser
 * version, or missing parsed records with a stored raw response, are
 * re-derived locally without touching the RPC.
 */
export async function getCachedTransactions(
  db: FraudWatchDB,
  signatures: string[],
): Promise<Map<string, CanonicalTransaction>> {
  await ensureDerivedCachesCurrent(db);
  const keys = signatures.map(transactionKey);
  const records = await db.transactions.bulkGet(keys);
  const found = new Map<string, CanonicalTransaction>();
  const stale: string[] = [];
  records.forEach((record, i) => {
    if (record && record.parserVersion === PARSER_VERSION) found.set(signatures[i], fromRecord(record));
    else stale.push(signatures[i]);
  });

  if (stale.length > 0) {
    const raws = await db.raw_transactions.bulkGet(stale.map(transactionKey));
    const rederived: TransactionRecord[] = [];
    for (const raw of raws) {
      if (!raw) continue;
      const tx = canonicalize(raw.raw);
      found.set(tx.signature, { ...tx, raw: null });
      rederived.push(toRecord(tx));
    }
    // Best effort: a failed write only means re-deriving again next time.
    if (rederived.length > 0) await db.transactions.bulkPut(rederived).catch(() => {});
  }
  return found;
}

export async function getWalletSignatures(db: FraudWatchDB, wallet: string, range: CaseRange): Promise<SignatureEntry[]> {
  const start = Math.floor(Date.parse(range.start) / 1000);
  const end = Math.floor(Date.parse(range.end) / 1000);
  const rows = await db.wallet_transactions
    .where("[wallet+blockTime]")
    .between([wallet, start], [wallet, end], true, false)
    .toArray();
  return rows.map(({ signature, blockTime }) => ({ signature, blockTime }));
}

export function createDbIngestionCache(db: FraudWatchDB, now: () => Date = () => new Date()): IngestionCache {
  return {
    getCoverage: (wallet) => db.coverage.get(wallet),
    putCoverage: async (coverage) => {
      await db.coverage.put(coverage);
    },
    getWalletSignatures: (wallet, range) => getWalletSignatures(db, wallet, range),
    putWalletSignatures: async (wallet, entries) => {
      const rows: WalletTransactionRecord[] = entries.map((e) => ({ wallet, signature: e.signature, blockTime: e.blockTime }));
      await db.wallet_transactions.bulkPut(rows);
    },
    getTransactions: (signatures) => getCachedTransactions(db, signatures),
    putTransactions: async (entries) => {
      const cachedAt = now().toISOString();
      await db.transaction("rw", db.transactions, db.raw_transactions, async () => {
        await db.transactions.bulkPut(entries.map((e) => toRecord(e.tx)));
        await db.raw_transactions.bulkPut(
          entries.map((e) => ({ key: transactionKey(e.tx.signature), raw: e.raw, cachedAt })),
        );
      });
    },
    describeWriteError: describeStorageError,
  };
}

/** The RPC's original response for a transaction, if it's cached. */
export async function getRawTransaction(db: FraudWatchDB, signature: string): Promise<unknown | undefined> {
  return (await db.raw_transactions.get(transactionKey(signature)))?.raw;
}
