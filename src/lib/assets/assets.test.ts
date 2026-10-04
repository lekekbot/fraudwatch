import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGenericAdapter } from "@/lib/rpc/generic-adapter";
import { type Fixture, replayFetch } from "@/test/fixture-rpc";
import {
  builtinAsset,
  decodeMetaplexMetadata,
  fetchAssetMetadata,
  fetchCompressedAssetMetadata,
  metaplexMetadataAddress,
  NATIVE_SOL,
  nftCandidates,
} from "./assets";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDG = "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH";
const PUMP = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
const JITOSOL = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const QQQX = "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ";

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

  it("knows popular Solscan leaderboard tokens without any lookup", () => {
    expect(builtinAsset(PUMP)).toMatchObject({ symbol: "PUMP", name: "Pump", decimals: 6 });
    expect(builtinAsset(JITOSOL)).toMatchObject({ symbol: "JitoSOL", decimals: 9 });
    expect(builtinAsset(QQQX)).toMatchObject({ symbol: "QQQx", decimals: 8 });
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

  it("names a compressed NFT from its mint, then DAS getAsset, and still marks it an NFT without either", async () => {
    const das = (result: unknown) => ({ getAsset: async () => result as { name: string | null; symbol: string | null } | null });
    expect(await fetchCompressedAssetMetadata(das(null), "asset", "Minted Name", signal, NOW)).toMatchObject({ name: "Minted Name", nft: true, source: "bubblegum" });
    expect(await fetchCompressedAssetMetadata(das({ name: "From DAS", symbol: "D" }), "asset", undefined, signal, NOW)).toMatchObject({
      name: "From DAS",
      nft: true,
      source: "das",
    });
    // Provider without DAS: the adapter resolves null; the asset stays unnamed but is still an NFT.
    expect(await fetchCompressedAssetMetadata(das(null), "asset", undefined, signal, NOW)).toMatchObject({ name: null, nft: true, source: "none" });
  });

  it("asks the RPC for DAS getAsset with named params and treats an unsupported method as no name", async () => {
    const bodies: unknown[] = [];
    const reply = (body: unknown) =>
      createGenericAdapter("https://rpc.example.com", {
        maxRetries: 0,
        fetchImpl: (async (_url: RequestInfo | URL, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify(body));
        }) as typeof fetch,
      });
    const named = await reply({ jsonrpc: "2.0", id: 1, result: { content: { metadata: { name: "cNFT #1", symbol: "C" } } } }).getAsset("asset", signal);
    expect(named).toEqual({ name: "cNFT #1", symbol: "C" });
    expect(bodies[0]).toMatchObject({ method: "getAsset", params: { id: "asset" } });
    expect(await reply({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }).getAsset("asset", signal)).toBeNull();
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

  it("reads a real NFT's royalty and creators from its Metaplex metadata account", () => {
    const account = JSON.parse(readFileSync(join(process.cwd(), "fixtures/solana/nft-sale/metadata-account.json"), "utf8")) as { data: string };
    const decoded = decodeMetaplexMetadata(Uint8Array.from(atob(account.data), (c) => c.charCodeAt(0)))!;
    expect(decoded.name).toBe("SMB Gen3 #86");
    expect(decoded.royaltyBps).toBe(500);
    // Three creators; only the one with a share receives royalties.
    expect(decoded.creators!.map((c) => c.share)).toEqual([0, 0, 100]);
    expect(decoded.creators![2].address.startsWith("HqqiyJ")).toBe(true);
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
