import { type CachedCoverage, clampToFinalized, missingRanges, recordCoverage } from "@/lib/cache/coverage";
import type { CaseRange } from "@/lib/case/range";
import { type RawParsedTransaction, SIGNATURE_PAGE_LIMIT, type SolanaRpcAdapter } from "@/lib/rpc/generic-adapter";
import { type CanonicalTransaction, canonicalize } from "@/lib/solana/canonical";
import { TOKEN_PROGRAMS } from "@/lib/solana/programs";
import { mapPool } from "./pool";

export type IngestionCoverage = {
  complete: boolean;
  oldestLoaded?: string;
  newestLoaded?: string;
  signatureCount: number;
  transactionCount: number;
  warnings: string[];
};

export type IngestionLimits = {
  /** Most in-range signatures kept per address (wallet or token account). */
  maxSignaturesPerAddress: number;
  /**
   * Most signature pages scanned per address, including pages newer than the
   * range end. Busy addresses can need hundreds of pages to reach the range.
   */
  maxPagesPerAddress: number;
  /** Parallel getTransaction requests. */
  concurrency: number;
};

export const DEFAULT_LIMITS: IngestionLimits = {
  maxSignaturesPerAddress: 5_000,
  maxPagesPerAddress: 25,
  concurrency: 4,
};

export type IngestionPhase = "signatures" | "transactions" | "token_accounts";

export type IngestionProgress = {
  wallet: string;
  walletIndex: number;
  walletCount: number;
  phase: IngestionPhase;
  signaturesFound: number;
  done: number;
  total: number;
};

export type WalletIngestion = {
  wallet: string;
  /** In-range signatures, newest first, deduplicated across wallet and token-account history. */
  signatures: string[];
  /** Token accounts whose history was searched. */
  tokenAccounts: string[];
  coverage: IngestionCoverage;
  stats: IngestionStats;
  /** Set when the wallet's own signature history could not be loaded at all. */
  error?: string;
};

export type IngestionStats = {
  /** Transactions reused instead of fetched: from the local cache, or already loaded for another wallet in this run. */
  cachedTransactions: number;
  fetchedTransactions: number;
  /** Sub-ranges that had to be fetched because the cache didn't cover them. */
  rangesFetched: CaseRange[];
};

export type SignatureEntry = { signature: string; blockTime: number };

/** Local persistence used by ingestion; see `createDbIngestionCache`. */
export type IngestionCache = {
  getCoverage(wallet: string): Promise<CachedCoverage | undefined>;
  putCoverage(coverage: CachedCoverage): Promise<void>;
  getWalletSignatures(wallet: string, range: CaseRange): Promise<SignatureEntry[]>;
  putWalletSignatures(wallet: string, entries: SignatureEntry[]): Promise<void>;
  getTransactions(signatures: string[]): Promise<Map<string, CanonicalTransaction>>;
  putTransactions(entries: Array<{ tx: CanonicalTransaction; raw: RawParsedTransaction }>): Promise<void>;
  describeWriteError(err: unknown): string;
};

export type IngestionResult = {
  /** Canonical transactions keyed by signature; each is stored once however many wallets reference it. */
  transactions: Map<string, CanonicalTransaction>;
  wallets: WalletIngestion[];
  cancelled: boolean;
};

export type IngestOptions = {
  adapter: SolanaRpcAdapter;
  wallets: string[];
  range: CaseRange;
  /** Per-wallet ranges (mapped wallets can start later than the case); `range` otherwise. */
  ranges?: Record<string, CaseRange>;
  signal: AbortSignal;
  limits?: Partial<IngestionLimits>;
  onProgress?: (progress: IngestionProgress) => void;
  /** When set, cached coverage and transactions are reused and new results are saved. */
  cache?: IngestionCache;
  now?: () => Date;
};

class Cancelled extends Error {}

type SignatureScan = {
  entries: Array<{ signature: string; blockTime: number }>;
  /** History exhausted or paged back past range start. */
  reachedStart: boolean;
  limitHit: "signatures" | "pages" | null;
  missingBlockTime: number;
};

/**
 * Page getSignaturesForAddress from newest to oldest, keeping signatures whose
 * blockTime falls in the half-open range [start, end).
 */
async function scanSignatures(
  adapter: SolanaRpcAdapter,
  address: string,
  caseRange: CaseRange,
  limits: IngestionLimits,
  signal: AbortSignal,
  onPage?: (found: number) => void,
): Promise<SignatureScan> {
  const range = { start: Date.parse(caseRange.start) / 1000, end: Date.parse(caseRange.end) / 1000 };
  const scan: SignatureScan = { entries: [], reachedStart: false, limitHit: null, missingBlockTime: 0 };
  let before: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= limits.maxPagesPerAddress) {
      scan.limitHit = "pages";
      return scan;
    }
    const sigs = await adapter.getSignaturesForAddress(address, { before }, signal);
    for (const s of sigs) {
      if (s.blockTime == null) {
        scan.missingBlockTime++;
        continue;
      }
      if (s.blockTime >= range.end) continue;
      if (s.blockTime < range.start) {
        scan.reachedStart = true;
        continue;
      }
      if (scan.entries.length >= limits.maxSignaturesPerAddress) {
        scan.limitHit = "signatures";
        return scan;
      }
      scan.entries.push({ signature: s.signature, blockTime: s.blockTime });
    }
    onPage?.(scan.entries.length);
    if (scan.reachedStart || sigs.length < SIGNATURE_PAGE_LIMIT) {
      scan.reachedStart = true;
      return scan;
    }
    before = sigs[sigs.length - 1].signature;
  }
}

