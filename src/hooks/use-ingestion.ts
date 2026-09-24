"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CaseRange } from "@/lib/case/range";
import { type IngestionProgress, type IngestionResult, ingestWallets } from "@/lib/ingest/ingest";
import { createGenericAdapter } from "@/lib/rpc/generic-adapter";

export type IngestionState =
  | { status: "idle" }
  | { status: "running"; progress: IngestionProgress | null }
  | { status: "done"; result: IngestionResult }
  | { status: "error"; error: string };

/**
 * Runs ingestion for a set of wallets. Results live in memory only until the
 * IndexedDB cache lands (Sprint 03). Unmounting cancels in-flight work.
 */
export function useIngestion() {
  const [state, setState] = useState<IngestionState>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const start = useCallback(async (rpcUrl: string, wallets: string[], range: CaseRange) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ status: "running", progress: null });
    try {
      const result = await ingestWallets({
        adapter: createGenericAdapter(rpcUrl),
        wallets,
        range,
        signal: current.signal,
        onProgress: (progress) => {
          if (controller.current === current) setState({ status: "running", progress });
        },
      });
      if (controller.current === current) setState({ status: "done", result });
    } catch (err) {
      if (controller.current === current) {
        setState({ status: "error", error: err instanceof Error ? err.message : "Loading failed." });
      }
    }
  }, []);

  const cancel = useCallback(() => controller.current?.abort(), []);

  return { state, start, cancel };
}
