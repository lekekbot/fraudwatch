import { missingRanges } from "@/lib/cache/coverage";
import { type CaseRange, sameRange } from "@/lib/case/range";
import type { IngestionResult, WalletIngestion } from "@/lib/ingest/ingest";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { FraudWatchDB, IngestionJobRecord } from "./db";
import { getCachedTransactions, getWalletSignatures } from "./transaction-cache";

export async function saveIngestionJob(
  db: FraudWatchDB,
  caseId: string,
  range: CaseRange,
  result: IngestionResult,
  now = new Date(),
): Promise<void> {
  const job: IngestionJobRecord = {
    caseId,
    range,
    finishedAt: now.toISOString(),
    cancelled: result.cancelled,
    wallets: result.wallets.map(({ wallet, coverage, error }) => ({ wallet, coverage, error })),
  };
  await db.ingestion_jobs.put(job);
}

export type CachedIngestion = { result: IngestionResult; lastLoadedAt: string | null };

/**
 * Rebuild a case's view entirely from the local cache, with no RPC calls.
 * Returns null when nothing has been loaded for any of the wallets yet.
 */
export async function readCachedIngestion(
  db: FraudWatchDB,
  caseId: string,
  wallets: string[],
  range: CaseRange,
): Promise<CachedIngestion | null> {
  const job = await db.ingestion_jobs.get(caseId);
  const lastJob = job && sameRange(job.range, range) ? job : undefined;
  const transactions = new Map<string, CanonicalTransaction>();
  const results: WalletIngestion[] = [];
  let anything = false;

  for (const wallet of wallets) {
    const coverage = await db.coverage.get(wallet);
    const gaps = missingRanges(coverage, range);
    const entries = (await getWalletSignatures(db, wallet, range)).sort((a, b) => b.blockTime - a.blockTime);
    const signatures = entries.map((e) => e.signature);
    const cached = await getCachedTransactions(db, signatures);
    for (const [s, tx] of cached) transactions.set(s, tx);
    if (coverage || entries.length > 0) anything = true;

    const previous = lastJob?.wallets.find((w) => w.wallet === wallet);
    const warnings = gaps.length > 0 ? [...(previous?.coverage.warnings ?? [])] : [];
    if (gaps.length > 0) {
      warnings.unshift(
        coverage
          ? `${gaps.length} part(s) of the range are not cached yet. Load transactions to fill them.`
          : "Not loaded yet.",
      );
    }
    const missingTx = signatures.length - cached.size;
    if (missingTx > 0) warnings.push(`${missingTx} transaction(s) are indexed but not cached; loading will fetch them.`);

    const timestamps = signatures
      .map((s) => cached.get(s)?.timestamp)
      .filter((t): t is string => t != null)
      .sort();
    results.push({
      wallet,
      signatures,
      tokenAccounts: [],
      coverage: {
        complete: gaps.length === 0 && missingTx === 0,
        oldestLoaded: timestamps[0],
        newestLoaded: timestamps[timestamps.length - 1],
        signatureCount: signatures.length,
        transactionCount: cached.size,
        warnings,
      },
      stats: { cachedTransactions: cached.size, fetchedTransactions: 0, rangesFetched: [] },
      error: gaps.length > 0 ? previous?.error : undefined,
    });
  }

  if (!anything) return null;
  return {
    result: { transactions, wallets: results, cancelled: false },
    lastLoadedAt: lastJob?.finishedAt ?? null,
  };
}