function describeLimit(what: string, scan: SignatureScan, limits: IngestionLimits): string | null {
  if (scan.limitHit === "signatures") {
    return `${what}: stopped at the safety limit of ${limits.maxSignaturesPerAddress.toLocaleString()} signatures; older activity in the range was not loaded.`;
  }
  if (scan.limitHit === "pages") {
    return `${what}: stopped after scanning ${(limits.maxPagesPerAddress * SIGNATURE_PAGE_LIMIT).toLocaleString()} signatures without reaching the range start. The address is too busy to page through; try a more recent range.`;
  }
  return null;
}

/**
 * Load bounded history for each wallet through standard RPC:
 *
 *   wallet signatures → transactions → owned token accounts → their signatures → missing transactions
 *
 * Token-account history catches transfers that reference only a wallet's token
 * account (common in v0 and relayed transactions), which getSignaturesForAddress
 * on the wallet itself does not return.
 *
 * With a cache, only the parts of the range not already covered are fetched, and
 * cached transactions are never requested again.
 *
 * Cancelling via `signal` stops work and returns what was loaded, marked incomplete.
 */
export async function ingestWallets(options: IngestOptions): Promise<IngestionResult> {
  const { adapter, wallets, signal, onProgress, cache } = options;
  const limits: IngestionLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const startedAt = (options.now ?? (() => new Date()))();
  const transactions = new Map<string, CanonicalTransaction>();
  // Signatures the RPC returned null for (pruned history) vs. requests that failed.
  const unavailable = new Set<string>();
  const failed = new Map<string, string>();
  const results: WalletIngestion[] = [];
  let cancelled = false;
  let cacheWriteError: string | null = null;

  const guard = async <T>(work: Promise<T>): Promise<T> => {
    try {
      return await work;
    } catch (err) {
      if (signal.aborted) throw new Cancelled();
      throw err;
    }
  };

  /** Cache writes never fail ingestion; the first failure disables further writes. */
  const write = async (work: (c: IngestionCache) => Promise<void>) => {
    if (!cache || cacheWriteError) return;
    try {
      await work(cache);
    } catch (err) {
      cacheWriteError = cache.describeWriteError(err);
    }
  };

  for (const [walletIndex, wallet] of wallets.entries()) {
    const range = options.ranges?.[wallet] ?? options.range;
    const signatures = new Map<string, number>();
    const newEntries: SignatureEntry[] = [];
    const tokenAccounts: string[] = [];
    const warnings: string[] = [];
    const stats: IngestionStats = { cachedTransactions: 0, fetchedTransactions: 0, rangesFetched: [] };
    let complete = true;
    let error: string | undefined;
    const progress = (phase: IngestionPhase, done: number, total: number, found = signatures.size) =>
      onProgress?.({ wallet, walletIndex, walletCount: wallets.length, phase, signaturesFound: found, done, total });

    const addScan = (scan: SignatureScan, what: string) => {
      for (const e of scan.entries) {
        if (!signatures.has(e.signature)) newEntries.push(e);
        signatures.set(e.signature, e.blockTime);
      }
      const limit = describeLimit(what, scan, limits);
      if (limit) {
        complete = false;
        warnings.push(limit);
      }
      if (scan.missingBlockTime > 0) {
        complete = false;
        warnings.push(`${what}: ${scan.missingBlockTime} signature(s) had no block time and could not be placed in the range.`);
      }
    };

    const fetchMissing = async () => {
      let missing = [...signatures.keys()].filter((s) => !transactions.has(s) && !unavailable.has(s) && !failed.has(s));
      if (cache && missing.length > 0) {
        const cached = await guard(cache.getTransactions(missing));
        for (const [s, tx] of cached) transactions.set(s, tx);
        missing = missing.filter((s) => !cached.has(s));
      }
      let done = 0;
      const toSave: Array<{ tx: CanonicalTransaction; raw: RawParsedTransaction }> = [];
      progress("transactions", done, missing.length);
      try {
        await mapPool(missing, limits.concurrency, async (signature) => {
          try {
            const raw = await adapter.getTransaction(signature, signal);
            if (raw) {
              const tx = canonicalize(raw);
              transactions.set(signature, tx);
              toSave.push({ tx, raw });
              stats.fetchedTransactions++;
            } else unavailable.add(signature);
          } catch (err) {
            if (signal.aborted) throw err;
            failed.set(signature, (err as Error).message);
          }
          progress("transactions", ++done, missing.length);
        });
      } finally {
        // Keep whatever arrived, even if cancelled part-way.
        if (toSave.length > 0) await write((c) => c.putTransactions(toSave));
      }
    };

    let gaps: CaseRange[] = [range];
    try {
      if (signal.aborted) throw new Cancelled();

      if (cache) {
        gaps = missingRanges(await guard(cache.getCoverage(wallet)), range);
        for (const e of await guard(cache.getWalletSignatures(wallet, range))) signatures.set(e.signature, e.blockTime);
      }
      stats.rangesFetched = gaps;

      if (gaps.length > 0) {
        progress("signatures", 0, 0);
        try {
          for (const gap of gaps) {
            const base = signatures.size;
            const scan = await guard(
              scanSignatures(adapter, wallet, gap, limits, signal, (found) => progress("signatures", 0, 0, base + found)),
            );
            addScan(scan, "Wallet history");
          }
        } catch (err) {
          if (err instanceof Cancelled) throw err;
          error = `Could not load wallet history: ${(err as Error).message}`;
          throw err;
        }
        progress("signatures", 0, 0);
      }

      await guard(fetchMissing());

      if (gaps.length > 0) {
        // Currently owned token accounts, plus any this wallet owned in the loaded
        // transactions (covers accounts closed since).
        const owned = new Set<string>();
        for (const programId of TOKEN_PROGRAMS) {
          try {
            for (const ta of await guard(adapter.getTokenAccountsByOwner(wallet, programId, signal))) owned.add(ta.address);
          } catch (err) {
            if (err instanceof Cancelled) throw err;
            complete = false;
            warnings.push(`Could not list token accounts for ${programId}: ${(err as Error).message}`);
          }
        }
        for (const signature of signatures.keys()) {
          for (const change of transactions.get(signature)?.tokenChanges ?? []) {
            if (change.owner === wallet) owned.add(change.account);
          }
        }

        tokenAccounts.push(...owned);
        progress("token_accounts", 0, tokenAccounts.length);
        for (const [i, account] of tokenAccounts.entries()) {
          try {
            for (const gap of gaps) {
              addScan(await guard(scanSignatures(adapter, account, gap, limits, signal)), `Token account ${account}`);
            }
          } catch (err) {
            if (err instanceof Cancelled) throw err;
            complete = false;
            warnings.push(`Token account ${account}: history unavailable (${(err as Error).message}).`);
          }
          progress("token_accounts", i + 1, tokenAccounts.length);
        }

        await guard(fetchMissing());
      }
    } catch (err) {
      complete = false;
      if (err instanceof Cancelled) {
        cancelled = true;
        warnings.push("Cancelled before this wallet finished loading.");
      } else if (!error) {
        error = `Loading stopped: ${(err as Error).message}`;
      }
    }

    const pruned = [...signatures.keys()].filter((s) => unavailable.has(s)).length;
    if (pruned > 0) {
      complete = false;
      warnings.push(`${pruned} transaction(s) were not returned by the RPC; it may not keep full history.`);
    }
    const errored = [...signatures.keys()].filter((s) => failed.has(s));
    if (errored.length > 0) {
      complete = false;
      warnings.push(`${errored.length} transaction request(s) failed (${failed.get(errored[0])}).`);
    }

    if (cache) {
      if (newEntries.length > 0) await write((c) => c.putWalletSignatures(wallet, newEntries));
      if (gaps.length > 0) {
        await write(async (c) => {
          let coverage = await c.getCoverage(wallet);
          for (const gap of gaps) {
            const finalized = clampToFinalized(gap, startedAt);
            if (finalized) coverage = recordCoverage(coverage, wallet, finalized, complete, startedAt);
          }
          if (coverage) await c.putCoverage(coverage);
        });
      }
    }

    const ordered = [...signatures].sort(([, a], [, b]) => b - a).map(([s]) => s);
    // Everything this wallet has that wasn't fetched for it: from the local cache, or already loaded for another wallet.
    stats.cachedTransactions = ordered.filter((s) => transactions.has(s)).length - stats.fetchedTransactions;
    const timestamps = ordered
      .map((s) => transactions.get(s)?.timestamp)
      .filter((t): t is string => t != null)
      .sort();
    results.push({
      wallet,
      signatures: ordered,
      tokenAccounts,
      coverage: {
        complete,
        oldestLoaded: timestamps[0],
        newestLoaded: timestamps[timestamps.length - 1],
        signatureCount: ordered.length,
        transactionCount: ordered.filter((s) => transactions.has(s)).length,
        warnings,
      },
      stats,
      error,
    });

    if (cancelled) break;
  }

  if (cacheWriteError) {
    for (const w of results) w.coverage.warnings.push(`Results were not fully saved locally: ${cacheWriteError}`);
  }

  return { transactions, wallets: results, cancelled };
}
