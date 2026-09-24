import { redactRpcUrl } from "./url";

export type RpcFailureKind = "network_or_cors" | "http" | "rpc_error" | "malformed";

export class RpcRequestError extends Error {
  constructor(
    readonly kind: RpcFailureKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export type JsonRpcOptions = {
  fetchImpl?: typeof fetch;
  /** Retries for rate limits (429), gateway errors (502–504), and network failures. */
  maxRetries?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

type JsonRpcResponse<T> = { jsonrpc: "2.0"; id: number; result?: T; error?: { code: number; message: string } };

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isRetryable(err: RpcRequestError): boolean {
  return err.kind === "network_or_cors" || (err.kind === "http" && RETRYABLE_STATUS.has(err.status ?? 0));
}

/**
 * One JSON-RPC request, retried with exponential backoff on transient failures.
 * Aborts propagate as the signal's reason; everything else is an RpcRequestError.
 */
export async function rpcCall<T>(
  url: string,
  method: string,
  params: unknown[],
  signal: AbortSignal,
  options: JsonRpcOptions = {},
): Promise<T> {
  const { fetchImpl = fetch, maxRetries = 0, sleep = abortableSleep } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await rpcCallOnce<T>(url, method, params, signal, fetchImpl);
    } catch (err) {
      if (signal.aborted || !(err instanceof RpcRequestError) || !isRetryable(err) || attempt >= maxRetries) throw err;
      const backoff = Math.min(MAX_BACKOFF_MS, err.retryAfterMs ?? BASE_BACKOFF_MS * 2 ** attempt);
      await sleep(backoff, signal);
    }
  }
}

async function rpcCallOnce<T>(
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
    throw new RpcRequestError(
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
    throw new RpcRequestError(
      "http",
      `RPC responded with HTTP ${res.status}${detail ? `: ${detail}` : ""}.${hint}`,
      res.status,
      parseRetryAfter(res.headers.get("retry-after")),
    );
  }

  let body: JsonRpcResponse<T>;
  try {
    body = (await res.json()) as JsonRpcResponse<T>;
  } catch {
    throw new RpcRequestError("malformed", "RPC response was not valid JSON.");
  }
  if (body.error) {
    throw new RpcRequestError("rpc_error", `RPC error ${body.error.code} on ${method}: ${body.error.message}`);
  }
  if (!("result" in body)) {
    throw new RpcRequestError("malformed", `RPC response to ${method} had no result.`);
  }
  return body.result as T;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } };
    return typeof body?.error?.message === "string" ? body.error.message.slice(0, 200) : null;
  } catch {
    return null;
  }
}
