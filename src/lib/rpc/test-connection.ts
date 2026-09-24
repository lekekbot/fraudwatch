import { redactRpcUrl } from "./url";

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

type JsonRpcResponse<T> = { jsonrpc: "2.0"; id: number; result?: T; error?: { code: number; message: string } };

class RpcTestError extends Error {
  constructor(
    readonly kind: RpcTestFailureKind,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(
  url: string,
  method: string,
  params: unknown[],
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal,
      // The RPC URL itself is the credential; never leak it via Referer.
      referrerPolicy: "no-referrer",
      credentials: "omit",
    });
  } catch (err) {
    if (signal.aborted) throw err;
    // Browsers report CORS rejections and network failures identically.
    throw new RpcTestError(
      "network_or_cors",
      `Could not reach ${redactRpcUrl(url)}. The endpoint may be down, or it may not allow browser (CORS) requests.`,
    );
  }

  if (!res.ok) {
    const detail = await readErrorMessage(res);
    const hint =
      res.status === 429
        ? " You are being rate limited."
        : res.status === 401 || res.status === 403
          ? " Check your API key. Some endpoints, including the public api.mainnet-beta.solana.com, reject all browser requests; use a provider RPC URL instead."
          : "";
    throw new RpcTestError("http", `RPC responded with HTTP ${res.status}${detail ? `: ${detail}` : ""}.${hint}`);
  }

  let body: JsonRpcResponse<T>;
  try {
    body = (await res.json()) as JsonRpcResponse<T>;
  } catch {
    throw new RpcTestError("malformed", "RPC response was not valid JSON.");
  }
  if (body.error) {
    throw new RpcTestError("rpc_error", `RPC error ${body.error.code} on ${method}: ${body.error.message}`);
  }
  if (!("result" in body)) {
    throw new RpcTestError("malformed", `RPC response to ${method} had no result.`);
  }
  return body.result as T;
}

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } };
    return typeof body?.error?.message === "string" ? body.error.message.slice(0, 200) : null;
  } catch {
    return null;
  }
}

/**
 * Lightweight connectivity check: `getVersion` + `getLatestBlockhash`.
 * Deeper capability detection (archive history, enhanced methods) is Sprint 11.
 */
export async function testRpcConnection(
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<RpcTestResult> {
  const { timeoutMs = 10_000, fetchImpl = fetch, now = () => performance.now() } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  const started = now();
  try {
    const version = await call<{ "solana-core"?: string }>(url, "getVersion", [], signal, fetchImpl);
    const blockhash = await call<{ context?: { slot?: number }; value?: { blockhash?: string } }>(
      url,
      "getLatestBlockhash",
      [{ commitment: "confirmed" }],
      signal,
      fetchImpl,
    );
    if (typeof blockhash?.value?.blockhash !== "string" || typeof blockhash?.context?.slot !== "number") {
      return { ok: false, kind: "malformed", message: "getLatestBlockhash returned an unexpected shape." };
    }
    return {
      ok: true,
      latencyMs: Math.round(now() - started),
      solanaCore: version?.["solana-core"] ?? null,
      slot: blockhash.context.slot,
    };
  } catch (err) {
    if (err instanceof RpcTestError) return { ok: false, kind: err.kind, message: err.message };
    if (options.signal?.aborted) return { ok: false, kind: "aborted", message: "Connection test cancelled." };
    if (timeout.aborted) return { ok: false, kind: "timeout", message: `No response within ${timeoutMs / 1000}s.` };
    return { ok: false, kind: "network_or_cors", message: "Connection test failed unexpectedly." };
  }
}
