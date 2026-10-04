"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FraudWatchCase } from "@/lib/case/model";
import { walletRanges } from "@/lib/case/wallet-range";
import { getDb } from "@/lib/db/db";
import { readCachedIngestion, saveIngestionJob } from "@/lib/db/ingestion-jobs";
import { createDbIngestionCache } from "@/lib/db/transaction-cache";
import { type IngestionProgress, type IngestionResult, ingestWallets } from "@/lib/ingest/ingest";
import { createIngestionAdapter } from "@/lib/rpc/helius-adapter";

export type IngestionState =
  | { status: "idle" }
  | { status: "running"; progress: IngestionProgress | null }
  | { status: "done"; result: IngestionResult; source: "cache" | "rpc"; lastLoadedAt: string | null }
  | { status: "error"; error: string };

/** Progress repaints at most this often; ingestion itself reports every transaction. */
const PROGRESS_INTERVAL_MS = 200;

/**
 * Shows a case's cached history on open, and loads the rest from the RPC on
 * request. Only ranges the cache doesn't cover are fetched. Unmounting cancels
 * in-flight work.
 */
export function useIngestion(c: FraudWatchCase) {
  const [state, setState] = useState<IngestionState>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);
  /** Bumped when a load starts or ends, so a slower cached read never replaces a newer result. */
  const generation = useRef(0);
  const running = useRef(false);
  const wallets = c.mappedWallets.map((w) => w.address);
  const key = JSON.stringify([c.id, wallets, c.range, walletRanges(c)]);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    let active = true;
    const [caseId, caseWallets, range, ranges] = JSON.parse(key) as [string, string[], FraudWatchCase["range"], Record<string, FraudWatchCase["range"]>];
    const startedAt = generation.current;
    (async () => {
      try {
        const cached = await readCachedIngestion(getDb(), caseId, caseWallets, range, ranges);
        // Re-read on every config change (e.g. a wallet was unmapped), unless a load is running or finished meanwhile.
        if (active && cached && !running.current && generation.current === startedAt) {
          setState({ status: "done", result: cached.result, source: "cache", lastLoadedAt: cached.lastLoadedAt });
        }
      } catch {
        // No usable local storage: the case still works, just without a cache.
      }
    })();
    return () => {
      active = false;
    };
  }, [key]);

  /** Loads every mapped wallet. Pass `config` to load a case just saved (e.g. with a newly mapped wallet) before it re-renders. */
  const start = useCallback(
    async (rpcUrl: string, config: FraudWatchCase = c) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      running.current = true;
      generation.current++;
      setState({ status: "running", progress: null });

      let db: ReturnType<typeof getDb> | null = null;
      try {
        db = getDb();
      } catch {
        db = null;
      }

      let latest: IngestionProgress | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const retries = { total: 0, rateLimited: 0 };
      try {
        const result = await ingestWallets({
          adapter: createIngestionAdapter(rpcUrl, {
            onRetry: (err) => {
              retries.total++;
              if (err.status === 429) retries.rateLimited++;
            },
          }),
          wallets: config.mappedWallets.map((w) => w.address),
          range: config.range,
          ranges: walletRanges(config),
          // Paused wallets keep their cached history but never ask the RPC for more.
          cacheOnly: new Set(config.mappedWallets.filter((w) => w.paused).map((w) => w.address)),
          signal: current.signal,
          cache: db ? createDbIngestionCache(db) : undefined,
          onProgress: (progress) => {
            latest = progress;
            timer ??= setTimeout(() => {
              timer = null;
              if (controller.current === current) setState({ status: "running", progress: latest });
            }, PROGRESS_INTERVAL_MS);
          },
        });
        if (process.env.NODE_ENV === "development") {
          console.debug(`[ingest] ${retries.total} RPC retries, ${retries.rateLimited} after HTTP 429`);
        }
        const finishedAt = new Date();
        if (db) await saveIngestionJob(db, config.id, config.range, result, finishedAt).catch(() => {});
        if (controller.current === current) {
          setState({ status: "done", result, source: "rpc", lastLoadedAt: finishedAt.toISOString() });
        }
      } catch (err) {
        if (controller.current === current) {
          setState({ status: "error", error: err instanceof Error ? err.message : "Loading failed." });
        }
      } finally {
        if (timer) clearTimeout(timer);
        if (controller.current === current) {
          running.current = false;
          generation.current++;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the case's id, wallets, and ranges.
    [key],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);

  return { state, start, cancel, wallets };
}
