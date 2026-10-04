import { describe, expect, it } from "vitest";
import { generateHighActivity } from "../../../fixtures/solana/synthetic/generate";
import { createGenericAdapter } from "@/lib/rpc/generic-adapter";
import { type Fixture, loadFixture, type ReplayLog, replayFetch } from "@/test/fixture-rpc";
import { type IngestionProgress, type IngestOptions, ingestWallets } from "./ingest";

function run(fixture: Fixture, overrides: Partial<IngestOptions> & { fetchImpl?: typeof fetch; wallets?: string[] } = {}) {
  const { fetchImpl = replayFetch(fixture), ...rest } = overrides;
  return ingestWallets({
    adapter: createGenericAdapter("https://rpc.example.com/?api-key=k", { fetchImpl, maxRetries: 0 }),
    wallets: fixture.manifest.wallets.map((w) => w.address),
    range: fixture.manifest.range,
    signal: new AbortController().signal,
    ...rest,
  });
}

function expectMatchesManifest(fixture: Fixture, result: Awaited<ReturnType<typeof ingestWallets>>) {
  const { expected } = fixture.manifest;
  for (const w of result.wallets) {
    expect(new Set(w.signatures), w.wallet).toEqual(new Set(expected.signaturesByWallet[w.wallet]));
    expect(w.signatures).toHaveLength(new Set(w.signatures).size);
    expect(w.coverage.complete, w.coverage.warnings.join("; ")).toBe(true);
    expect(w.coverage.transactionCount).toBe(w.signatures.length);
  }
  expect(result.transactions.size).toBe(expected.transactionCount);
  expect(result.cancelled).toBe(false);
}

describe("ingestWallets against recorded mainnet fixtures", () => {
  for (const id of ["simple-transfers", "swap", "a-to-b-to-c", "loop-c-d-a", "token-account-only"]) {
    it(`reproduces ${id}`, async () => {
      const fixture = loadFixture(id);
      expectMatchesManifest(fixture, await run(fixture));
    });
  }

  it("finds transfers that reference only a wallet's token account", async () => {
    const fixture = loadFixture("token-account-only");
    const [{ signature, wallet, tokenAccount }] = fixture.manifest.expected.signaturesOnlyViaTokenAccount!;
    const result = await run(fixture, { wallets: [wallet] });
    const w = result.wallets[0];
    expect(w.signatures).toContain(signature);
    expect(w.tokenAccounts).toContain(tokenAccount);
  });

  it("stores a transaction shared by two mapped wallets once and fetches it once", async () => {
    const fixture = loadFixture("a-to-b-to-c");
    const log: ReplayLog = [];
    const result = await run(fixture, { fetchImpl: replayFetch(fixture, log) });
    const fetched = log.filter((c) => c.method === "getTransaction").map((c) => c.params[0]);
    expect(fetched).toHaveLength(new Set(fetched).size);
    for (const shared of fixture.manifest.expected.sharedSignatures) {
      for (const wallet of shared.wallets) {
        expect(result.wallets.find((w) => w.wallet === wallet)!.signatures).toContain(shared.signature);
      }
    }
  });

  it("never asks the RPC about a paused wallet, and still loads the others", async () => {
    const fixture = loadFixture("a-to-b-to-c");
    const [paused, ...others] = fixture.manifest.wallets.map((w) => w.address);
    const log: ReplayLog = [];
    const result = await run(fixture, { fetchImpl: replayFetch(fixture, log), cacheOnly: new Set([paused]) });
    expect(log.filter((c) => c.params[0] === paused)).toEqual([]);
    const w = result.wallets.find((x) => x.wallet === paused)!;
    expect(w.signatures).toEqual([]);
    expect(w.coverage.complete).toBe(false);
    expect(w.coverage.warnings.join(" ")).toMatch(/Paused/);
    for (const other of others) expect(result.wallets.find((x) => x.wallet === other)!.signatures.length).toBeGreaterThan(0);
  });

  it("counts a transaction already loaded for another wallet as reused, not fetched", async () => {
    const fixture = loadFixture("a-to-b-to-c");
    const result = await run(fixture);
    for (const w of result.wallets) {
      expect(w.stats.cachedTransactions + w.stats.fetchedTransactions, w.wallet).toBe(w.signatures.length);
    }
    const later = result.wallets.slice(1);
    expect(later.some((w) => w.stats.cachedTransactions > 0)).toBe(true);
  });

  it("loads a mapped wallet only from its own start when given per-wallet ranges", async () => {
    const fixture = loadFixture("a-to-b-to-c");
    const b = fixture.manifest.wallets[1].address;
    const all = await run(fixture);
    const full = all.wallets.find((w) => w.wallet === b)!.signatures;
    expect(full.length).toBeGreaterThan(1);
    // Start just after B's oldest transaction: that one drops out, the newer ones stay.
    const time = (s: string) => Date.parse(all.transactions.get(s)!.timestamp!);
    const oldest = full.at(-1)!;
    const ranges = { [b]: { start: new Date(time(oldest) + 1000).toISOString(), end: fixture.manifest.range.end } };
    const narrowed = (await run(fixture, { ranges })).wallets.find((w) => w.wallet === b)!;
    expect(narrowed.signatures).toEqual(full.filter((s) => time(s) > time(oldest)));
  });

  it("orders each wallet's signatures newest first", async () => {
    const fixture = loadFixture("a-to-b-to-c");
    const result = await run(fixture);
    for (const w of result.wallets) {
      const times = w.signatures.map((s) => result.transactions.get(s)!.timestamp!);
      expect(times).toEqual([...times].sort().reverse());
    }
  });
});

