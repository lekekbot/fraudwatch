import { type JsonRpcOptions, rpcCall } from "./json-rpc";

/**
 * Standard Solana JSON-RPC, plus Helius's indexed history call when the URL is
 * a Helius endpoint (every standard method stays available as a fallback).
 *
 * Request params are fixed so recorded fixtures replay exactly:
 * finalized commitment, jsonParsed encoding, v0 transactions allowed.
 */

export const SIGNATURE_PAGE_LIMIT = 1000;
const COMMITMENT = "finalized";

export type SignatureInfo = {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
};

/** `getTransaction` with `encoding: "jsonParsed"`; only the fields FraudWatch reads are typed. */
export type RawParsedTransaction = {
  slot: number;
  blockTime: number | null;
  transactionIndex?: number;
  version?: number | "legacy";
  meta: RawTransactionMeta | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: Array<{ pubkey: string; signer: boolean; writable: boolean; source?: "transaction" | "lookupTable" }>;
      instructions: RawInstruction[];
    };
  };
};

export type RawTransactionMeta = {
  err: unknown;
  fee: number;
  preBalances: number[];
  postBalances: number[];
  preTokenBalances?: RawTokenBalance[];
  postTokenBalances?: RawTokenBalance[];
  innerInstructions?: Array<{ index: number; instructions: RawInstruction[] }> | null;
};

export type RawTokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: { amount: string; decimals: number };
};

export type RawInstruction = {
  programId: string;
  program?: string;
  parsed?: unknown;
  accounts?: string[];
  data?: string;
  stackHeight?: number | null;
};

export type SolanaRpcAdapter = {
  getSignaturesForAddress(address: string, opts: { before?: string }, signal: AbortSignal): Promise<SignatureInfo[]>;
  getTransaction(signature: string, signal: AbortSignal): Promise<RawParsedTransaction | null>;
  getTokenAccountsByOwner(owner: string, programId: string, signal: AbortSignal): Promise<string[]>;
  getAccountInfo(address: string, signal: AbortSignal): Promise<{ lamports: number; owner: string; data: unknown } | null>;
  /** Provider fast path: full wallet history, including owned token accounts. */
  getTransactionsForAddress?(
    address: string,
    range: { start: number; end: number },
    paginationToken: string | undefined,
    signal: AbortSignal,
  ): Promise<{ data: RawParsedTransaction[]; paginationToken?: string | null }>;
  /**
   * Digital Asset Standard `getAsset` (not a standard Solana RPC method; Helius
   * and some others provide it). Used only to name compressed NFTs; resolves
   * null when the provider doesn't support it.
   */
  getAsset(id: string, signal: AbortSignal): Promise<{ name: string | null; symbol: string | null } | null>;
};

function isHeliusRpcUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".helius-rpc.com");
  } catch {
    return false;
  }
}

export function createRpcAdapter(url: string, options: JsonRpcOptions = {}): SolanaRpcAdapter {
  const opts: JsonRpcOptions = { maxRetries: 4, ...options, rateLimit: options.rateLimit ?? { until: 0 } };
  const call = <T>(method: string, params: unknown[] | Record<string, unknown>, signal: AbortSignal) =>
    rpcCall<T>(url, method, params, signal, opts);

  const adapter: SolanaRpcAdapter = {
    async getAsset(id, signal) {
      try {
        const asset = await call<{ content?: { metadata?: { name?: string; symbol?: string } } } | null>("getAsset", { id }, signal);
        const metadata = asset?.content?.metadata;
        return metadata ? { name: metadata.name || null, symbol: metadata.symbol || null } : null;
      } catch (err) {
        if (signal.aborted) throw err;
        return null;
      }
    },

    getSignaturesForAddress(address, { before }, signal) {
      const config: Record<string, unknown> = { limit: SIGNATURE_PAGE_LIMIT, commitment: COMMITMENT };
      if (before) config.before = before;
      return call<SignatureInfo[]>("getSignaturesForAddress", [address, config], signal);
    },

    getTransaction(signature, signal) {
      return call<RawParsedTransaction | null>(
        "getTransaction",
        [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: COMMITMENT }],
        signal,
      );
    },

    async getTokenAccountsByOwner(owner, programId, signal) {
      const result = await call<{ value: Array<{ pubkey: string }> }>(
        "getTokenAccountsByOwner",
        [owner, { programId }, { encoding: "jsonParsed", commitment: COMMITMENT }],
        signal,
      );
      return result.value.map((a) => a.pubkey);
    },

    async getAccountInfo(address, signal) {
      const result = await call<{ value: { lamports: number; owner: string; data: unknown } | null }>(
        "getAccountInfo",
        [address, { encoding: "jsonParsed", commitment: COMMITMENT }],
        signal,
      );
      return result.value;
    },
  };
  if (!isHeliusRpcUrl(url)) return adapter;

  adapter.getTransactionsForAddress = (address, range, paginationToken, signal) =>
    call<{ data: RawParsedTransaction[]; paginationToken?: string | null }>(
      "getTransactionsForAddress",
      [
        address,
        {
          transactionDetails: "full",
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
          sortOrder: "desc",
          limit: 1000,
          filters: { blockTime: { gte: range.start, lt: range.end }, tokenAccounts: "all" },
          ...(paginationToken ? { paginationToken } : {}),
        },
      ],
      signal,
    );
  return adapter;
}
