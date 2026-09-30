import { describe, expect, it } from "vitest";
import { RpcRequestError, rpcCall } from "./json-rpc";

const URL = "https://rpc.example.com/?api-key=k";

function sequenceFetch(responses: Array<() => Response>): typeof fetch & { calls: number } {
  const fn = Object.assign(async () => responses[Math.min(fn.calls++, responses.length - 1)](), { calls: 0 });
  return fn as unknown as typeof fetch & { calls: number };
}

const ok = (result: unknown) => () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));

describe("rpcCall", () => {
  it("retries rate limits with backoff, honouring Retry-After", async () => {
    const sleeps: number[] = [];
    const fetchImpl = sequenceFetch([
      () => new Response("", { status: 429, headers: { "retry-after": "2" } }),
      () => new Response("", { status: 503 }),
      ok(42),
    ]);
    const result = await rpcCall<number>(URL, "getBalance", [], new AbortController().signal, {
      fetchImpl,
      maxRetries: 3,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(result).toBe(42);
    expect(sleeps[0]).toBe(2000);
    // Exponential backoff for the second attempt (1s), jittered down to at most half.
    expect(sleeps[1]).toBeGreaterThanOrEqual(500);
    expect(sleeps[1]).toBeLessThanOrEqual(1000);
  });

  it("gives up after maxRetries", async () => {
    const fetchImpl = sequenceFetch([() => new Response("", { status: 429 })]);
    await expect(
      rpcCall(URL, "getBalance", [], new AbortController().signal, { fetchImpl, maxRetries: 2, sleep: async () => {} }),
    ).rejects.toMatchObject({ kind: "http", status: 429 });
    expect(fetchImpl.calls).toBe(3);
  });

  it("does not retry JSON-RPC errors", async () => {
    const fetchImpl = sequenceFetch([
      () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad params" } })),
    ]);
    await expect(
      rpcCall(URL, "getBalance", [], new AbortController().signal, { fetchImpl, maxRetries: 3, sleep: async () => {} }),
    ).rejects.toBeInstanceOf(RpcRequestError);
    expect(fetchImpl.calls).toBe(1);
  });

  it("stops retrying once aborted", async () => {
    const controller = new AbortController();
    const fetchImpl = sequenceFetch([() => new Response("", { status: 429 })]);
    const pending = rpcCall(URL, "getBalance", [], controller.signal, { fetchImpl, maxRetries: 5 });
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(fetchImpl.calls).toBe(1);
  });

  it("abandons and retries a request that exceeds the timeout", async () => {
    let calls = 0;
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (++calls === 1) {
        return new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));
      }
      return ok(7)();
    }) as typeof fetch;
    const retried: string[] = [];
    const result = await rpcCall<number>(URL, "getTransaction", [], new AbortController().signal, {
      fetchImpl,
      maxRetries: 1,
      timeoutMs: 10,
      sleep: async () => {},
      onRetry: (err) => retried.push(err.message),
    });
    expect(result).toBe(7);
    expect(retried[0]).toMatch(/timed out/);
  });

  it("never puts the RPC URL in error messages", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const err = await rpcCall(URL, "getBalance", [], new AbortController().signal, { fetchImpl }).catch((e: Error) => e);
    expect((err as Error).message).not.toContain("api-key");
  });
});
