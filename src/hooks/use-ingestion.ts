"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FraudWatchCase } from "@/lib/case/model";
import { getDb } from "@/lib/db/db";
import { readCachedIngestion, saveIngestionJob } from "@/lib/db/ingestion-jobs";
import { createDbIngestionCache } from "@/lib/db/transaction-cache";
import { type IngestionProgress, type IngestionResult, ingestWallets } from "@/lib/ingest/ingest";
import { createGenericAdapter } from "@/lib/rpc/generic-adapter";

export type IngestionState =
  | { status: "idle" }
  | { status: "running"; progress: IngestionProgress | null }
  | { status: "done"; result: IngestionResult; source: "cache" | "rpc"; lastLoadedAt: string | null }
  | { status: "error"; error: string };

/**
 * Shows a case's cached history on open, and loads the rest from the RPC on
 * request. Only ranges the cache doesn't cover are fetched. Unmounting cancels
 * in-flight work.
 */
export function useIngestion(c: FraudWatchCase) {
  const [state, setState] = useState<IngestionState>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);
  const wallets = c.mappedWallets.map((w) => w.address);
  const key = JSON.stringify([c.id, wallets, c.range]);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    let active = true;
    const [caseId, caseWallets, range] = JSON.parse(key) as [string, string[], FraudWatchCase["range"]];
    (async () => {
      try {
        const cached = await readCachedIngestion(getDb(), caseId, caseWallets, range);
        if (active && cached && controller.current === null) {
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

  const start = useCallback(
    async (rpcUrl: string) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setState({ status: "running", progress: null });

      let db: ReturnType<typeof getDb> | null = null;
      try {
        db = getDb();
      } catch {
        db = null;
      }

      try {
        const result = await ingestWallets({
          adapter: createGenericAdapter(rpcUrl),
          wallets,
          range: c.range,
          signal: current.signal,
          cache: db ? createDbIngestionCache(db) : undefined,
          onProgress: (progress) => {
            if (controller.current === current) setState({ status: "running", progress });
          },
        });
        const finishedAt = new Date();
        if (db) await saveIngestionJob(db, c.id, c.range, result, finishedAt).catch(() => {});
        if (controller.current === current) {
          setState({ status: "done", result, source: "rpc", lastLoadedAt: finishedAt.toISOString() });
        }
      } catch (err) {
        if (controller.current === current) {
          setState({ status: "error", error: err instanceof Error ? err.message : "Loading failed." });
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the case's id, wallets, and range.
    [key],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);

  return { state, start, cancel, wallets };
}
