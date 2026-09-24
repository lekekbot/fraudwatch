import { type JsonRpcOptions, rpcCall } from "./json-rpc";

/**
 * Standard Solana JSON-RPC only. Provider-specific ("enhanced") history APIs
 * get their own adapter; nothing here may depend on them.
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

export type TokenAccountInfo = {
  address: string;
  mint: string;
  owner: string;
  programId: string;
  amount: string;
  decimals: number;
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
  kind: "generic";
  getSignaturesForAddress(address: string, opts: { before?: string }, signal: AbortSignal): Promise<SignatureInfo[]>;
  getTransaction(signature: string, signal: AbortSignal): Promise<RawParsedTransaction | null>;
  getTokenAccountsByOwner(owner: string, programId: string, signal: AbortSignal): Promise<TokenAccountInfo[]>;
  getAccountInfo(address: string, signal: AbortSignal): Promise<{ lamports: number; owner: string; data: unknown } | null>;
  getBalance(address: string, signal: AbortSignal): Promise<number>;
  getTokenAccountBalance(address: string, signal: AbortSignal): Promise<{ amount: string; decimals: number }>;
  getLatestBlockhash(signal: AbortSignal): Promise<{ blockhash: string; slot: number }>;
  /**
   * Digital Asset Standard `getAsset` (not a standard Solana RPC method; Helius
   * and some others provide it). Used only to name compressed NFTs; resolves
   * null when the provider doesn't support it.
   */
  getAsset(id: string, signal: AbortSignal): Promise<{ name: string | null; symbol: string | null } | null>;
};

type ParsedTokenAccount = {
  pubkey: string;
  account: {
    data: {
      program?: string;
      parsed?: { info?: { mint?: string; owner?: string; tokenAmount?: { amount?: string; decimals?: number } } };
    };
  };
};

export function createGenericAdapter(url: string, options: JsonRpcOptions = {}): SolanaRpcAdapter {
  const opts: JsonRpcOptions = { maxRetries: 4, ...options };
  const call = <T>(method: string, params: unknown[] | Record<string, unknown>, signal: AbortSignal) =>
    rpcCall<T>(url, method, params, signal, opts);

  return {
    kind: "generic",

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
      const result = await call<{ value: ParsedTokenAccount[] }>(
        "getTokenAccountsByOwner",
        [owner, { programId }, { encoding: "jsonParsed", commitment: COMMITMENT }],
        signal,
      );
      return result.value.map(({ pubkey, account }) => {
        const info = account.data.parsed?.info;
        return {
          address: pubkey,
          mint: info?.mint ?? "",
          owner: info?.owner ?? owner,
          programId,
          amount: info?.tokenAmount?.amount ?? "0",
          decimals: info?.tokenAmount?.decimals ?? 0,
        };
      });
    },

    async getAccountInfo(address, signal) {
      const result = await call<{ value: { lamports: number; owner: string; data: unknown } | null }>(
        "getAccountInfo",
        [address, { encoding: "jsonParsed", commitment: COMMITMENT }],
        signal,
      );
      return result.value;
    },

    async getBalance(address, signal) {
      const result = await call<{ value: number }>("getBalance", [address, { commitment: COMMITMENT }], signal);
      return result.value;
    },

    async getTokenAccountBalance(address, signal) {
      const result = await call<{ value: { amount: string; decimals: number } }>(
        "getTokenAccountBalance",
        [address, { commitment: COMMITMENT }],
        signal,
      );
      return { amount: result.value.amount, decimals: result.value.decimals };
    },

    async getLatestBlockhash(signal) {
      const result = await call<{ context: { slot: number }; value: { blockhash: string } }>(
        "getLatestBlockhash",
        [{ commitment: COMMITMENT }],
        signal,
      );
      return { blockhash: result.value.blockhash, slot: result.context.slot };
    },
  };
}
