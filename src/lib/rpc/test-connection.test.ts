import { describe, expect, it } from "vitest";
import { testRpcConnection } from "./test-connection";

const URL_WITH_KEY = "https://rpc.example.com/?api-key=super-secret";

function jsonRpcFetch(results: Record<string, unknown>): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { method } = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: results[method] }), { status: 200 });
  }) as typeof fetch;
}

describe("testRpcConnection", () => {
  it("reports version, slot, and latency on success", async () => {
    let t = 0;
    const result = await testRpcConnection(URL_WITH_KEY, {
      now: () => (t += 50),
      fetchImpl: jsonRpcFetch({
        getVersion: { "solana-core": "2.3.1", "feature-set": 1 },
        getLatestBlockhash: { context: { slot: 425_000_000 }, value: { blockhash: "abc", lastValidBlockHeight: 1 } },
      }),
    });
    expect(result).toEqual({ ok: true, latencyMs: 50, solanaCore: "2.3.1", slot: 425_000_000 });
  });

  it("sends POST with no referrer and no credentials", async () => {
    const inits: RequestInit[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      inits.push(init!);
      return jsonRpcFetch({ getVersion: {}, getLatestBlockhash: { context: { slot: 1 }, value: { blockhash: "x" } } })(url, init);
    }) as typeof fetch;
    await testRpcConnection(URL_WITH_KEY, { fetchImpl });
    expect(inits).toHaveLength(2);
    for (const init of inits) {
      expect(init.method).toBe("POST");
      expect(init.referrerPolicy).toBe("no-referrer");
      expect(init.credentials).toBe("omit");
    }
  });

  it("classifies network/CORS failures without leaking the key", async () => {
    const result = await testRpcConnection(URL_WITH_KEY, {
      fetchImpl: (async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("network_or_cors");
    expect(result.message).not.toContain("super-secret");
    expect(result.message).toContain("rpc.example.com");
  });

  it("classifies HTTP errors with hints", async () => {
    const result = await testRpcConnection(URL_WITH_KEY, {
      fetchImpl: (async () => new Response("nope", { status: 429 })) as typeof fetch,
    });
    expect(result).toMatchObject({ ok: false, kind: "http" });
    if (!result.ok) expect(result.message).toContain("rate limited");
  });

  it("surfaces the JSON-RPC error body on HTTP 403 (public mainnet rejects browser origins)", async () => {
    const result = await testRpcConnection(URL_WITH_KEY, {
      fetchImpl: (async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: 403, message: "Access forbidden" }, id: 1 }), {
          status: 403,
        })) as typeof fetch,
    });
    expect(result).toMatchObject({ ok: false, kind: "http" });
    if (!result.ok) {
      expect(result.message).toContain("HTTP 403: Access forbidden");
      expect(result.message).toContain("reject all browser requests");
      expect(result.message).not.toContain("super-secret");
    }
  });

  it("classifies JSON-RPC errors and malformed bodies", async () => {
    const rpcError = await testRpcConnection(URL_WITH_KEY, {
      fetchImpl: (async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }))) as typeof fetch,
    });
    expect(rpcError).toMatchObject({ ok: false, kind: "rpc_error" });

    const malformed = await testRpcConnection(URL_WITH_KEY, {
      fetchImpl: (async () => new Response("<html>")) as typeof fetch,
    });
    expect(malformed).toMatchObject({ ok: false, kind: "malformed" });

    const wrongShape = await testRpcConnection(URL_WITH_KEY, {
      fetchImpl: jsonRpcFetch({ getVersion: {}, getLatestBlockhash: { nope: true } }),
    });
    expect(wrongShape).toMatchObject({ ok: false, kind: "malformed" });
  });

  it("distinguishes user cancellation from timeout", async () => {
    const hang = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;

    const controller = new AbortController();
    const cancelled = testRpcConnection(URL_WITH_KEY, { fetchImpl: hang, signal: controller.signal });
    controller.abort();
    expect(await cancelled).toMatchObject({ ok: false, kind: "aborted" });

    expect(await testRpcConnection(URL_WITH_KEY, { fetchImpl: hang, timeoutMs: 20 })).toMatchObject({
      ok: false,
      kind: "timeout",
    });
  });
});
