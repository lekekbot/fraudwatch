import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCase } from "@/lib/case/model";
import type { CaseRange } from "@/lib/case/range";
import { type IngestionCache, ingestWallets } from "@/lib/ingest/ingest";
import { createGenericAdapter } from "@/lib/rpc/generic-adapter";
import { type Fixture, loadFixture, type ReplayLog, replayFetch } from "@/test/fixture-rpc";
import { deleteCase, saveCase } from "./cases";
import { FraudWatchDB } from "./db";
import { invalidateStaleDerivedCaches } from "./derived";
import { readCachedIngestion, saveIngestionJob } from "./ingestion-jobs";
import { clearAllLocalData, clearTransactionCache, getStorageSummary } from "./storage";
import { createDbIngestionCache } from "./transaction-cache";

const fixture = loadFixture("a-to-b-to-c");
const WALLETS = fixture.manifest.wallets.map((w) => w.address);
const RANGE = fixture.manifest.range;
const LATER = () => new Date("2026-09-24T00:00:00Z");

let db: FraudWatchDB;

beforeEach(() => {
  db = new FraudWatchDB(`test-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete().catch(() => {});
});

async function load(
  options: { range?: CaseRange; wallets?: string[]; cache?: IngestionCache; now?: () => Date; fixture?: Fixture } = {},
) {
  const f = options.fixture ?? fixture;
  const log: ReplayLog = [];
  const result = await ingestWallets({
    adapter: createGenericAdapter("https://rpc.example.com", { fetchImpl: replayFetch(f, log), maxRetries: 0 }),
    wallets: options.wallets ?? WALLETS,
    range: options.range ?? RANGE,
    signal: new AbortController().signal,
    cache: options.cache ?? createDbIngestionCache(db),
    now: options.now ?? LATER,
  });
  const count = (method: string) => log.filter((c) => c.method === method).length;
  return { result, log, count };
}

describe("transaction cache", () => {
  it("serves a reopened case entirely from the cache with no RPC calls", async () => {
    const first = await load();
    expect(first.count("getTransaction")).toBe(5);

    const second = await load();
    expect(second.log).toEqual([]);
    expect(second.result.transactions.size).toBe(5);
    for (const w of second.result.wallets) {
      expect(new Set(w.signatures)).toEqual(new Set(fixture.manifest.expected.signaturesByWallet[w.wallet]));
      expect(w.coverage.complete).toBe(true);
      expect(w.stats.fetchedTransactions).toBe(0);
    }
  });

  it("stores a transaction shared by several wallets once, with a lightweight index per wallet", async () => {
    await load();
    expect(await db.transactions.count()).toBe(5);
    expect(await db.raw_transactions.count()).toBe(5);
    const indexed = Object.values(fixture.manifest.expected.signaturesByWallet).flat().length;
    expect(await db.wallet_transactions.count()).toBe(indexed);
    const [shared] = fixture.manifest.expected.sharedSignatures;
    expect(await db.transactions.get(`solana:${shared.signature}`)).toMatchObject({ signature: shared.signature, parserVersion: 1 });
  });

  it("fetches only the uncovered part of a wider range", async () => {
    const narrow = { start: RANGE.start, end: "2026-07-30T08:55:00.000Z" };
    await load({ range: narrow });
    const cachedBefore = await db.raw_transactions.count();

    const wide = await load();
    expect(wide.result.wallets.every((w) => w.stats.rangesFetched.length === 1)).toBe(true);
    expect(wide.result.wallets[0].stats.rangesFetched[0]).toEqual({ start: narrow.end, end: RANGE.end });
    expect(wide.count("getTransaction")).toBe(5 - cachedBefore);
    expect(wide.result.transactions.size).toBe(5);
  });

  it("refetches transactions whose cache entries were cleared but whose index remains", async () => {
    await load();
    await db.transactions.clear();
    await db.raw_transactions.clear();
    const again = await load();
    expect(again.count("getSignaturesForAddress")).toBe(0);
    expect(again.count("getTransaction")).toBe(5);
  });

  it("does not trust partial coverage", async () => {
    const high = await import("../../../fixtures/solana/synthetic/generate").then((m) => m.generateHighActivity() as unknown as Fixture);
    const wallet = high.manifest.wallets[0].address;
    const partial = await ingestWallets({
      adapter: createGenericAdapter("https://rpc.example.com", { fetchImpl: replayFetch(high), maxRetries: 0 }),
      wallets: [wallet],
      range: high.manifest.range,
      signal: new AbortController().signal,
      cache: createDbIngestionCache(db),
      now: LATER,
      limits: { maxSignaturesPerAddress: 50 },
    });
    expect(partial.wallets[0].coverage.complete).toBe(false);
    expect((await db.coverage.get(wallet))!.ranges.every((r) => !r.complete)).toBe(true);

    const full = await load({ fixture: high, wallets: [wallet], range: high.manifest.range });
    expect(full.count("getSignaturesForAddress")).toBeGreaterThan(0);
    expect(full.count("getTransaction")).toBe(high.manifest.expected.transactionCount - 50);
    expect(full.result.wallets[0].coverage.complete).toBe(true);
  });

  it("only caches history as complete up to the finality margin", async () => {
    const justAfterEnd = () => new Date(Date.parse(RANGE.end) + 60_000);
    await load({ now: justAfterEnd });
    const again = await load({ now: justAfterEnd });
    expect(again.result.wallets[0].stats.rangesFetched).toEqual([
      { start: new Date(Date.parse(RANGE.end) - 60_000).toISOString(), end: RANGE.end },
    ]);
    expect(again.count("getTransaction")).toBe(0);
  });

  it("keeps ingesting and warns when local storage is full", async () => {
    const base = createDbIngestionCache(db);
    const quota = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    const full: IngestionCache = { ...base, putTransactions: async () => Promise.reject(quota) };
    const { result } = await load({ cache: full });
    expect(result.transactions.size).toBe(5);
    expect(result.wallets[0].coverage.warnings.join(" ")).toMatch(/storage for FraudWatch is full/);
  });
});

describe("derived cache invalidation", () => {
  it("re-derives parsed transactions from raw responses after a parser version change, without refetching", async () => {
    await load();
    await db.meta.put({ key: "derived:parser", value: 0 });
    const reopened = new FraudWatchDB(db.name);
    try {
      const again = await load({ cache: createDbIngestionCache(reopened) });
      expect(again.log).toEqual([]);
      expect(again.result.transactions.size).toBe(5);
      expect(await reopened.transactions.count()).toBe(5);
      expect((await reopened.meta.get("derived:parser"))!.value).toBe(1);
    } finally {
      reopened.close();
    }
  });

  it("clears only the caches whose version changed", async () => {
    const cleared: string[] = [];
    const caches = (registry: string) => [
      { name: "parser", version: 1, clear: async () => void cleared.push("parser") },
      { name: "registry", version: registry, clear: async () => void cleared.push("registry") },
    ];
    expect(await invalidateStaleDerivedCaches(db, caches("2026.1"))).toEqual([]);
    expect(await invalidateStaleDerivedCaches(db, caches("2026.1"))).toEqual([]);
    expect(await invalidateStaleDerivedCaches(db, caches("2026.2"))).toEqual(["registry"]);
    expect(cleared).toEqual(["registry"]);
  });
});

describe("reopening a case from the cache", () => {
  const fwCase = createCase({ name: "A→B→C", primaryWallet: WALLETS[0], range: RANGE });

  it("returns null before anything is loaded", async () => {
    expect(await readCachedIngestion(db, fwCase.id, WALLETS, RANGE)).toBeNull();
  });

  it("rebuilds the last load's result without the RPC", async () => {
    const { result } = await load();
    await saveIngestionJob(db, fwCase.id, RANGE, result, LATER());
    const cached = (await readCachedIngestion(db, fwCase.id, WALLETS, RANGE))!;
    expect(cached.lastLoadedAt).toBe(LATER().toISOString());
    expect(cached.result.transactions.size).toBe(5);
    expect(cached.result.wallets.map((w) => w.signatures)).toEqual(result.wallets.map((w) => w.signatures));
    expect(cached.result.wallets.every((w) => w.coverage.complete)).toBe(true);
  });

  it("flags wallets and ranges that aren't cached yet", async () => {
    await load({ wallets: [WALLETS[0]] });
    const cached = (await readCachedIngestion(db, fwCase.id, WALLETS, RANGE))!;
    expect(cached.result.wallets[0].coverage.complete).toBe(true);
    expect(cached.result.wallets[1].coverage.complete).toBe(false);
    expect(cached.result.wallets[1].coverage.warnings).toContain("Not loaded yet.");
  });
});

describe("storage controls", () => {
  it("reports counts and clears the transaction cache but keeps cases", async () => {
    const fwCase = createCase({ name: "A", primaryWallet: WALLETS[0], range: RANGE });
    await saveCase(db, fwCase);
    const { result } = await load();
    await saveIngestionJob(db, fwCase.id, RANGE, result);

    expect(await getStorageSummary(db)).toMatchObject({ cases: 1, transactions: 5, walletsWithCoverage: 3 });
    await clearTransactionCache(db);
    expect(await getStorageSummary(db)).toMatchObject({ cases: 1, transactions: 0, walletIndexEntries: 0, walletsWithCoverage: 0 });
    expect(await db.ingestion_jobs.count()).toBe(0);
  });

  it("deleting a case removes its load record but keeps shared chain data", async () => {
    const fwCase = createCase({ name: "A", primaryWallet: WALLETS[0], range: RANGE });
    await saveCase(db, fwCase);
    const { result } = await load();
    await saveIngestionJob(db, fwCase.id, RANGE, result);
    await deleteCase(db, fwCase.id);
    expect(await db.cases.count()).toBe(0);
    expect(await db.ingestion_jobs.count()).toBe(0);
    expect(await db.raw_transactions.count()).toBe(5);
  });

  it("clears all local data by deleting the database", async () => {
    await load();
    await clearAllLocalData(db);
    expect(await Dexie.exists(db.name)).toBe(false);
  });
});
