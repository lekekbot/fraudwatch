"use client";

import { useEffect, useState } from "react";
import { type AssetMetadata, fetchAssetMetadata, nftCandidates } from "@/lib/assets/assets";
import type { CaseRange } from "@/lib/case/range";
import { getDb } from "@/lib/db/db";
import { getAssetMetadata, getWalletState, saveAssetMetadata } from "@/lib/db/wallet-states";
import type { IngestionResult } from "@/lib/ingest/ingest";
import { mapPool } from "@/lib/ingest/pool";
import { createGenericAdapter } from "@/lib/rpc/generic-adapter";
import { reconstructWalletState, type WalletState } from "@/lib/state/reconstruct";

export type WalletStates = { states: WalletState[]; assets: Map<string, AssetMetadata> };

/**
 * Reconstructed state for each wallet in an ingestion result, plus metadata
 * for every asset involved. Unknown mints are looked up on-chain once through
 * the user's RPC and cached; without an RPC they show as shortened mints.
 */
export function useWalletStates(
  result: IngestionResult | null,
  range: CaseRange,
  rpcUrl: string | undefined,
  /** Mapped wallets that start later than the case; their cached state is keyed by their own range. */
  ranges: Record<string, CaseRange> = {},
) {
  // Tagged with the result it was computed from, so a stale value is never shown for a newer result.
  const [value, setValue] = useState<(WalletStates & { source: IngestionResult }) | null>(null);

  const { start, end } = range;
  const rangesKey = JSON.stringify(ranges);
  useEffect(() => {
    const range: CaseRange = { start, end };
    const ranges = JSON.parse(rangesKey) as Record<string, CaseRange>;
    if (!result) return;
    let active = true;
    const controller = new AbortController();

    (async () => {
      let db: ReturnType<typeof getDb> | null = null;
      try {
        db = getDb();
      } catch {
        db = null;
      }

      const states: WalletState[] = [];
      for (const w of result.wallets) {
        const txs = w.signatures.map((s) => result.transactions.get(s)).filter((t) => t !== undefined);
        const complete = w.coverage.complete;
        states.push(
          db
            ? await getWalletState(db, w.wallet, ranges[w.wallet] ?? range, txs, complete)
            : reconstructWalletState(w.wallet, txs, { historyComplete: complete }),
        );
      }

      // Every asset the wallets held, plus possible NFTs anywhere in their transactions:
      // a seller never holds an escrowed listing, but its sale still needs the NFT check.
      const ids = [
        ...states.flatMap((s) => [...s.opening, ...s.closing].map((a) => a.assetId)),
        ...nftCandidates([...result.transactions.values()].flatMap((tx) => tx.tokenChanges)),
      ];
      const { known, toFetch } = db ? await getAssetMetadata(db, ids) : { known: new Map<string, AssetMetadata>(), toFetch: [] };
      if (!active) return;
      setValue({ states, assets: new Map(known), source: result });

      if (!db || !rpcUrl || toFetch.length === 0) return;
      const adapter = createGenericAdapter(rpcUrl);
      const fetched: AssetMetadata[] = [];
      await mapPool(toFetch, 2, async (mint) => {
        try {
          fetched.push(await fetchAssetMetadata(adapter, mint, controller.signal));
        } catch {
          // Leave it unnamed; it's retried next time.
        }
      }).catch(() => {});
      if (fetched.length > 0) await saveAssetMetadata(db, fetched).catch(() => {});
      if (active && fetched.length > 0) {
        setValue({ states, assets: new Map([...known, ...fetched.map((m) => [m.id, m] as const)]), source: result });
      }
    })().catch(() => {
      // Reconstruction failures leave the ingestion view as it is.
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [result, start, end, rpcUrl, rangesKey]);

  return value && value.source === result ? value : null;
}
