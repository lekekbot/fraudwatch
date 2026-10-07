import { RpcRequestError, rpcCall } from "./json-rpc";

export type RpcTestResult =
  | { ok: true; latencyMs: number; solanaCore: string | null; slot: number }
  | { ok: false; kind: RpcTestFailureKind; message: string };

export type RpcTestFailureKind =
  | "network_or_cors"
  | "http"
  | "rpc_error"
  | "malformed"
  | "timeout"
  | "aborted";

const TIMEOUT_MS = 10_000;

/**
 * Lightweight connectivity check: `getVersion` + `getLatestBlockhash`.
 * Deeper capability detection (archive history, enhanced methods) is Sprint 11.
 */
export async function testRpcConnection(
  url: string,
  options: { signal?: AbortSignal } = {},
): Promise<RpcTestResult> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  const started = performance.now();
  try {
    const version = await rpcCall<{ "solana-core"?: string }>(url, "getVersion", [], signal);
    const blockhash = await rpcCall<{ context?: { slot?: number }; value?: { blockhash?: string } }>(
      url,
      "getLatestBlockhash",
      [{ commitment: "confirmed" }],
      signal,
    );
    if (typeof blockhash?.value?.blockhash !== "string" || typeof blockhash?.context?.slot !== "number") {
      return { ok: false, kind: "malformed", message: "getLatestBlockhash returned an unexpected shape." };
    }
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - started),
      solanaCore: version?.["solana-core"] ?? null,
      slot: blockhash.context.slot,
    };
  } catch (err) {
    if (err instanceof RpcRequestError) return { ok: false, kind: err.kind, message: err.message };
    if (options.signal?.aborted) return { ok: false, kind: "aborted", message: "Connection test cancelled." };
    if (timeout.aborted) return { ok: false, kind: "timeout", message: `No response within ${TIMEOUT_MS / 1000}s.` };
    return { ok: false, kind: "network_or_cors", message: "Connection test failed unexpectedly." };
  }
}