describe("ingestWallets on a high-activity wallet", () => {
  const fixture = generateHighActivity() as unknown as Fixture;

  it("pages through signature history across multiple pages", async () => {
    const log: ReplayLog = [];
    const result = await run(fixture, { fetchImpl: replayFetch(fixture, log) });
    expect(log.filter((c) => c.method === "getSignaturesForAddress").length).toBeGreaterThan(1);
    expectMatchesManifest(fixture, result);
  });

  it("marks history partial when the signature safety limit is hit", async () => {
    const result = await run(fixture, { limits: { maxSignaturesPerAddress: 100 } });
    const w = result.wallets[0];
    expect(w.signatures).toHaveLength(100);
    expect(w.coverage.complete).toBe(false);
    expect(w.coverage.warnings.join(" ")).toMatch(/safety limit of 100 signatures/);
  });

  it("marks history partial when the page limit is hit before the range start", async () => {
    const result = await run(fixture, { limits: { maxPagesPerAddress: 1 } });
    expect(result.wallets[0].coverage.complete).toBe(false);
    expect(result.wallets[0].coverage.warnings.join(" ")).toMatch(/without reaching the range start/);
  });

  it("reports progress through each phase", async () => {
    const phases = new Set<string>();
    let last: IngestionProgress | undefined;
    await run(fixture, {
      onProgress: (p) => {
        phases.add(p.phase);
        last = p;
      },
    });
    expect(phases).toEqual(new Set(["signatures", "transactions", "token_accounts"]));
    expect(last!.transactions).toEqual({ loaded: last!.signaturesFound, loading: 0, queued: 0, failed: 0 });
  });
});

describe("ingestWallets with indexed provider history", () => {
  it("loads full wallet and token-account history without per-account RPC calls", async () => {
    const fixture = loadFixture("simple-transfers");
    const fetchImpl = replayFetch(fixture);
    const base = createGenericAdapter("https://rpc.example.com/?api-key=k", { fetchImpl, maxRetries: 0 });
    const signatures = fixture.manifest.expected.signaturesByWallet[fixture.manifest.wallets[0].address];
    const rows = await Promise.all(signatures.map((signature) => base.getTransaction(signature, new AbortController().signal)));
    const data = rows.filter((tx): tx is NonNullable<typeof tx> => tx !== null);
    let indexedCalls = 0;

    const result = await run(fixture, {
      adapter: {
        ...base,
        kind: "helius",
        getTransactionsForAddress: async () => {
          indexedCalls++;
          return { data };
        },
      },
    });

    expectMatchesManifest(fixture, result);
    expect(indexedCalls).toBe(1);
    expect(result.wallets[0].tokenAccounts).toEqual([]);
  });
});

