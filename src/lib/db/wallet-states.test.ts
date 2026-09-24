import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { canonicalize } from "@/lib/solana/canonical";
import { loadFixture } from "@/test/fixture-rpc";
import { FraudWatchDB } from "./db";
import { invalidateStaleDerivedCaches } from "./derived";
import { getAssetMetadata, getWalletState, saveAssetMetadata } from "./wallet-states";

const fixture = loadFixture("a-to-b-to-c");
const wallet = fixture.manifest.wallets[1].address;
const range = fixture.manifest.range;
const txs = fixture.rpc
  .filter((c) => c.request.method === "getTransaction")
  .filter((c) => fixture.manifest.expected.signaturesByWallet[wallet].includes(c.request.params[0] as string))
  .map((c) => canonicalize((c.response as { result: RawParsedTransaction }).result));

let db: FraudWatchDB;
beforeEach(() => {
  db = new FraudWatchDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await db.delete().catch(() => {});
});

describe("wallet state cache", () => {
  it("stores the state with its reconstruction version and source transactions", async () => {
    await getWalletState(db, wallet, range, txs, true);
    const [record] = await db.wallet_states.toArray();
    expect(record).toMatchObject({ wallet, reconstructionVersion: 1, historyComplete: true });
    expect(record.sourceSignatures).toEqual(txs.map((t) => t.signature).sort());
  });

  it("reuses the cached state for the same transactions", async () => {
    await getWalletState(db, wallet, range, txs, true);
    await db.wallet_states.toCollection().modify((r) => {
      r.state = { ...r.state, partialReasons: ["from cache"] };
    });
    expect((await getWalletState(db, wallet, range, [...txs].reverse(), true)).partialReasons).toEqual(["from cache"]);
  });

  it("recomputes when the source transactions or completeness change", async () => {
    await getWalletState(db, wallet, range, txs, true);
    await db.wallet_states.toCollection().modify((r) => {
      r.state = { ...r.state, partialReasons: ["stale"] };
    });
    expect((await getWalletState(db, wallet, range, txs.slice(1), true)).partialReasons).not.toEqual(["stale"]);
    expect((await getWalletState(db, wallet, range, txs.slice(1), false)).openingStatus).toBe("OPENING_STATE_PARTIAL");
  });

  it("is cleared when the reconstruction version changes", async () => {
    await getWalletState(db, wallet, range, txs, true);
    await db.meta.put({ key: "derived:reconstruction", value: 0 });
    expect(await invalidateStaleDerivedCaches(db)).toEqual(["reconstruction"]);
    expect(await db.wallet_states.count()).toBe(0);
  });
});

describe("asset metadata cache", () => {
  const MINT = "Mint111111111111111111111111111111111111111";
  const NOW = new Date("2026-09-24T00:00:00Z");

  it("serves built-ins without a lookup and asks for unknown mints once", async () => {
    const first = await getAssetMetadata(db, ["SOL", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", MINT], NOW);
    expect(first.known.get("SOL")?.symbol).toBe("SOL");
    expect(first.toFetch).toEqual([MINT]);

    await saveAssetMetadata(db, [{ id: MINT, symbol: "MNT", name: "Mint", decimals: 6, nft: false, source: "metaplex", fetchedAt: NOW.toISOString() }]);
    const second = await getAssetMetadata(db, [MINT], NOW);
    expect(second.known.get(MINT)?.symbol).toBe("MNT");
    expect(second.toFetch).toEqual([]);
  });

  it("refetches a record saved before NFT detection once", async () => {
    await saveAssetMetadata(db, [{ id: MINT, symbol: "MNT", name: "Mint", decimals: 0, source: "metaplex", fetchedAt: NOW.toISOString() }]);
    expect((await getAssetMetadata(db, [MINT], NOW)).toFetch).toEqual([MINT]);
  });

  it("retries a mint with no metadata after a week", async () => {
    await saveAssetMetadata(db, [{ id: MINT, symbol: null, name: null, decimals: 6, nft: false, source: "none", fetchedAt: NOW.toISOString() }]);
    expect((await getAssetMetadata(db, [MINT], new Date(NOW.getTime() + 86_400_000))).toFetch).toEqual([]);
    expect((await getAssetMetadata(db, [MINT], new Date(NOW.getTime() + 8 * 86_400_000))).toFetch).toEqual([MINT]);
  });
});
