import { type CachedCoverage, clampToFinalized, missingRanges, recordCoverage } from "@/lib/cache/coverage";
import type { CaseRange } from "@/lib/case/range";
import { type RawParsedTransaction, SIGNATURE_PAGE_LIMIT, type SolanaRpcAdapter } from "@/lib/rpc/generic-adapter";
import { type CanonicalTransaction, canonicalize } from "@/lib/solana/canonical";
import { TOKEN_PROGRAMS } from "@/lib/solana/programs";
import { compareTransactions } from "@/lib/state/reconstruct";
import { createWorkQueue, mapPool } from "./pool";

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
  /**
   * Most getTransaction requests in flight at once. Retries keep their slot, so
   * rate limiting slows the pool down rather than adding requests.
   */
  concurrency: number;
  /** Token accounts whose signature history is paged at once, alongside transaction fetches. */
  accountScanConcurrency: number;
};

export const DEFAULT_LIMITS: IngestionLimits = {
  maxSignaturesPerAddress: 5_000,
  maxPagesPerAddress: 25,
  concurrency: 8,
  accountScanConcurrency: 2,
};

/** Fetched transactions are saved locally in batches of this size as they arrive. */
const CACHE_WRITE_BATCH = 250;

const DEV = process.env.NODE_ENV === "development";

// Helius's token-account history index starts in December 2022; older ranges retain the standard RPC scan.
const INDEXED_TOKEN_HISTORY_START = Date.parse("2022-12-01T00:00:00.000Z") / 1000;

/**
 * What signature discovery is doing. Transactions are fetched alongside it as
 * signatures are found; "transactions" means discovery is done and fetches are finishing.
 */
export type IngestionPhase = "signatures" | "transactions" | "token_accounts";

export type IngestionProgress = {
  wallet: string;
  walletIndex: number;
  walletCount: number;
  phase: IngestionPhase;
  signaturesFound: number;
  /** Token accounts searched, of those found. */
  tokenAccountsDone: number;
  tokenAccountsTotal: number;
  /** This wallet's transactions. `loaded` includes cached, unavailable, and failed ones: everything settled. */
  transactions: { loaded: number; loading: number; queued: number; failed: number };
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
  /** Wallets that must not touch the RPC: only their cached history is returned. */
  cacheOnly?: ReadonlySet<string>;
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

type IndexedHistoryScan = {
  entries: Array<{ signature: string; blockTime: number; tx: CanonicalTransaction; raw: RawParsedTransaction }>;
  limitHit: "signatures" | "pages" | null;
  missingBlockTime: number;
};

async function scanIndexedHistory(
  fetchPage: (paginationToken?: string) => Promise<{ data: RawParsedTransaction[]; paginationToken?: string | null }>,
  limits: IngestionLimits,
  onPage?: (found: number) => void,
): Promise<IndexedHistoryScan> {
  const scan: IndexedHistoryScan = { entries: [], limitHit: null, missingBlockTime: 0 };
  let paginationToken: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= limits.maxPagesPerAddress) {
      scan.limitHit = "pages";
      return scan;
    }
    const result = await fetchPage(paginationToken);
    for (const raw of result.data) {
      if (raw.blockTime == null) {
        scan.missingBlockTime++;
        continue;
      }
      if (scan.entries.length >= limits.maxSignaturesPerAddress) {
        scan.limitHit = "signatures";
        return scan;
      }
      const tx = canonicalize(raw);
      scan.entries.push({ signature: tx.signature, blockTime: raw.blockTime, tx, raw });
    }
    onPage?.(scan.entries.length);
    if (!result.paginationToken) return scan;
    paginationToken = result.paginationToken;
  }
}

function splitForIndexedHistory(ranges: CaseRange[]): { indexed: CaseRange[]; standard: CaseRange[] } {
  const indexed: CaseRange[] = [];
  const standard: CaseRange[] = [];
  for (const range of ranges) {
    const start = Date.parse(range.start) / 1000;
    const end = Date.parse(range.end) / 1000;
    if (start < INDEXED_TOKEN_HISTORY_START) {
      standard.push({ ...range, end: new Date(Math.min(end, INDEXED_TOKEN_HISTORY_START) * 1000).toISOString() });
    }
    if (end > INDEXED_TOKEN_HISTORY_START) {
      indexed.push({ ...range, start: new Date(Math.max(start, INDEXED_TOKEN_HISTORY_START) * 1000).toISOString() });
    }
  }
  return { indexed, standard };
}

/**
 * Page getSignaturesForAddress from newest to oldest, keeping signatures whose
 * blockTime falls in the half-open range [start, end). Each page's kept
 * signatures are handed to `onPage` before the next page is requested.
 */