describe("ingestWallets failure handling", () => {
  it("returns partial, incomplete results when cancelled", async () => {
    const fixture = loadFixture("a-to-b-to-c");
    const controller = new AbortController();
    const base = replayFetch(fixture);
    let transactions = 0;
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const { method } = JSON.parse(String(init?.body));
      if (method === "getTransaction" && ++transactions === 2) controller.abort();
      return base(url, init);
    }) as typeof fetch;

    const result = await run(fixture, { fetchImpl, signal: controller.signal, limits: { concurrency: 1 } });
    expect(result.cancelled).toBe(true);
    expect(result.wallets).toHaveLength(1);
    expect(result.wallets[0].coverage.complete).toBe(false);
    expect(result.wallets[0].coverage.warnings).toContain("Cancelled before this wallet finished loading.");
    expect(result.transactions.size).toBe(1);
  });

  it("flags transactions the RPC no longer returns", async () => {
    const fixture = loadFixture("simple-transfers");
    const base = replayFetch(fixture);
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const { method } = JSON.parse(String(init?.body));
      if (method === "getTransaction") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }));
      return base(url, init);
    }) as typeof fetch;

    const w = (await run(fixture, { fetchImpl })).wallets[0];
    expect(w.coverage.complete).toBe(false);
    expect(w.coverage.transactionCount).toBe(0);
    expect(w.coverage.warnings.join(" ")).toMatch(/not returned by the RPC/);
  });

  it("reports a wallet whose history cannot be loaded and continues with the next", async () => {
    const fixture = loadFixture("a-to-b-to-c");
    const [first] = fixture.manifest.wallets;
    const base = replayFetch(fixture);
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const { method, params } = JSON.parse(String(init?.body));
      if (method === "getSignaturesForAddress" && params[0] === first.address) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "busy" } }));
      }
      return base(url, init);
    }) as typeof fetch;

    const result = await run(fixture, { fetchImpl });
    expect(result.wallets[0].error).toMatch(/busy/);
    expect(result.wallets[0].coverage.complete).toBe(false);
    expect(result.wallets[1].error).toBeUndefined();
    expect(result.wallets[1].signatures.length).toBeGreaterThan(0);
  });
});

