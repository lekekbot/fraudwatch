import { SIGNATURE_PAGE_LIMIT, type SignatureInfo, type SolanaRpcAdapter } from "@/lib/rpc/generic-adapter";

/** Stop paging back after this many signatures; past it, ask the user for a start date. */
export const MAX_SPAN_SIGNATURES = 100_000;

/** ISO times of a wallet's oldest and newest transactions the RPC returned. */
export type ActivitySpan = { first: string | null; last: string | null; signaturesScanned: number; truncated: boolean };

const time = (s: SignatureInfo | undefined) => (s?.blockTime != null ? new Date(s.blockTime * 1000).toISOString() : null);

/** Newest-first page → first entry with a block time; oldest-first when reversed. */
const firstTimed = (page: SignatureInfo[]) => time(page.find((s) => s.blockTime != null));

/**
 * Finds when a wallet was first and last active from its signature list.
 * Solana doesn't record an account's creation, so its oldest transaction is
 * the closest real signal. The newest is one call; the oldest pages back
 * through the whole history, so it's only fetched when `needFirst` is set.
 * Providers without full history return their own oldest transaction.
 */
export async function findActivitySpan(
  adapter: Pick<SolanaRpcAdapter, "getSignaturesForAddress">,
  address: string,
  opts: { needFirst: boolean; signal: AbortSignal; maxSignatures?: number; onProgress?: (scanned: number) => void },
): Promise<ActivitySpan> {
  const max = opts.maxSignatures ?? MAX_SPAN_SIGNATURES;
  let page = await adapter.getSignaturesForAddress(address, {}, opts.signal);
  let scanned = page.length;
  const last = firstTimed(page);
  if (!opts.needFirst || page.length === 0) return { first: null, last, signaturesScanned: scanned, truncated: false };

  let oldestPage = page;
  while (page.length === SIGNATURE_PAGE_LIMIT) {
    if (scanned >= max) return { first: null, last, signaturesScanned: scanned, truncated: true };
    opts.onProgress?.(scanned);
    page = await adapter.getSignaturesForAddress(address, { before: page[page.length - 1].signature }, opts.signal);
    scanned += page.length;
    if (page.length > 0) oldestPage = page;
  }
  return { first: firstTimed([...oldestPage].reverse()), last, signaturesScanned: scanned, truncated: false };
}