async function scanSignatures(
  adapter: SolanaRpcAdapter,
  address: string,
  caseRange: CaseRange,
  limits: IngestionLimits,
  signal: AbortSignal,
  onPage: (entries: SignatureEntry[]) => Promise<void>,
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
    const kept = scan.entries.length;
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
        break;
      }
      scan.entries.push({ signature: s.signature, blockTime: s.blockTime });
    }
    await onPage(scan.entries.slice(kept));
    if (scan.limitHit) return scan;
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
 * Discovery and transaction fetching overlap: each signature page is queued
 * for a bounded worker pool (`limits.concurrency`) as soon as it arrives, and
 * the next page is requested while those transactions load. A signature is
 * requested at most once per run, and a failed request is recorded without
 * stopping the rest.
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
  /** Every signature looked up in this run (cache or RPC), so none is requested twice. */
  const requested = new Set<string>();
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

  /**
   * Tie-break for signatures sharing a block time, independent of the order
   * fetches finished in: chain order (newest first) when both are loaded, loaded before not, then by signature.
   */
  const newestFirst = (a: string, b: string) => {
    const ta = transactions.get(a);
    const tb = transactions.get(b);
    if (ta && tb) return compareTransactions(tb, ta);
    if (ta || tb) return ta ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
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
    let phase: IngestionPhase = "signatures";
    const paused = options.cacheOnly?.has(wallet) ?? false;
    /** Cached signatures of a paused wallet whose transaction isn't cached: left unloaded rather than fetched. */
    let skippedWhilePaused = 0;
    /** This wallet's signatures whose transaction has settled: loaded, cached, unavailable, or failed. */
    let settled = 0;
    let failedHere = 0;
    let accountsDone = 0;
    const walletStartedAt = performance.now();
    let discoveryMs = 0;
    let fetchMs = 0;

    let toSave: Array<{ tx: CanonicalTransaction; raw: RawParsedTransaction }> = [];
    const saves: Promise<void>[] = [];
    const flush = () => {
      if (toSave.length === 0) return;
      const batch = toSave;
      toSave = [];
      saves.push(write((c) => c.putTransactions(batch)));
    };

    const queue = createWorkQueue<string>(limits.concurrency, async (signature) => {
      const t0 = performance.now();
      try {
        const raw = await adapter.getTransaction(signature, signal);
        if (raw) {
          const tx = canonicalize(raw);
          transactions.set(signature, tx);
          toSave.push({ tx, raw });
          stats.fetchedTransactions++;
          if (toSave.length >= CACHE_WRITE_BATCH) flush();
        } else unavailable.add(signature);
      } catch (err) {
        if (signal.aborted) throw err;
        // A failed request or unparseable response costs only this transaction.
        failed.set(signature, (err as Error).message);
        failedHere++;
      }
      fetchMs += performance.now() - t0;
      settled++;
      report();
    });

    // `extra` counts indexed-history transactions loaded but not yet recorded.
    const report = (extra = 0) =>
      onProgress?.({
        wallet,
        walletIndex,
        walletCount: wallets.length,
        phase,
        signaturesFound: signatures.size + extra,
        tokenAccountsDone: accountsDone,
        tokenAccountsTotal: tokenAccounts.length,
        transactions: { loaded: settled + extra, loading: queue.active, queued: queue.pending, failed: failedHere },
      });

    /** Add entries to this wallet's signatures, returning those it didn't have. */
    const record = (entries: SignatureEntry[]): string[] => {
      const added: string[] = [];
      for (const e of entries) {
        if (signatures.has(e.signature)) continue;
        signatures.set(e.signature, e.blockTime);
        newEntries.push(e);
        added.push(e.signature);
      }
      return added;
    };

    /** Start loading transactions for signatures new to this wallet: from the cache when there, otherwise queued for the RPC. */
    const hydrate = async (added: string[]) => {
      let missing: string[] = [];
      for (const s of added) {
        // Requested earlier in this run (for another wallet, or via indexed history), so already settled.
        if (requested.has(s)) settled++;
        else {
          requested.add(s);
          missing.push(s);
        }
      }
      if (cache && missing.length > 0) {
        try {
          const cached = await guard(cache.getTransactions(missing));
          for (const [s, tx] of cached) transactions.set(s, tx);
          settled += cached.size;
          missing = missing.filter((s) => !cached.has(s));
        } catch (err) {
          // An unreadable cache only costs refetching; everything marked requested must still be queued.
          if (err instanceof Cancelled) throw err;
        }
      }
      // A paused wallet never asks the RPC, even for transactions its cached signatures point to.
      if (paused) {
        skippedWhilePaused += missing.length;
        settled += missing.length;
      } else queue.push(missing);
      report();
    };

    const addScan = (scan: SignatureScan, what: string) => {
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

    let gaps: CaseRange[] = [range];
    try {
      if (signal.aborted) throw new Cancelled();

      const known: string[] = [];
      if (paused && !cache) {
        gaps = [];
        complete = false;
        warnings.push("Paused: only cached history is shown; nothing was loaded from the RPC.");
      }
      if (cache) {
        const uncovered = missingRanges(await guard(cache.getCoverage(wallet)), range);
        // A paused wallet fetches nothing: whatever the cache lacks stays missing, and says so.
        if (paused && uncovered.length > 0) {
          complete = false;
          warnings.push("Paused: only cached history is shown; nothing was loaded from the RPC.");
        }
        gaps = paused ? [] : uncovered;
        for (const e of await guard(cache.getWalletSignatures(wallet, range))) {
          signatures.set(e.signature, e.blockTime);
          known.push(e.signature);
        }
      }
      stats.rangesFetched = gaps;

      let standardGaps = gaps;
      if (gaps.length > 0 && adapter.getTransactionsForAddress) {
        const split = splitForIndexedHistory(gaps);
        standardGaps = split.standard;
        for (const gap of split.indexed) {
          const rangeSeconds = { start: Date.parse(gap.start) / 1000, end: Date.parse(gap.end) / 1000 };
          try {
            const scan = await guard(
              scanIndexedHistory(
                (paginationToken) => adapter.getTransactionsForAddress!(wallet, rangeSeconds, paginationToken, signal),
                limits,
                (found) => {
                  phase = "transactions";
                  report(found);
                },
              ),
            );
            for (const entry of scan.entries) {
              if (!signatures.has(entry.signature)) {
                newEntries.push(entry);
                settled++;
              }
              signatures.set(entry.signature, entry.blockTime);
              requested.add(entry.signature);
              transactions.set(entry.signature, entry.tx);
              toSave.push({ tx: entry.tx, raw: entry.raw });
              stats.fetchedTransactions++;
            }
            flush();
            if (scan.limitHit) {
              complete = false;
              warnings.push(
                scan.limitHit === "signatures"
                  ? `Indexed wallet history: stopped at the safety limit of ${limits.maxSignaturesPerAddress.toLocaleString()} transactions.`
                  : `Indexed wallet history: stopped after ${limits.maxPagesPerAddress.toLocaleString()} pages.`,
              );
            }
            if (scan.missingBlockTime > 0) {
              complete = false;
              warnings.push(`Indexed wallet history: ${scan.missingBlockTime} transaction(s) had no block time.`);
            }
          } catch (err) {
            if (err instanceof Cancelled) throw err;
            // Paid Helius history may be unavailable on this key; preserve correctness with standard RPC.
            standardGaps.push(gap);
          }
        }
      }

      // Signatures already indexed locally start loading right away.
      await hydrate(known);

      if (standardGaps.length > 0) {
        phase = "signatures";
        report();
        const t0 = performance.now();
        try {
          for (const gap of standardGaps) {
            addScan(await guard(scanSignatures(adapter, wallet, gap, limits, signal, (entries) => hydrate(record(entries)))), "Wallet history");
          }
        } catch (err) {
          if (err instanceof Cancelled) throw err;
          error = `Could not load wallet history: ${(err as Error).message}`;
          throw err;
        } finally {
          discoveryMs += performance.now() - t0;
        }
      }

      // Token accounts are found from the wallet's own transactions, so those must finish first.
      phase = "transactions";
      report();
      await guard(queue.drain());

      if (standardGaps.length > 0) {
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
        phase = "token_accounts";
        report();
        const t0 = performance.now();
        await mapPool(tokenAccounts, limits.accountScanConcurrency, async (account) => {
          try {
            for (const gap of standardGaps) {
              addScan(
                await guard(scanSignatures(adapter, account, gap, limits, signal, (entries) => hydrate(record(entries)))),
                `Token account ${account}`,
              );
            }
          } catch (err) {
            if (err instanceof Cancelled) throw err;
            complete = false;
            warnings.push(`Token account ${account}: history unavailable (${(err as Error).message}).`);
          }
          accountsDone++;
          report();
        }).finally(() => {
          discoveryMs += performance.now() - t0;
        });

        phase = "transactions";
        report();
        await guard(queue.drain());
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

    // Nothing may still be running once this wallet's result is built, even after an error or cancel.
    await queue.drain().catch(() => {});
    flush();
    await Promise.all(saves);

    if (skippedWhilePaused > 0) {
      complete = false;
      warnings.push(`Paused: ${skippedWhilePaused} transaction(s) aren't cached and weren't fetched.`);
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

    const ordered = [...signatures].sort(([sa, a], [sb, b]) => b - a || newestFirst(sa, sb)).map(([s]) => s);
    // Everything this wallet has that wasn't fetched for it: from the local cache, or already loaded for another wallet.
    stats.cachedTransactions = ordered.filter((s) => transactions.has(s)).length - stats.fetchedTransactions;
    const timestamps = ordered
      .map((s) => transactions.get(s)?.timestamp)
      .filter((t): t is string => t != null)
      .sort();
    if (DEV) {
      const fetches = stats.fetchedTransactions + failedHere;
      console.debug(
        `[ingest] ${wallet}: ${((performance.now() - walletStartedAt) / 1000).toFixed(1)}s total, ` +
          `signature discovery ${(discoveryMs / 1000).toFixed(1)}s; ` +
          `${stats.fetchedTransactions} fetched, ${failedHere} failed, ${settled - fetches} reused; ` +
          `avg latency ${fetches ? Math.round(fetchMs / fetches) : 0}ms, peak concurrency ${queue.peak}/${limits.concurrency}`,
      );
    }

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
