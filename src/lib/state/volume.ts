import { NATIVE_SOL } from "@/lib/assets/assets";
import { abs } from "@/lib/solana/amount";
import type { EffectSummary, NftCatalog } from "./summarize";

/** One wallet's side of a transaction, as the views already show it. */
export type TransactedRow = { signature: string; /** When it happened, if known; ms since epoch. */ time: number | null; summary: EffectSummary };

/** What moved of one asset over the counted transactions. */
export type TransactedAsset = {
  assetId: string;
  /** Base units that came in / went out, and their difference. */
  in: string;
  out: string;
  net: string;
  /** Transactions the asset moved in. */
  count: number;
};

export type TransactedOverview = {
  /** SOL first, then the assets that moved most often. */
  assets: TransactedAsset[];
  /** NFT mints that changed hands; counted, not summed. */
  nfts: { in: number; out: number };
  /** Unique transactions counted. */
  transactions: number;
  /** Wallet sides skipped because another lane already counted their transaction. */
  sharedSides: number;
};

/**
 * Per-asset totals over the given transaction sides, following the same
 * filters the views do. A signature shared by several mapped wallets counts
 * once, from the first lane that has it — both sides of the same transfer
 * would double the amount. NFT mints have no amount to sum; they're counted.
 */
export function transactedOverview(rows: readonly TransactedRow[], nfts: NftCatalog): TransactedOverview {
  const seen = new Set<string>();
  const assets = new Map<string, { in: bigint; out: bigint; count: number }>();
  const nftsMoved = { in: 0, out: 0 };
  let sharedSides = 0;
  for (const { signature, summary } of rows) {
    if (seen.has(signature)) {
      sharedSides += 1;
      continue;
    }
    seen.add(signature);
    const moved = new Set<string>();
    const side = (change: { assetId: string; delta: string }, incoming: boolean) => {
      if (nfts.isNft(change.assetId)) {
        // An NFT moves whole units; its delta is the count.
        nftsMoved[incoming ? "in" : "out"] += Number(abs(BigInt(change.delta)));
        return;
      }
      const asset = assets.get(change.assetId) ?? { in: 0n, out: 0n, count: 0 };
      if (incoming) asset.in += BigInt(change.delta);
      else asset.out += abs(BigInt(change.delta));
      assets.set(change.assetId, asset);
      moved.add(change.assetId);
    };
    for (const c of summary.inflows) side(c, true);
    for (const c of summary.outflows) side(c, false);
    for (const id of moved) assets.get(id)!.count += 1;
  }
  const list = [...assets].map(([assetId, a]) => ({ assetId, in: a.in.toString(), out: a.out.toString(), net: (a.in - a.out).toString(), count: a.count }));
  list.sort((a, b) => (a.assetId === NATIVE_SOL ? -1 : b.assetId === NATIVE_SOL ? 1 : b.count - a.count || a.assetId.localeCompare(b.assetId)));
  return { assets: list, nfts: nftsMoved, transactions: seen.size, sharedSides };
}

/**
 * An unmapped address's side of the given mapped-wallet transactions, from the
 * counterparty deltas recorded there: what it gained is an inflow, what it
 * lost an outflow. A transaction seen from two mapped wallets still counts once.
 */
export function counterpartyRows(address: string, rows: readonly TransactedRow[]): TransactedRow[] {
  const out: TransactedRow[] = [];
  for (const { signature, time, summary } of rows) {
    const own = summary.counterparties.filter((c) => c.address === address);
    if (own.length === 0) continue;
    const change = (c: (typeof own)[number]) => ({ assetId: c.assetId, delta: c.delta });
    out.push({
      signature,
      time,
      summary: {
        ...summary,
        inflows: own.filter((c) => !c.delta.startsWith("-")).map(change),
        outflows: own.filter((c) => c.delta.startsWith("-")).map(change),
        counterparties: [],
      },
    });
  }
  return out;
}
