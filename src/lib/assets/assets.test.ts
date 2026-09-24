import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGenericAdapter } from "@/lib/rpc/generic-adapter";
import { type Fixture, replayFetch } from "@/test/fixture-rpc";
import { builtinAsset, decodeMetaplexMetadata, fetchAssetMetadata, metaplexMetadataAddress, NATIVE_SOL, nftCandidates } from "./assets";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDG = "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH";

const metadataFixture: Fixture = {
  manifest: { wallets: [] } as unknown as Fixture["manifest"],
  rpc: JSON.parse(readFileSync(join(process.cwd(), "fixtures", "metadata", "rpc.json"), "utf8")),
};
const adapter = createGenericAdapter("https://rpc.example.com", { fetchImpl: replayFetch(metadataFixture), maxRetries: 0 });
const signal = new AbortController().signal;
const NOW = new Date("2026-09-24T00:00:00Z");

describe("asset metadata", () => {
  it("knows native SOL without any lookup", () => {
    expect(builtinAsset(NATIVE_SOL)).toMatchObject({ symbol: "SOL", decimals: 9 });
  });

  it("derives the Metaplex metadata address for a mint", async () => {
    expect(await metaplexMetadataAddress(USDC)).toBe("5x38Kp4hvdomTCnCrAny4UtMUt5rQBdB6px2K1Ui45Wq");
  });

  it("reads a Token-2022 mint's embedded metadata", async () => {
    expect(await fetchAssetMetadata(adapter, USDG, signal, NOW)).toEqual({
      id: USDG,
      symbol: "USDG",
      name: "Global Dollar",
      decimals: 6,
      nft: false,
      source: "token-2022",
      fetchedAt: NOW.toISOString(),
    });
  });

  it("falls back to the Metaplex metadata account for a classic SPL mint", async () => {
    expect(await fetchAssetMetadata(adapter, USDC, signal, NOW)).toMatchObject({
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      source: "metaplex",
    });
  });

  it("returns no name when a mint has no metadata anywhere", async () => {
    const empty = createGenericAdapter("https://rpc.example.com", {
      maxRetries: 0,
      fetchImpl: (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: null } }))) as typeof fetch,
    });
    expect(await fetchAssetMetadata(empty, USDC, signal, NOW)).toMatchObject({ symbol: null, name: null, nft: null, source: "none" });
  });

  it("recognises an NFT from its mint account: 0 decimals and a supply of exactly 1", async () => {
    const mintWith = (decimals: number, supply: string) =>
      createGenericAdapter("https://rpc.example.com", {
        maxRetries: 0,
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: { value: { lamports: 1, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: { parsed: { type: "mint", info: { decimals, supply } } } } },
            }),
          )) as typeof fetch,
      });
    expect((await fetchAssetMetadata(mintWith(0, "1"), USDC, signal, NOW)).nft).toBe(true);
    // Semi-fungible (many copies) and fungible tokens aren't NFTs.
    expect((await fetchAssetMetadata(mintWith(0, "500"), USDC, signal, NOW)).nft).toBe(false);
    expect((await fetchAssetMetadata(mintWith(6, "1"), USDC, signal, NOW)).nft).toBe(false);
  });

  it("only flags 0-decimal, one-unit moves as NFT candidates", () => {
    expect([
      ...nftCandidates([
        { mint: "nft", decimals: 0, delta: "-1" },
        { mint: "sft", decimals: 0, delta: "5" },
        { mint: "usdc", decimals: 6, delta: "1" },
      ]),
    ]).toEqual(["nft"]);
  });

  it("strips Metaplex NUL padding and rejects truncated data", () => {
    const text = new TextEncoder();
    const field = (s: string, width: number) => {
      const bytes = new Uint8Array(4 + width);
      new DataView(bytes.buffer).setUint32(0, width, true);
      bytes.set(text.encode(s), 4);
      return bytes;
    };
    const parts = [new Uint8Array(65), field("Test Token", 32), field("TT", 10)];
    const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      buf.set(p, offset);
      offset += p.length;
    }
    expect(decodeMetaplexMetadata(buf)).toEqual({ name: "Test Token", symbol: "TT" });
    expect(decodeMetaplexMetadata(buf.subarray(0, 70))).toBeNull();
  });
});