describe("ingestWallets transaction pipeline", () => {
  /** Replays a fixture with an O(1) lookup per request, optional per-request latency, and overrides. */
  function instrumented(
    fixture: Fixture,
    { delay = () => 0, override }: { delay?: () => number; override?: (method: string, params: unknown[]) => Response | undefined } = {},
  ) {
    const base = replayFetch(fixture);
    const transactions = new Map<string, unknown>();
    for (const call of fixture.rpc) {
      if (call.request.method === "getTransaction") transactions.set(call.request.params[0] as string, call.response);
    }
    const log: Array<{ method: string; address: unknown }> = [];
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      inFlight++;
      peak = Math.max(peak, inFlight);
      log.push({ method, address: params[0] });
      try {
        const ms = delay();
        if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
        init?.signal?.throwIfAborted();
        const replaced = override?.(method, params);
        if (replaced) return replaced;
        if (method === "getTransaction" && transactions.has(params[0] as string)) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, ...(transactions.get(params[0] as string) as object) }));
        }
        return await base(url, init);
      } finally {
        inFlight--;
      }
    }) as typeof fetch;
    return { fetchImpl, log, peak: () => peak, inFlight: () => inFlight };
  }

  const medium = generateHighActivity({ seed: "pipeline", transactionCount: 2500 }) as unknown as Fixture;
  const signaturesOf = (f: Fixture) => f.manifest.expected.signaturesByWallet[f.manifest.wallets[0].address];

  it("starts fetching transactions before signature discovery finishes", async () => {
    const replay = instrumented(medium);
    const result = await run(medium, { fetchImpl: replay.fetchImpl });
    const wallet = medium.manifest.wallets[0].address;
    const walletPages = replay.log.flatMap((c, i) => (c.method === "getSignaturesForAddress" && c.address === wallet ? [i] : []));
    expect(walletPages.length).toBeGreaterThan(2);
    expect(replay.log.findIndex((c) => c.method === "getTransaction")).toBeLessThan(walletPages.at(-1)!);
    expectMatchesManifest(medium, result);
  });

  it("never has more transaction requests in flight than the configured concurrency", async () => {
    const replay = instrumented(medium, { delay: () => 1 });
    const result = await run(medium, { fetchImpl: replay.fetchImpl, limits: { concurrency: 5, accountScanConcurrency: 1 } });
    // Five transaction fetches plus the one signature page being paged alongside them.
    expect(replay.peak()).toBeLessThanOrEqual(6);
    expect(replay.peak()).toBeGreaterThanOrEqual(5);
    expectMatchesManifest(medium, result);
  });

  it("produces the same result whatever order fetches finish in", async () => {
    const sequential = await run(medium, { fetchImpl: instrumented(medium).fetchImpl, limits: { concurrency: 1 } });
    const shuffled = await run(medium, { fetchImpl: instrumented(medium, { delay: () => Math.random() * 3 }).fetchImpl, limits: { concurrency: 16 } });
    expect(shuffled.wallets.map((w) => w.signatures)).toEqual(sequential.wallets.map((w) => w.signatures));
    expect(new Set(shuffled.transactions.keys())).toEqual(new Set(sequential.transactions.keys()));
    for (const [signature, tx] of sequential.transactions) expect(shuffled.transactions.get(signature)).toEqual(tx);
  });

  it("retries rate-limited transaction requests and still loads everything", async () => {
    const limited = new Set<string>();
    const replay = instrumented(medium, {
      override: (method, params) => {
        const signature = params[0] as string;
        // Every tenth transaction is rate limited on its first attempt.
        if (method === "getTransaction" && signature.charCodeAt(3) % 10 === 0 && !limited.has(signature)) {
          limited.add(signature);
          return new Response("", { status: 429 });
        }
      },
    });
    const result = await run(medium, {
      adapter: createGenericAdapter("https://rpc.example.com/?api-key=k", { fetchImpl: replay.fetchImpl, maxRetries: 2, sleep: async () => {} }),
      limits: { concurrency: 8 },
    });
    expect(limited.size).toBeGreaterThan(0);
    expectMatchesManifest(medium, result);
  });

  it("records a transaction that keeps failing and loads the rest", async () => {
    const [bad] = signaturesOf(medium);
    const replay = instrumented(medium, {
      override: (method, params) => (method === "getTransaction" && params[0] === bad ? new Response("", { status: 500 }) : undefined),
    });
    const w = (await run(medium, { fetchImpl: replay.fetchImpl })).wallets[0];
    expect(w.error).toBeUndefined();
    expect(w.coverage.complete).toBe(false);
    expect(w.coverage.transactionCount).toBe(w.signatures.length - 1);
    expect(w.coverage.warnings.join(" ")).toMatch(/1 transaction request\(s\) failed \(RPC responded with HTTP 500/);
  });

  it("has nothing left running once a cancelled load returns", async () => {
    const controller = new AbortController();
    const replay = instrumented(medium, { delay: () => 2 });
    let transactions = 0;
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (JSON.parse(String(init?.body)).method === "getTransaction" && ++transactions === 50) controller.abort();
      return replay.fetchImpl(url, init);
    }) as typeof fetch;
    const result = await run(medium, { fetchImpl, signal: controller.signal, limits: { concurrency: 8 } });
    expect(result.cancelled).toBe(true);
    const size = result.transactions.size;
    const calls = replay.log.length;
    expect(replay.inFlight()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(replay.log.length).toBe(calls);
    expect(result.transactions.size).toBe(size);
  });

  it("loads a large wallet with bounded requests", { timeout: 30_000 }, async () => {
    const large = generateHighActivity({ seed: "pipeline-large", transactionCount: 10_000 }) as unknown as Fixture;
    const replay = instrumented(large);
    const result = await run(large, {
      fetchImpl: replay.fetchImpl,
      limits: { maxSignaturesPerAddress: 20_000, concurrency: 20, accountScanConcurrency: 1 },
    });
    expect(replay.peak()).toBeLessThanOrEqual(21);
    expect(result.wallets[0].signatures).toHaveLength(signaturesOf(large).length);
    expectMatchesManifest(large, result);
  });
});
