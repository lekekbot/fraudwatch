import { createGenericAdapter, type RawParsedTransaction, type SolanaRpcAdapter } from "./generic-adapter";
import { type JsonRpcOptions, rpcCall } from "./json-rpc";

export function isHeliusRpcUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".helius-rpc.com");
  } catch {
    return false;
  }
}

/** Add Helius's indexed history call while retaining every standard RPC method as a fallback. */
export function createIngestionAdapter(url: string, options: JsonRpcOptions = {}): SolanaRpcAdapter {
  const generic = createGenericAdapter(url, options);
  if (!isHeliusRpcUrl(url)) return generic;
  const opts: JsonRpcOptions = { maxRetries: 4, ...options };

  return {
    ...generic,
    kind: "helius",
    getTransactionsForAddress(address, range, paginationToken, signal) {
      return rpcCall<{ data: RawParsedTransaction[]; paginationToken?: string | null }>(
        url,
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
        opts,
      );
    },
  };
}
